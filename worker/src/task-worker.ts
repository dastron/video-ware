/**
 * Task Worker - Background processor for media uploads and other long-running tasks
 *
 * This worker polls the PocketBase Tasks collection for queued tasks and processes them.
 * It handles the process_upload task type, which:
 * 1. Probes the uploaded media file to extract metadata
 * 2. Generates a thumbnail image
 * 3. Generates a sprite sheet for hover previews
 * 4. Creates a Media record with the extracted metadata
 * 5. Creates an initial full-range MediaClip
 * 6. Updates the Upload status to 'ready'
 *
 * Features:
 * - Idempotent processing (checks for existing Media before creating)
 * - Exponential backoff retry logic
 * - Deterministic output naming
 *
 * Usage:
 *   node webapp/src/workers/task-worker.ts
 *   or
 *   tsx webapp/src/workers/task-worker.ts
 */

import PocketBase from 'pocketbase';
import { statSync, readFileSync } from 'node:fs';
import {
  TaskType,
  TaskStatus,
  UploadStatus,
  MediaType,
  ClipType,
  FileType,
  FileStatus,
  FileSource,
  ProcessingProvider,
  TaskMutator,
  UploadMutator,
  MediaMutator,
  MediaClipMutator,
  FileMutator,
  type Task,
  type ProcessUploadPayload,
  type ProcessUploadResult,
  type DetectLabelsPayload,
  type TypedPocketBase,
  sleep,
  UploadError,
  createTaskErrorLog,
  formatTaskErrorLog,
  type RetryConfig,
  shouldRetry,
  env,
} from '@project/shared';
import { getProcessor } from './processors/index.js';

// Configuration
const POCKETBASE_URL = env.POCKETBASE_URL;
const POLL_INTERVAL_MS = 60000; // Poll every 60 seconds

// Retry configuration for task processing
const TASK_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 60000, // 60 seconds
  maxDelayMs: 300000, // 5 minutes
  jitterFactor: 0.1,
};

/**
 * Generate deterministic output file name based on uploadId and config
 * This ensures idempotent processing - same inputs always produce same output names
 *
 * @param uploadId The upload ID
 * @param fileType The type of file (thumbnail, sprite)
 * @param config Configuration used for generation
 * @returns Deterministic file name
 */
function generateDeterministicFileName(
  uploadId: string,
  fileType: 'thumbnail' | 'sprite' | 'proxy',
  config: Record<string, unknown>
): string {
  // Create a simple hash from the config to ensure deterministic naming
  const configStr = JSON.stringify(config, Object.keys(config).sort());
  const configHash = simpleHash(configStr);

  const extension = fileType === 'proxy' ? 'mp4' : 'jpg';
  return `${fileType}_${uploadId}_${configHash}.${extension}`;
}

/**
 * Simple hash function for deterministic naming
 * Not cryptographically secure, but sufficient for file naming
 */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).substring(0, 8);
}

/**
 * Helper to get file size from local path
 * Returns 1 if file not found or error to satisfy PocketBase "cannot be blank"
 */
function getFileSize(filePath: string): number {
  try {
    const stats = statSync(filePath);
    return stats.size || 1;
  } catch (error) {
    console.warn(`[Worker] Failed to get file size for ${filePath}:`, error);
    return 1;
  }
}

/**
 * Initialize PocketBase client for the worker
 * Authenticates as superuser using admin credentials
 */
async function createWorkerPocketBase(): Promise<TypedPocketBase> {
  const pb = new PocketBase(POCKETBASE_URL) as TypedPocketBase;

  // Disable autoCancellation for server-side usage
  pb.autoCancellation(false);

  // Get admin credentials from environment
  const adminEmail = env.POCKETBASE_ADMIN_EMAIL;
  const adminPassword = env.POCKETBASE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD environment variables are required'
    );
  }

  // Authenticate as superuser
  // Note: _superusers is a system collection, not in TypedPocketBase interface
  await (pb as PocketBase)
    .collection('_superusers')
    .authWithPassword(adminEmail, adminPassword, {
      autoRefreshThreshold: 30 * 60, // Auto-refresh 30 minutes before expiry
    });

  console.log('[Worker] Connected to PocketBase at:', POCKETBASE_URL);
  console.log('[Worker] Authenticated as superuser:', adminEmail);

  return pb;
}

/**
 * Process a single upload task
 *
 * This function is idempotent - it can be safely retried without creating duplicates:
 * - Checks if Media already exists for the Upload before creating
 * - Uses deterministic output naming based on uploadId and config
 * - Skips regeneration if derived assets exist with matching config
 *
 * @param pb PocketBase client
 * @param task The task to process
 */
async function processUploadTask(
  pb: TypedPocketBase,
  task: Task
): Promise<void> {
  const taskMutator = new TaskMutator(pb);
  const uploadMutator = new UploadMutator(pb);
  const mediaMutator = new MediaMutator(pb);
  const mediaClipMutator = new MediaClipMutator(pb);
  const fileMutator = new FileMutator(pb);

  try {
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
      `[Worker] Processing upload task ${task.id} for upload ${uploadId}`
    );

    // Update task status to running
    await taskMutator.update(task.id, {
      status: TaskStatus.RUNNING,
      progress: 10,
    } as Partial<Task>);

    // Update upload status to processing
    await uploadMutator.updateStatus(uploadId, UploadStatus.PROCESSING);

    // Get the upload record to access workspace
    const upload = await uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload ${uploadId} not found`);
    }

    // IDEMPOTENCY CHECK 1: Check if Media already exists for this Upload
    console.log(
      `[Worker] Checking for existing Media record (idempotency check)`
    );
    const existingMedia = await mediaMutator.getByUpload(uploadId);

    if (
      existingMedia &&
      existingMedia.thumbnailFileRef &&
      existingMedia.spriteFileRef &&
      (!transcode?.enabled || existingMedia.proxyFileRef)
    ) {
      console.log(
        `[Worker] Media record already exists with all assets: ${existingMedia.id}`
      );
      console.log(`[Worker] Skipping processing - upload already complete`);

      // Just update the upload status to ready and mark task as success
      await uploadMutator.updateStatus(uploadId, UploadStatus.READY);

      const result: ProcessUploadResult = {
        mediaId: existingMedia.id,
        thumbnailFileId: existingMedia.thumbnailFileRef,
        spriteFileId: existingMedia.spriteFileRef,
        proxyFileId: existingMedia.proxyFileRef,
        processorVersion: `cached:${existingMedia.version || 1}`,
        probeOutput:
          existingMedia.mediaData as unknown as ProcessUploadResult['probeOutput'],
      };

      await taskMutator.markSuccess(
        task.id,
        result as unknown as Record<string, unknown>
      );
      console.log(`[Worker] Task ${task.id} completed (used existing media)`);
      return;
    }

    // Get the processor based on provider
    const processorProvider = provider || ProcessingProvider.FFMPEG;
    const processor = getProcessor(processorProvider, pb);

    console.log(
      `[Worker] Using processor: ${processor.provider} v${processor.version}`
    );

    // Step 1: Probe the media file
    console.log(`[Worker] Probing media file: ${originalFileRef}`);
    await taskMutator.updateProgress(task.id, 20);
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
    // fps = total_frames / duration
    // Clamp to maximum 1fps to avoid excessive density on short videos,
    // unless you really want smooth hover on 5s video.
    // Let's cap at 1fps for now for short videos, and lower for long videos.
    let spriteFps = 1;
    if (duration > MAX_SPRITE_FRAMES) {
      spriteFps = MAX_SPRITE_FRAMES / duration;
    } else {
      spriteFps = 1;
      // For very short videos (<10s), we might get fewer than 10 frames.
      // That's fine.
    }

    const spriteConfig = sprite || {
      fps: spriteFps,
      cols: spriteCols,
      rows: spriteRows,
      tileWidth: 160,
      tileHeight: 90,
    };

    // Generate deterministic file names
    const thumbnailFileName = generateDeterministicFileName(
      uploadId,
      'thumbnail',
      thumbnailConfig as unknown as Record<string, unknown>
    );
    const spriteFileName = generateDeterministicFileName(
      uploadId,
      'sprite',
      spriteConfig as unknown as Record<string, unknown>
    );
    const proxyFileName = transcode?.enabled
      ? generateDeterministicFileName(
          uploadId,
          'proxy',
          transcode as unknown as Record<string, unknown>
        )
      : undefined;

    // IDEMPOTENCY CHECK 2: Check for existing derived assets with matching config
    console.log(`[Worker] Checking for existing derived assets`);
    const existingFiles = await fileMutator.getByUpload(uploadId);

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
          `[Worker] Proxy already exists: ${proxyFile.id}, skipping transcoding`
        );
      } else {
        console.log(`[Worker] Transcoding media`);
        await taskMutator.updateProgress(task.id, 30);

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
        proxyFile = await fileMutator.create({
          name: proxyFileName,
          size: getFileSize(transcodedPath),
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

    // Step 2: Generate thumbnail (if not exists)
    if (thumbnailFile && thumbnailFile.fileStatus === FileStatus.AVAILABLE) {
      console.log(
        `[Worker] Thumbnail already exists: ${thumbnailFile.id}, skipping generation`
      );
    } else {
      console.log(`[Worker] Generating thumbnail`);
      await taskMutator.updateProgress(task.id, 40);
      const thumbnailPath = await processor.generateThumbnail(
        originalFileRef,
        thumbnailConfig,
        uploadId
      );

      // Create thumbnail file record
      thumbnailFile = await fileMutator.create({
        name: thumbnailFileName,
        size: getFileSize(thumbnailPath),
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

    // Step 3: Generate sprite sheet (if not exists)
    if (spriteFile && spriteFile.fileStatus === FileStatus.AVAILABLE) {
      console.log(
        `[Worker] Sprite already exists: ${spriteFile.id}, skipping generation`
      );
    } else {
      console.log(`[Worker] Generating sprite sheet`);
      await taskMutator.updateProgress(task.id, 60);
      const spritePath = await processor.generateSprite(
        originalFileRef,
        spriteConfig,
        uploadId
      );

      // Create sprite file record
      spriteFile = await fileMutator.create({
        name: spriteFileName,
        size: getFileSize(spritePath),
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

    await taskMutator.updateProgress(task.id, 70);

    // Step 4: Create or update Media record (idempotent)
    console.log(`[Worker] Creating/updating Media record`);
    await taskMutator.updateProgress(task.id, 80);

    let media = existingMedia;

    if (media) {
      console.log(
        `[Worker] Media record already exists: ${media.id}, updating...`
      );
      // Update existing media record
      media = await mediaMutator.update(media.id, {
        duration: probeOutput.duration,
        mediaData: probeOutput as unknown as Record<string, unknown>,
        thumbnailFileRef: thumbnailFile.id,
        spriteFileRef: spriteFile.id,
        proxyFileRef: proxyFile?.id,
        version: (media.version || 0) + 1,
      } as Partial<typeof media>);
    } else {
      // Create new Media record
      console.log(`[Worker] Creating new Media record`);
      media = await mediaMutator.create({
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

    // Step 5: Create initial full-range MediaClip (if not exists - idempotent)
    console.log(`[Worker] Checking for full-range MediaClip`);
    await taskMutator.updateProgress(task.id, 90);

    const existingClips = await mediaClipMutator.getByMedia(media.id);
    const hasFullClip = existingClips.items.some(
      (clip) => clip.type === ClipType.FULL
    );

    if (!hasFullClip) {
      console.log(`[Worker] Creating full-range MediaClip`);
      await mediaClipMutator.create({
        WorkspaceRef: upload.WorkspaceRef,
        MediaRef: media.id,
        type: ClipType.FULL,
        start: 0,
        end: probeOutput.duration,
        duration: probeOutput.duration,
      });
    } else {
      console.log(`[Worker] Full-range MediaClip already exists, skipping`);
    }

    // Step 6: Update Upload status to ready
    console.log(`[Worker] Updating Upload status to ready`);
    await uploadMutator.updateStatus(uploadId, UploadStatus.READY);

    // Step 7: Mark task as successful
    const result: ProcessUploadResult = {
      mediaId: media.id,
      thumbnailFileId: thumbnailFile.id,
      spriteFileId: spriteFile.id,
      proxyFileId: proxyFile?.id,
      processorVersion: `${processor.provider}:${processor.version}`,
      probeOutput,
    };

    await taskMutator.markSuccess(
      task.id,
      result as unknown as Record<string, unknown>
    );
    console.log(`[Worker] Task ${task.id} completed successfully`);
  } catch (error) {
    // Handle errors with proper error types
    const uploadError = UploadError.fromError(error);
    const errorLog = createTaskErrorLog('unknown', uploadError, {
      taskId: task.id,
      uploadId: (task.payload as unknown as ProcessUploadPayload).uploadId,
    });
    const formattedError = formatTaskErrorLog(errorLog);

    console.error(`[Worker] Task ${task.id} failed:`, uploadError.message);

    // Mark task as failed and increment attempts
    await taskMutator.markFailed(task.id, formattedError);

    // Update upload status to failed
    const payload = task.payload as unknown as ProcessUploadPayload;
    await uploadMutator.updateStatus(
      payload.uploadId,
      UploadStatus.FAILED,
      uploadError.message
    );

    // Check if we should retry using exponential backoff
    const updatedTask = await taskMutator.getById(task.id);
    if (updatedTask) {
      const retryDecision = shouldRetry(
        uploadError,
        updatedTask.attempts,
        TASK_RETRY_CONFIG
      );

      if (retryDecision.shouldRetry) {
        console.log(
          `[Worker] Task ${task.id} will be retried: ${retryDecision.reason}`
        );

        // Wait for backoff delay before resetting to queued
        console.log(
          `[Worker] Waiting ${retryDecision.delayMs}ms before retry...`
        );
        await sleep(retryDecision.delayMs);

        // Reset to queued for retry
        await taskMutator.update(task.id, {
          status: TaskStatus.QUEUED,
          progress: 0,
        } as Partial<Task>);

        // Also reset upload status to uploaded for retry
        await uploadMutator.updateStatus(
          payload.uploadId,
          UploadStatus.UPLOADED
        );
      } else {
        console.log(
          `[Worker] Task ${task.id} will not be retried: ${retryDecision.reason}`
        );
      }
      console.error(`[Worker] Task ${task.id} failed:`, error);
      await taskMutator.markFailed(task.id, String(error));
    }
  }
}

/**
 * Process a label detection task
 *
 * @param pb PocketBase client
 * @param task The task to process
 */
async function processDetectLabelsTask(
  pb: TypedPocketBase,
  task: Task
): Promise<void> {
  const taskMutator = new TaskMutator(pb);
  const mediaMutator = new MediaMutator(pb);

  try {
    // Parse payload
    const payload = task.payload as unknown as DetectLabelsPayload;
    const { mediaId, fileRef, provider, config } = payload;

    console.log(
      `[Worker] Processing detect_labels task ${task.id} for media ${mediaId}`
    );

    // Update task status to running
    await taskMutator.update(task.id, {
      status: TaskStatus.RUNNING,
      progress: 10,
    } as Partial<Task>);

    // Get the media record
    const media = await mediaMutator.getById(mediaId);
    if (!media) {
      throw new Error(`Media ${mediaId} not found`);
    }

    // Get the processor
    const processorProvider =
      provider || ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE;
    const processor = getProcessor(processorProvider, pb);

    if (!processor.detectLabels) {
      throw new Error(
        `Processor ${processor.provider} does not support detectLabels`
      );
    }

    console.log(
      `[Worker] Using processor: ${processor.provider} v${processor.version}`
    );

    // Step 1: Run detection
    await taskMutator.updateProgress(task.id, 20);
    const result = await processor.detectLabels(fileRef, config);

    // Step 2: Mark task as successful
    await taskMutator.markSuccess(
      task.id,
      result as unknown as Record<string, unknown>
    );
    console.log(`[Worker] Task ${task.id} completed successfully`);
  } catch (error) {
    console.error(`[Worker] Task ${task.id} failed:`, error);
    await taskMutator.markFailed(task.id, String(error));
  }
}

/**
 * Process a single task based on its type
 * @param pb PocketBase client
 * @param task The task to process
 */
async function processTask(pb: TypedPocketBase, task: Task): Promise<void> {
  switch (task.type) {
    case TaskType.PROCESS_UPLOAD:
      await processUploadTask(pb, task);
      break;

    case TaskType.DETECT_LABELS:
      await processDetectLabelsTask(pb, task);
      break;

    case TaskType.DERIVE_CLIPS:
    case TaskType.RECOMMEND_CLIPS:
    case TaskType.RENDER_TIMELINE:
      console.log(`[Worker] Task type ${task.type} not yet implemented`);
      break;

    default:
      console.error(`[Worker] Unknown task type: ${task.type}`);
  }
}

/**
 * Main worker loop
 * Polls for queued tasks and processes them
 */
async function runWorker(): Promise<void> {
  console.log('[Worker] Starting task worker...');
  console.log(`[Worker] PocketBase URL: ${POCKETBASE_URL}`);
  console.log(`[Worker] Poll interval: ${POLL_INTERVAL_MS}ms`);

  const pb = await createWorkerPocketBase();
  const taskMutator = new TaskMutator(pb);

  // Main loop
  while (true) {
    try {
      // Get queued tasks
      const queuedTasks = await taskMutator.getQueuedTasks(
        undefined,
        1,
        10 // Process up to 10 tasks per iteration
      );

      if (queuedTasks.items.length > 0) {
        console.log(
          `[Worker] Found ${queuedTasks.items.length} queued task(s)`
        );

        // Process tasks sequentially
        for (const task of queuedTasks.items) {
          await processTask(pb, task);
        }
      } else {
        // console.log('[Worker] No queued tasks found');
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    } catch (error) {
      console.error('[Worker] Error in main loop:', error);
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

// Start the worker if this file is run directly
if (import.meta.url.endsWith(process.argv[1])) {
  runWorker().catch((error) => {
    console.error('[Worker] Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing
export { runWorker, processTask, processUploadTask };
