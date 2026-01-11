import { Injectable, Logger } from '@nestjs/common';
import { PocketBaseService } from '../../../shared/services/pocketbase.service';
import { StorageService } from '../../../shared/services/storage.service';
import type { IPrepareExecutor, ResolveClipsResult } from '../interfaces';
import type { RenderTimelinePayload, Media } from '@project/shared';

/**
 * FFmpeg-based executor for resolving clip media files
 * Pure operation - resolves file paths for timeline clips
 */
@Injectable()
export class FFmpegResolveClipsExecutor implements IPrepareExecutor {
  private readonly logger = new Logger(FFmpegResolveClipsExecutor.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService
  ) {}

  async execute(
    timelineId: string,
    tracks: RenderTimelinePayload['tracks']
  ): Promise<ResolveClipsResult> {
    this.logger.log(`Resolving media for timeline ${timelineId} render`);

    // Extract all unique media IDs from the tracks
    const mediaIds = new Set<string>();
    for (const track of tracks) {
      for (const segment of track.segments) {
        if (segment.assetId) {
          mediaIds.add(segment.assetId);
        }
      }
    }

    if (mediaIds.size === 0) {
      throw new Error(`No media found in tracks for timeline ${timelineId}`);
    }

    this.logger.debug(`Need to resolve ${mediaIds.size} unique media files`);

    const clipMediaMap: Record<string, { media: Media; filePath: string }> = {};

    for (const mediaId of mediaIds) {
      try {
        // Get media record
        const media = await this.pocketbaseService.getMedia(mediaId);
        if (!media) {
          throw new Error(`Media ${mediaId} not found`);
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

        // Use mediaId as the key for easier lookup in the compose executor
        clipMediaMap[mediaId] = { media, filePath };
        this.logger.debug(`Resolved media ${mediaId}: ${filePath}`);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to resolve media ${mediaId}: ${errorMessage}`
        );
        throw error;
      }
    }

    this.logger.log(
      `Successfully resolved ${Object.keys(clipMediaMap).length} media files`
    );
    return { clipMediaMap };
  }
}
