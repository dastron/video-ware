import { Injectable, Logger } from '@nestjs/common';
import { PocketBaseService } from '../../../shared/services/pocketbase.service';
import { StorageService } from '../../../shared/services/storage.service';
import type { IResolveClipsExecutor, ResolveClipsResult } from '../interfaces';
import type { RenderTimelinePayload, Media } from '@project/shared';

/**
 * FFmpeg-based executor for resolving clip media files
 * Pure operation - resolves file paths for timeline clips
 */
@Injectable()
export class FFmpegResolveClipsExecutor implements IResolveClipsExecutor {
  private readonly logger = new Logger(FFmpegResolveClipsExecutor.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService
  ) {}

  async execute(
    timelineId: string,
    editList: RenderTimelinePayload['editList']
  ): Promise<ResolveClipsResult> {
    this.logger.log(`Resolving clips for timeline ${timelineId}`);

    // Get timeline clips
    const timelineClips =
      await this.pocketbaseService.getTimelineClips(timelineId);
    if (!timelineClips || timelineClips.length === 0) {
      throw new Error(`No clips found for timeline ${timelineId}`);
    }

    const clipMediaMap: Record<string, { media: Media; filePath: string }> = {};

    for (const clip of timelineClips) {
      try {
        // Get media record for the clip
        const media = await this.pocketbaseService.getMedia(clip.MediaRef);
        if (!media) {
          throw new Error(
            `Media ${clip.MediaRef} not found for clip ${clip.id}`
          );
        }

        // Get the source file (prefer proxy, fallback to original upload)
        let sourceFileId = media.proxyFileRef;
        if (!sourceFileId) {
          // Get original upload and find associated file
          const upload = await this.pocketbaseService.getUploadByMedia(
            media.id
          );
          if (!upload) {
            throw new Error(`No upload found for media ${media.id}`);
          }

          // Find file record associated with this upload
          const files = await this.pocketbaseService.fileMutator.getByUpload(
            upload.id,
            1,
            1
          );
          if (!files.items || files.items.length === 0) {
            throw new Error(`No source file found for upload ${upload.id}`);
          }
          sourceFileId = files.items[0].id;
        }

        if (!sourceFileId) {
          throw new Error(`No source file ID found for media ${media.id}`);
        }

        // Get file record and resolve path
        const fileRecord = await this.pocketbaseService.getFile(sourceFileId);
        if (!fileRecord) {
          throw new Error(`File ${sourceFileId} not found`);
        }

        if (!fileRecord.s3Key) {
          throw new Error(`File ${fileRecord.id} has no storage path (s3Key)`);
        }

        const fileSource = Array.isArray(fileRecord.fileSource)
          ? fileRecord.fileSource[0]
          : fileRecord.fileSource;

        const filePath = await this.storageService.resolveFilePath({
          storagePath: fileRecord.s3Key,
          fileSource: fileSource,
          recordId: fileRecord.id,
        });

        clipMediaMap[clip.id] = { media, filePath };
        this.logger.debug(`Resolved media for clip ${clip.id}: ${filePath}`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to resolve media for clip ${clip.id}: ${errorMessage}`
        );
        throw error;
      }
    }

    this.logger.log(`Resolved ${Object.keys(clipMediaMap).length} clips`);
    return { clipMediaMap };
  }
}
