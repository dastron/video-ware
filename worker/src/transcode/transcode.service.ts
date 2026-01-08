import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { StorageService } from '../shared/services/storage.service';
import { FFmpegStrategy } from './strategies/ffmpeg.strategy';
import { GoogleTranscoderStrategy } from './strategies/google-transcoder.strategy';
import { FlowService } from '../queue/flow.service';
import type {
  Task,
  ProcessUploadPayload,
  ProcessUploadResult,
  Upload,
  Media,
} from '@project/shared';
import {
  StorageBackendType,
  MediaType,
  FileType,
  FileSource,
} from '@project/shared';

@Injectable()
export class TranscodeService {
  private readonly logger = new Logger(TranscodeService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService,
    private readonly ffmpegStrategy: FFmpegStrategy,
    private readonly googleTranscoderStrategy: GoogleTranscoderStrategy,
    private readonly flowService: FlowService
  ) {}

  /**
   * Process a transcode task using the new flow-based architecture
   * Creates a parent-child job flow instead of monolithic processing
   */
  async processTask(task: Task): Promise<string> {
    const payload = task.payload as ProcessUploadPayload;
    this.logger.log(
      `Creating transcode flow for task ${task.id}, upload ${payload.uploadId}`
    );

    // Create the flow using FlowService
    const parentJobId = await this.flowService.createTranscodeFlow(task);

    this.logger.log(
      `Transcode flow created for task ${task.id}, parent job: ${parentJobId}`
    );

    return parentJobId;
  }

  /**
   * Legacy method for backward compatibility
   * This will be removed once all callers are updated to use the flow-based approach
   * @deprecated Use processTask instead
   */
  async processTaskLegacy(
    task: Task,
    progressCallback: (progress: number) => void
  ): Promise<ProcessUploadResult> {
    const payload = task.payload as ProcessUploadPayload;
    const { uploadId, provider } = payload;

    this.logger.log(
      `Processing upload ${uploadId} with provider ${provider} (legacy mode)`
    );

    // Select strategy based on provider
    const strategy = this.selectStrategy(provider);

    // Get upload record
    const upload = await this.pocketbaseService.uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload ${uploadId} not found`);
    }

    // Check for existing media (idempotency)
    const existingMedia =
      await this.pocketbaseService.mediaMutator.getByUpload(uploadId);
    if (existingMedia && this.isMediaComplete(existingMedia, payload)) {
      this.logger.log(`Media already exists for upload ${uploadId}, skipping`);
      return {
        mediaId: existingMedia.id,
        thumbnailFileId: existingMedia.thumbnailFileRef || undefined,
        spriteFileId: existingMedia.spriteFileRef || undefined,
        proxyFileId: existingMedia.proxyFileRef || undefined,
        processorVersion:
          (existingMedia.mediaData as any)?.processorVersion || undefined,
      };
    }

    // Resolve file path - get storage path from upload or associated file
    let storagePath = upload.externalPath;
    let storageBackend = upload.storageBackend as
      | StorageBackendType
      | undefined;

    // If no externalPath on upload, try to get from associated file
    if (!storagePath) {
      const files = await this.pocketbaseService.fileMutator.getByUpload(
        uploadId,
        1,
        1
      );
      if (files.items && files.items.length > 0) {
        const file = files.items[0];
        storagePath = file.s3Key || undefined;
        if (!storageBackend && file.fileSource) {
          // Map FileSource to StorageBackendType
          const fileSource = Array.isArray(file.fileSource)
            ? file.fileSource[0]
            : file.fileSource;
          storageBackend =
            fileSource === FileSource.POCKETBASE
              ? StorageBackendType.LOCAL
              : fileSource === FileSource.S3
                ? StorageBackendType.S3
                : undefined;
        }
      }
    }

    if (!storagePath) {
      throw new Error(`No storage path found for upload ${uploadId}`);
    }

    const filePath = await this.storageService.resolveFilePath({
      storagePath,
      storageBackend,
      recordId: uploadId,
    });

    // Process with strategy
    progressCallback(20);
    const result = await strategy.process(filePath, payload, progressCallback);

    // Create file records and media record
    progressCallback(85);
    const media = await this.createMediaRecord(upload, result, payload);

    progressCallback(100);

    // Convert Media to ProcessUploadResult
    return {
      mediaId: media.id,
      thumbnailFileId: media.thumbnailFileRef || undefined,
      spriteFileId: media.spriteFileRef || undefined,
      proxyFileId: media.proxyFileRef || undefined,
    };
  }

  private selectStrategy(provider?: string) {
    const enableGoogleTranscoder = this.configService.get(
      'processors.enableGoogleTranscoder'
    );

    if (provider === 'google-transcoder' && enableGoogleTranscoder) {
      return this.googleTranscoderStrategy;
    }

    return this.ffmpegStrategy;
  }

  private isMediaComplete(
    media: Media,
    payload: ProcessUploadPayload
  ): boolean {
    return !!(
      media.thumbnailFileRef &&
      media.spriteFileRef &&
      (!payload.transcode?.enabled || media.proxyFileRef)
    );
  }

  /**
   * Create media record with file references
   */
  private async createMediaRecord(
    upload: Upload,
    result: {
      probeOutput: any;
      thumbnailPath?: string;
      spritePath?: string;
      proxyPath?: string;
    },
    _payload: ProcessUploadPayload
  ): Promise<Media> {
    const probeOutput = result.probeOutput;

    // Determine media type from probe output
    const mediaType: MediaType =
      probeOutput.width && probeOutput.height
        ? MediaType.VIDEO
        : MediaType.AUDIO;

    // Create file records for generated assets
    const filePromises: Promise<{ type: string; file: any }>[] = [];

    // Create thumbnail file
    if (result.thumbnailPath) {
      filePromises.push(
        this.createFileRecord(
          result.thumbnailPath,
          `thumbnail_${upload.id}.jpg`,
          FileType.THUMBNAIL,
          upload.WorkspaceRef,
          upload.id,
          'image/jpeg'
        ).then((file) => ({ type: 'thumbnail', file }))
      );
    }

    // Create sprite file
    if (result.spritePath) {
      filePromises.push(
        this.createFileRecord(
          result.spritePath,
          `sprite_${upload.id}.jpg`,
          FileType.SPRITE,
          upload.WorkspaceRef,
          upload.id,
          'image/jpeg'
        ).then((file) => ({ type: 'sprite', file }))
      );
    }

    // Create proxy file if transcoded
    if (result.proxyPath) {
      filePromises.push(
        this.createFileRecord(
          result.proxyPath,
          `proxy_${upload.id}.mp4`,
          FileType.PROXY,
          upload.WorkspaceRef,
          upload.id,
          'video/mp4'
        ).then((file) => ({ type: 'proxy', file }))
      );
    }

    // Wait for all files to be created
    const fileResults = await Promise.all(filePromises);
    const filesByType = fileResults.reduce(
      (acc, { type, file }) => {
        acc[type] = file;
        return acc;
      },
      {} as Record<string, { id: string }>
    );

    // Build media data
    const mediaData = {
      name: upload.name,
      width: probeOutput.width,
      height: probeOutput.height,
      fps: probeOutput.fps,
      codec: probeOutput.codec,
      bitrate: probeOutput.bitrate,
      size: probeOutput.size,
      probeOutput: probeOutput,
      processorVersion: `nestjs-worker:${process.env.npm_package_version || '1.0.0'}`,
    };

    // Create or update media record
    const existingMedia = await this.pocketbaseService.mediaMutator.getByUpload(
      upload.id
    );

    if (existingMedia) {
      // Update existing media
      return await this.pocketbaseService.mediaMutator.update(
        existingMedia.id,
        {
          mediaData,
          thumbnailFileRef:
            filesByType.thumbnail?.id || existingMedia.thumbnailFileRef,
          spriteFileRef: filesByType.sprite?.id || existingMedia.spriteFileRef,
          proxyFileRef: filesByType.proxy?.id || existingMedia.proxyFileRef,
        }
      );
    } else {
      // Create new media record
      return await this.pocketbaseService.createMedia({
        WorkspaceRef: upload.WorkspaceRef,
        UploadRef: upload.id,
        mediaType,
        duration: probeOutput.duration,
        mediaData,
        thumbnailFileRef: filesByType.thumbnail?.id,
        spriteFileRef: filesByType.sprite?.id,
        proxyFileRef: filesByType.proxy?.id,
        version: 1,
      });
    }
  }

  /**
   * Create a file record and upload to storage
   */
  private async createFileRecord(
    localFilePath: string,
    fileName: string,
    fileType: FileType,
    workspaceRef: string,
    uploadRef: string,
    mimeType: string
  ): Promise<{ id: string }> {
    // Generate storage key
    const storageKey = `uploads/${workspaceRef}/${uploadRef}/${fileName}`;

    // Determine file source from configured backend (default to S3 for now)
    // TODO: Get backend type from storage service properly
    const fileSource = FileSource.S3;

    // Upload file to storage and create file record
    return await this.pocketbaseService.createFileWithUpload({
      localFilePath,
      fileName,
      fileType,
      fileSource,
      storageKey,
      workspaceRef,
      uploadRef,
      mimeType,
    });
  }
}
