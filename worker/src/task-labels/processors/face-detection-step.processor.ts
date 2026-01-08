import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider, LabelType } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { FaceDetectionExecutor } from '../executors/face-detection.executor';
import { FaceDetectionNormalizer } from '../normalizers/face-detection.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { FaceDetectionStepInput } from '../types/step-inputs';
import type { FaceDetectionStepOutput } from '../types/step-outputs';
import type {
  FaceDetectionResponse,
  LabelClipData,
  LabelMediaData,
} from '../types';

// Re-export types for parent processor
export type { FaceDetectionStepInput, FaceDetectionStepOutput };

/**
 * Step processor for FACE_DETECTION in detect_labels flow
 *
 * This processor:
 * 1. Checks cache before calling executor
 * 2. Calls FaceDetectionExecutor (FACE_DETECTION)
 * 3. Calls FaceDetectionNormalizer to transform response
 * 4. Batch inserts LabelEntity records
 * 5. Batch inserts LabelTrack records (with keyframes and attributes)
 * 6. Batch inserts LabelClip records (with track references)
 * 7. Updates LabelMedia with aggregated data
 * 8. Stores normalized response to cache
 *
 * Implements cache-aware processing to avoid redundant API calls.
 */
@Injectable()
export class FaceDetectionStepProcessor extends BaseStepProcessor<
  FaceDetectionStepInput,
  FaceDetectionStepOutput
> {
  protected readonly logger = new Logger(FaceDetectionStepProcessor.name);
  private readonly processorVersion = 'face-detection:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly faceDetectionExecutor: FaceDetectionExecutor,
    private readonly faceDetectionNormalizer: FaceDetectionNormalizer,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process face detection with cache awareness
   */
  async process(
    input: FaceDetectionStepInput,
    _job: Job<StepJobData>
  ): Promise<FaceDetectionStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing face detection for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Step 1: Check cache before calling executor
      const cached = await this.labelCacheService.getCachedLabels(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        this.processorVersion
      );

      let response: FaceDetectionResponse;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached face detection for media ${input.mediaId}`
        );
        response = cached.response as FaceDetectionResponse;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Face Detection API`
        );

        response = await this.faceDetectionExecutor.execute(
          input.workspaceRef,
          input.mediaId,
          input.config
        );

        // Step 8: Store normalized response to cache
        await this.labelCacheService.storeLabelCache(
          input.mediaId,
          input.version,
          ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          response,
          this.processorVersion,
          ['FACE_DETECTION']
        );

        this.logger.log(
          `Face detection completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response
      const normalizedData = await this.faceDetectionNormalizer.normalize({
        response,
        mediaId: input.mediaId,
        workspaceRef: input.workspaceRef,
        taskRef: input.taskRef,
        version: input.version,
        processor: 'face-detection', // Processor type identifier
        processorVersion: this.processorVersion, // Processor version string
      });

      // Step 4: Batch insert LabelEntity records
      const entityIds = await this.batchInsertLabelEntities(
        normalizedData.labelEntities
      );
      this.logger.debug(
        `Inserted ${entityIds.length} label entities for media ${input.mediaId}`
      );

      // Step 5: Batch insert LabelTrack records (with keyframes and attributes)
      // TODO: Uncomment when LabelTrackMutator is created (task 2)
      // const trackIds = await this.batchInsertLabelTracks(
      //   normalizedData.labelTracks
      // );
      const trackIds: string[] = []; // Placeholder until LabelTrackMutator exists
      this.logger.debug(
        `Inserted ${trackIds.length} label tracks for media ${input.mediaId}`
      );

      // Step 6: Batch insert LabelClip records (with track references)
      // Face detection creates a single "Face" entity, so all clips reference it
      const entityId = entityIds.length > 0 ? entityIds[0] : undefined;
      const clipIds = await this.batchInsertLabelClips(
        normalizedData.labelClips,
        entityId
      );
      this.logger.debug(
        `Inserted ${clipIds.length} label clips for media ${input.mediaId}`
      );

      // Step 7: Update LabelMedia with aggregated data
      await this.updateLabelMedia(
        input.mediaId,
        normalizedData.labelMediaUpdate
      );
      this.logger.debug(`Updated LabelMedia for media ${input.mediaId}`);

      // Clear entity cache after processing
      this.labelEntityService.clearCache();

      const processingTimeMs = Date.now() - startTime;

      return {
        success: true,
        cacheHit,
        processorVersion: this.processorVersion,
        processingTimeMs,
        counts: {
          faceCount: normalizedData.labelMediaUpdate.faceCount || 0,
          faceTrackCount: normalizedData.labelMediaUpdate.faceTrackCount || 0,
          labelEntityCount: entityIds.length,
          labelTrackCount: trackIds.length,
          labelClipCount: clipIds.length,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Face detection failed for media ${input.mediaId}: ${errorMessage}`
      );

      return {
        success: false,
        cacheHit: false,
        processorVersion: this.processorVersion,
        processingTimeMs: Date.now() - startTime,
        error: errorMessage,
        counts: {
          faceCount: 0,
          faceTrackCount: 0,
          labelEntityCount: 0,
          labelTrackCount: 0,
          labelClipCount: 0,
        },
      };
    }
  }

  /**
   * Batch insert LabelEntity records
   * Uses LabelEntityService for deduplication
   */
  private async batchInsertLabelEntities(
    entities: Array<{
      WorkspaceRef: string;
      labelType: LabelType;
      canonicalName: string;
      provider: ProcessingProvider;
      processor: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<string[]> {
    const entityIds: string[] = [];

    for (const entity of entities) {
      // Face detection always uses GOOGLE_VIDEO_INTELLIGENCE
      const provider = entity.provider as
        | ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
        | ProcessingProvider.GOOGLE_SPEECH;
      const entityId = await this.labelEntityService.getOrCreateLabelEntity(
        entity.WorkspaceRef,
        entity.labelType,
        entity.canonicalName,
        provider,
        entity.processor,
        entity.metadata
      );
      entityIds.push(entityId);
    }

    return entityIds;
  }

  /**
   * Batch insert LabelTrack records
   * Inserts in batches of 100 for performance
   *
   * TODO: Uncomment when LabelTrackMutator is created (task 2)
   */
  // private async batchInsertLabelTracks(tracks: Array<any>): Promise<string[]> {
  //   const trackIds: string[] = [];
  //   const batchSize = 100;

  //   for (let i = 0; i < tracks.length; i += batchSize) {
  //     const batch = tracks.slice(i, i + batchSize);

  //     for (const track of batch) {
  //       try {
  //         const created = await this.labelTrackMutator.create(track);
  //         trackIds.push(created.id);
  //       } catch (error) {
  //         // Log error but continue with other tracks
  //         this.logger.warn(
  //           `Failed to insert label track: ${error instanceof Error ? error.message : String(error)}`
  //         );
  //       }
  //     }

  //     this.logger.debug(
  //       `Inserted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} tracks`
  //     );
  //   }

  //   return trackIds;
  // }

  /**
   * Batch insert LabelClip records
   * Inserts in batches of 100 for performance
   * Handles duplicate labelHash by checking for existing records first
   * Filters out invalid clips before insertion
   * Sets LabelEntityRef on clips if entityId is provided
   */
  private async batchInsertLabelClips(
    clips: LabelClipData[],
    entityId?: string
  ): Promise<string[]> {
    // Filter out invalid clips before processing
    const validClips = clips.filter((clip) => this.isValidLabelClip(clip));

    if (validClips.length < clips.length) {
      this.logger.warn(
        `Filtered out ${clips.length - validClips.length} invalid label clips`
      );
    }

    const clipIds: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < validClips.length; i += batchSize) {
      const batch = validClips.slice(i, i + batchSize);
      let insertedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const clip of batch) {
        try {
          // Check if a clip with this labelHash already exists
          const existing =
            await this.pocketBaseService.labelClipMutator.getList(
              1,
              1,
              `labelHash = "${clip.labelHash}"`
            );

          if (existing.items.length > 0) {
            // Clip already exists, use existing ID
            clipIds.push(existing.items[0].id);
            skippedCount++;
            this.logger.debug(
              `Skipped duplicate label clip with hash ${clip.labelHash}`
            );
          } else {
            // Clip doesn't exist, create it
            // Set LabelEntityRef if entityId is provided
            const created =
              await this.pocketBaseService.labelClipMutator.create({
                ...clip,
                LabelEntityRef: entityId || clip.LabelEntityRef,
                provider: clip.provider as
                  | ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
                  | ProcessingProvider.GOOGLE_SPEECH,
              });
            clipIds.push(created.id);
            insertedCount++;
          }
        } catch (error) {
          // Check if this is a unique constraint error (race condition)
          if (this.isUniqueConstraintError(error)) {
            // Try to fetch the existing record
            try {
              const existing =
                await this.pocketBaseService.labelClipMutator.getList(
                  1,
                  1,
                  `labelHash = "${clip.labelHash}"`
                );
              if (existing.items.length > 0) {
                clipIds.push(existing.items[0].id);
                skippedCount++;
                this.logger.debug(
                  `Resolved duplicate label clip with hash ${clip.labelHash} (race condition)`
                );
              } else {
                // Shouldn't happen, but log it
                this.logger.warn(
                  `Unique constraint error for labelHash ${clip.labelHash} but record not found`
                );
                errorCount++;
              }
            } catch (fetchError) {
              this.logger.error(
                `Failed to fetch existing label clip after unique constraint error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
              );
              errorCount++;
            }
          } else {
            // Some other error occurred
            this.logger.error(
              `Failed to insert label clip: ${error instanceof Error ? error.message : String(error)}`
            );
            errorCount++;
          }
        }
      }

      this.logger.debug(
        `Batch ${Math.floor(i / batchSize) + 1}: Inserted ${insertedCount}, skipped ${skippedCount} duplicate clips, ${errorCount} errors`
      );
    }

    return clipIds;
  }

  /**
   * Check if a label clip is valid before insertion
   *
   * @param clip The clip to validate
   * @returns True if the clip is valid
   */
  private isValidLabelClip(clip: LabelClipData): boolean {
    // Check required fields
    if (!clip.labelHash || clip.labelHash.trim().length === 0) {
      return false;
    }
    if (!clip.WorkspaceRef || clip.WorkspaceRef.trim().length === 0) {
      return false;
    }
    if (!clip.MediaRef || clip.MediaRef.trim().length === 0) {
      return false;
    }

    // Check time values
    if (
      typeof clip.start !== 'number' ||
      clip.start < 0 ||
      !Number.isFinite(clip.start)
    ) {
      return false;
    }
    if (
      typeof clip.end !== 'number' ||
      clip.end < 0 ||
      !Number.isFinite(clip.end)
    ) {
      return false;
    }

    // End must be greater than start
    if (clip.end <= clip.start) {
      return false;
    }

    // Check duration (should be positive and match end - start)
    // Must be at least 0.5 seconds (matching normalizer's MIN_CLIP_DURATION)
    if (
      typeof clip.duration !== 'number' ||
      clip.duration < 0.5 ||
      !Number.isFinite(clip.duration)
    ) {
      return false;
    }

    // Check confidence (must be between 0 and 1, and at least 0.5)
    // Matching normalizer's MIN_CLIP_CONFIDENCE
    if (
      typeof clip.confidence !== 'number' ||
      clip.confidence < 0.5 ||
      clip.confidence > 1 ||
      !Number.isFinite(clip.confidence)
    ) {
      return false;
    }

    // Check that trackId is not empty (if present in labelData)
    if (clip.labelData && typeof clip.labelData === 'object') {
      const labelData = clip.labelData as Record<string, unknown>;
      const trackId = labelData.trackId;
      if (
        trackId !== undefined &&
        (!trackId || String(trackId).trim().length === 0)
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if an error is a unique constraint violation
   *
   * @param error The error to check
   * @returns True if the error is a unique constraint violation
   */
  private isUniqueConstraintError(error: unknown): boolean {
    if (!error) return false;

    // Check for PocketBase error structure
    if (typeof error === 'object' && 'data' in error) {
      const data = (error as { data?: { labelHash?: { code?: string } } }).data;
      if (data?.labelHash?.code === 'validation_not_unique') {
        return true;
      }
    }

    // Check error message
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('unique constraint') ||
      message.includes('UNIQUE constraint') ||
      message.includes('validation_not_unique') ||
      message.includes('labelHash')
    );
  }

  /**
   * Update LabelMedia with aggregated data
   */
  private async updateLabelMedia(
    mediaId: string,
    update: Partial<LabelMediaData>
  ): Promise<void> {
    try {
      // Try to get existing LabelMedia record
      const existing = await this.pocketBaseService.labelMediaMutator.getList(
        1,
        1,
        `MediaRef = "${mediaId}"`
      );

      if (existing.items.length > 0) {
        // Update existing record
        await this.pocketBaseService.labelMediaMutator.update(
          existing.items[0].id,
          update
        );
      } else {
        // Create new record
        await this.pocketBaseService.labelMediaMutator.create({
          MediaRef: mediaId,
          ...update,
        });
      }
    } catch (error) {
      this.logger.error(
        `Failed to update LabelMedia for media ${mediaId}: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }
}
