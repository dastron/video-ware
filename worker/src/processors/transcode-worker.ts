import { BaseWorker } from './base-worker.js';
import type {
  Task,
  TypedPocketBase,
  ProcessUploadPayload,
  ProcessUploadResult,
} from '@project/shared';
import {
  UploadMutator,
  MediaMutator,
  MediaClipMutator,
  FileMutator,
  TaskStatus,
  UploadStatus,
  MediaType,
  ClipType,
  FileType,
  FileStatus,
  FileSource,
  ProcessingProvider,
  UploadError,
  createTaskErrorLog,
  formatTaskErrorLog,
  shouldRetry,
  sleep,
} from '@project/shared';
import { getProcessor } from './index.js';
import { readFileSync } from 'node:fs';
import { TASK_RETRY_CONFIG } from './base-worker.js';

/**
 * Worker for processing upload/transcode tasks (PROCESS_UPLOAD)
 * Handles:
 * - Probing media files
 * - Generating thumbnails
 * - Generating sprite sheets
 * - Transcoding to proxy formats
 * - Creating Media and MediaClip records
 * - Idempotent processing
 */
export class TranscodeWorker extends BaseWorker {
  private uploadMutator: UploadMutator;
  private mediaMutator: MediaMutator;
  private mediaClipMutator: MediaClipMutator;
  private fileMutator: FileMutator;

  constructor(pb: TypedPocketBase) {
    super(pb);
    this.uploadMutator = new UploadMutator(pb);
    this.mediaMutator = new MediaMutator(pb);
    this.mediaClipMutator = new MediaClipMutator(pb);
    this.fileMutator = new FileMutator(pb);
  }

  async processTask(task: Task): Promise<void> {
    // Parse payload
    const payload = task.payload as unknown as ProcessUploadPayload;
    const {
      uploadId,
      originalFileRef,
      provider,
      sprite,
      thumbnail,
      transcode,
    } = payload;

    console.log(
      `[TranscodeWorker] Processing upload task ${task.id} for upload ${uploadId}`
    );

    // Update task status to running
    await this.taskMutator.update(task.id, {
      status: TaskStatus.RUNNING,
      progress: 10,
    } as Partial<Task>);

    // Update upload status to processing
    await this.uploadMutator.updateStatus(uploadId, UploadStatus.PROCESSING);

    // Get the upload record to access workspace
    const upload = await this.uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload ${uploadId} not found`);
    }

    // IDEMPOTENCY CHECK 1: Check if Media already exists for this Upload
    console.log(
      `[TranscodeWorker] Checking for existing Media record (idempotency check)`
    );
    const existingMedia = await this.mediaMutator.getByUpload(uploadId);

    if (
      existingMedia &&
      existingMedia.thumbnailFileRef &&
      existingMedia.spriteFileRef &&
      (!transcode?.enabled || existingMedia.proxyFileRef)
    ) {
      console.log(
        `[TranscodeWorker] Media record already exists with all assets: ${existingMedia.id}`
      );
      console.log(
        `[TranscodeWorker] Skipping processing - upload already complete`
      );

      // Just update the upload status to ready and mark task as success
      await this.uploadMutator.updateStatus(uploadId, UploadStatus.READY);

      const result: ProcessUploadResult = {
        mediaId: existingMedia.id,
        thumbnailFileId: existingMedia.thumbnailFileRef,
        spriteFileId: existingMedia.spriteFileRef,
        proxyFileId: existingMedia.proxyFileRef,
        processorVersion: `cached:${existingMedia.version || 1}`,
        probeOutput:
          existingMedia.mediaData as unknown as ProcessUploadResult['probeOutput'],
      };

      await this.markSuccess(
        task.id,
        result as unknown as Record<string, unknown>
      );
      return;
    }

    // Get the processor based on provider
    const processorProvider = provider || ProcessingProvider.FFMPEG;
    const processor = getProcessor(processorProvider, this.pb);

    console.log(
      `[TranscodeWorker] Using processor: ${processor.provider} v${processor.version}`
    );

    // Step 1: Probe the media file
    console.log(`[TranscodeWorker] Probing media file: ${originalFileRef}`);
    await this.updateProgress(task.id, 20);
    const probeOutput = await processor.probe(originalFileRef);

    // Prepare configs for deterministic naming
    const thumbnailConfig = thumbnail || {
      timestamp: 'midpoint',
      width: 640,
      height: 360,
    };

    // Calculate dynamic sprite config based on duration
    // Target 100 frames (10x10) max
    const MAX_SPRITE_FRAMES = 100;
    const spriteCols = 10;
    const spriteRows = 10;
    const duration = probeOutput.duration || 1;

    // Calculate FPS needed to get approx MAX_SPRITE_FRAMES valid frames
    let spriteFps = 1;
    if (duration > MAX_SPRITE_FRAMES) {
      spriteFps = MAX_SPRITE_FRAMES / duration;
    } else {
      spriteFps = 1;
    }

    const spriteConfig = sprite || {
      fps: spriteFps,
      cols: spriteCols,
      rows: spriteRows,
      tileWidth: 160,
      tileHeight: 90,
    };

    // Generate deterministic file names
    const thumbnailFileName = this.generateDeterministicFileName(
      uploadId,
      'thumbnail',
      thumbnailConfig as unknown as Record<string, unknown>
    );
    const spriteFileName = this.generateDeterministicFileName(
      uploadId,
      'sprite',
      spriteConfig as unknown as Record<string, unknown>
    );
    const proxyFileName = transcode?.enabled
      ? this.generateDeterministicFileName(
          uploadId,
          'proxy',
          transcode as unknown as Record<string, unknown>
        )
      : undefined;

    // IDEMPOTENCY CHECK 2: Check for existing derived assets with matching config
    console.log(`[TranscodeWorker] Checking for existing derived assets`);
    const existingFiles = await this.fileMutator.getByUpload(uploadId);

    let thumbnailFile = existingFiles.items.find(
      (f) => f.fileType === FileType.THUMBNAIL && f.name === thumbnailFileName
    );
    let spriteFile = existingFiles.items.find(
      (f) => f.fileType === FileType.SPRITE && f.name === spriteFileName
    );
    let proxyFile = proxyFileName
      ? existingFiles.items.find(
          (f) => f.fileType === FileType.PROXY && f.name === proxyFileName
        )
      : undefined;

    // Step 2: Generate proxy (transcode) if enabled
    if (transcode?.enabled && proxyFileName) {
      if (proxyFile && proxyFile.fileStatus === FileStatus.AVAILABLE) {
        console.log(
          `[TranscodeWorker] Proxy already exists: ${proxyFile.id}, skipping transcoding`
        );
      } else {
        console.log(`[TranscodeWorker] Transcoding media`);
        await this.updateProgress(task.id, 30);

        if (!processor.transcode) {
          throw new Error(
            `Processor ${processor.provider} does not support transcoding`
          );
        }

        const transcodedPath = await processor.transcode(
          originalFileRef,
          transcode,
          proxyFileName,
          uploadId
        );

        // Create proxy file record
        proxyFile = await this.fileMutator.create({
          name: proxyFileName,
          size: this.getFileSize(transcodedPath),
          fileStatus: FileStatus.AVAILABLE,
          fileType: FileType.PROXY,
          fileSource: transcodedPath.startsWith('gs://')
            ? FileSource.GCS
            : FileSource.POCKETBASE,
          file: new File([readFileSync(transcodedPath)], proxyFileName, {
            type: 'video/mp4',
          }),
          s3Key: transcodedPath,
          WorkspaceRef: upload.WorkspaceRef,
          UploadRef: uploadId,
        });
      }
    }

    // Step 3: Generate thumbnail (if not exists)
    if (thumbnailFile && thumbnailFile.fileStatus === FileStatus.AVAILABLE) {
      console.log(
        `[TranscodeWorker] Thumbnail already exists: ${thumbnailFile.id}, skipping generation`
      );
    } else {
      console.log(`[TranscodeWorker] Generating thumbnail`);
      await this.updateProgress(task.id, 40);
      const thumbnailPath = await processor.generateThumbnail(
        originalFileRef,
        thumbnailConfig,
        uploadId
      );

      // Create thumbnail file record
      thumbnailFile = await this.fileMutator.create({
        name: thumbnailFileName,
        size: this.getFileSize(thumbnailPath),
        fileStatus: FileStatus.AVAILABLE,
        fileType: FileType.THUMBNAIL,
        fileSource: thumbnailPath.startsWith('gs://')
          ? FileSource.GCS
          : FileSource.POCKETBASE,
        file: new File([readFileSync(thumbnailPath)], thumbnailFileName, {
          type: 'image/jpeg',
        }),
        s3Key: thumbnailPath,
        WorkspaceRef: upload.WorkspaceRef,
        UploadRef: uploadId,
      });
    }

    // Step 4: Generate sprite sheet (if not exists)
    if (spriteFile && spriteFile.fileStatus === FileStatus.AVAILABLE) {
      console.log(
        `[TranscodeWorker] Sprite already exists: ${spriteFile.id}, skipping generation`
      );
    } else {
      console.log(`[TranscodeWorker] Generating sprite sheet`);
      await this.updateProgress(task.id, 60);
      const spritePath = await processor.generateSprite(
        originalFileRef,
        spriteConfig,
        uploadId
      );

      // Create sprite file record
      spriteFile = await this.fileMutator.create({
        name: spriteFileName,
        size: this.getFileSize(spritePath),
        fileStatus: FileStatus.AVAILABLE,
        fileType: FileType.SPRITE,
        fileSource: spritePath.startsWith('gs://')
          ? FileSource.GCS
          : FileSource.POCKETBASE,
        file: new File([readFileSync(spritePath)], spriteFileName, {
          type: 'image/jpeg',
        }),
        s3Key: spritePath,
        WorkspaceRef: upload.WorkspaceRef,
        UploadRef: uploadId,
        meta: { spriteConfig } as unknown as Record<string, unknown>,
      });
    }

    await this.updateProgress(task.id, 70);

    // Step 5: Create or update Media record (idempotent)
    console.log(`[TranscodeWorker] Creating/updating Media record`);
    await this.updateProgress(task.id, 80);

    let media = existingMedia;

    if (media) {
      console.log(
        `[TranscodeWorker] Media record already exists: ${media.id}, updating...`
      );
      // Update existing media record
      media = await this.mediaMutator.update(media.id, {
        duration: probeOutput.duration,
        mediaData: probeOutput as unknown as Record<string, unknown>,
        thumbnailFileRef: thumbnailFile.id,
        spriteFileRef: spriteFile.id,
        proxyFileRef: proxyFile?.id,
        version: (media.version || 0) + 1,
      } as Partial<typeof media>);
    } else {
      // Create new Media record
      console.log(`[TranscodeWorker] Creating new Media record`);
      media = await this.mediaMutator.create({
        WorkspaceRef: upload.WorkspaceRef,
        UploadRef: uploadId,
        mediaType: MediaType.VIDEO,
        duration: probeOutput.duration,
        mediaData: probeOutput as unknown as Record<string, unknown>,
        thumbnailFileRef: thumbnailFile.id,
        spriteFileRef: spriteFile.id,
        proxyFileRef: proxyFile?.id,
        version: 1,
      });
    }

    // Step 6: Create initial full-range MediaClip (if not exists - idempotent)
    console.log(`[TranscodeWorker] Checking for full-range MediaClip`);
    await this.updateProgress(task.id, 90);

    const existingClips = await this.mediaClipMutator.getByMedia(media.id);
    const hasFullClip = existingClips.items.some(
      (clip) => clip.type === ClipType.FULL
    );

    if (!hasFullClip) {
      console.log(`[TranscodeWorker] Creating full-range MediaClip`);
      await this.mediaClipMutator.create({
        WorkspaceRef: upload.WorkspaceRef,
        MediaRef: media.id,
        type: ClipType.FULL,
        start: 0,
        end: probeOutput.duration,
        duration: probeOutput.duration,
      });
    } else {
      console.log(
        `[TranscodeWorker] Full-range MediaClip already exists, skipping`
      );
    }

    // Step 7: Update Upload status to ready
    console.log(`[TranscodeWorker] Updating Upload status to ready`);
    await this.uploadMutator.updateStatus(uploadId, UploadStatus.READY);

    // Step 8: Mark task as successful
    const result: ProcessUploadResult = {
      mediaId: media.id,
      thumbnailFileId: thumbnailFile.id,
      spriteFileId: spriteFile.id,
      proxyFileId: proxyFile?.id,
      processorVersion: `${processor.provider}:${processor.version}`,
      probeOutput,
    };

    await this.markSuccess(
      task.id,
      result as unknown as Record<string, unknown>
    );
  }

  /**
   * Override error handling to also update upload status
   */
  protected async handleError(task: Task, error: unknown): Promise<void> {
    const uploadError = UploadError.fromError(error);
    const payload = task.payload as unknown as ProcessUploadPayload;

    console.error(
      `[TranscodeWorker] Task ${task.id} failed:`,
      uploadError.message
    );

    // Update upload status to failed
    await this.uploadMutator.updateStatus(
      payload.uploadId,
      UploadStatus.FAILED,
      uploadError.message
    );

    // Create error log
    const errorLog = createTaskErrorLog('unknown', uploadError, {
      taskId: task.id,
      uploadId: payload.uploadId,
    });
    const formattedError = formatTaskErrorLog(errorLog);

    // Mark task as failed
    await this.taskMutator.markFailed(task.id, formattedError);

    // Check if we should retry using exponential backoff
    const updatedTask = await this.taskMutator.getById(task.id);
    if (updatedTask) {
      const retryDecision = shouldRetry(
        uploadError,
        updatedTask.attempts,
        TASK_RETRY_CONFIG
      );

      if (retryDecision.shouldRetry) {
        console.log(
          `[TranscodeWorker] Task ${task.id} will be retried: ${retryDecision.reason}`
        );

        // Wait for backoff delay before resetting to queued
        console.log(
          `[TranscodeWorker] Waiting ${retryDecision.delayMs}ms before retry...`
        );
        await sleep(retryDecision.delayMs);

        // Reset to queued for retry
        await this.taskMutator.update(task.id, {
          status: TaskStatus.QUEUED,
          progress: 0,
        } as Partial<Task>);

        // Also reset upload status to uploaded for retry
        await this.uploadMutator.updateStatus(
          payload.uploadId,
          UploadStatus.UPLOADED
        );
      } else {
        console.log(
          `[TranscodeWorker] Task ${task.id} will not be retried: ${retryDecision.reason}`
        );
      }
    }
  }
}
