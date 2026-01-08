import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';
import type {
  ResolveClipsStepInput,
  ResolveClipsOutput,
} from '../types/step-inputs';
import type { Media, TimelineClip } from '@project/shared';

/**
 * Processor for the RESOLVE_CLIPS step
 * Resolves media files for all timeline clips
 */
@Injectable()
export class ResolveClipsStepProcessor extends BaseStepProcessor<
  ResolveClipsStepInput,
  ResolveClipsOutput
> {
  protected readonly logger = new Logger(ResolveClipsStepProcessor.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService
  ) {
    super();
  }

  async process(
    input: ResolveClipsStepInput,
    job: Job<StepJobData>
  ): Promise<ResolveClipsOutput> {
    this.logger.log(`Resolving clips for timeline ${input.timelineId}`);

    // Get timeline clips
    const timelineClips = await this.pocketbaseService.getTimelineClips(
      input.timelineId
    );

    if (!timelineClips || timelineClips.length === 0) {
      throw new Error(`No clips found for timeline ${input.timelineId}`);
    }

    this.logger.log(
      `Found ${timelineClips.length} clips for timeline ${input.timelineId}`
    );

    // Resolve media files for each clip
    const clipMediaMap: Record<string, { media: Media; filePath: string }> = {};
    const progressPerClip = 60 / timelineClips.length;

    for (let i = 0; i < timelineClips.length; i++) {
      const clip = timelineClips[i];
      const clipMedia = await this.resolveClipMedia(clip);
      clipMediaMap[clip.id] = clipMedia;

      const progress = 30 + (i + 1) * progressPerClip;
      this.logger.debug(progress);
    }

    this.logger.log(
      `Resolved ${Object.keys(clipMediaMap).length} clip media files`
    );

    return { clipMediaMap };
  }

  /**
   * Resolve media file for a single timeline clip
   */
  private async resolveClipMedia(
    clip: TimelineClip
  ): Promise<{ media: Media; filePath: string }> {
    try {
      // Get media record for the clip
      const media = await this.pocketbaseService.getMedia(clip.MediaRef);
      if (!media) {
        throw new Error(`Media ${clip.MediaRef} not found for clip ${clip.id}`);
      }

      // Get the source file (prefer proxy, fallback to original upload)
      let sourceFileId = media.proxyFileRef;
      if (!sourceFileId) {
        // Get original upload and find associated file
        const upload = await this.pocketbaseService.getUploadByMedia(media.id);
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

      this.logger.debug(`Resolved media for clip ${clip.id}: ${filePath}`);

      return { media, filePath };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to resolve media for clip ${clip.id}: ${errorMessage}`
      );
      throw error;
    }
  }
}
