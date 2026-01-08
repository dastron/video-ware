import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { ObjectTrackingExecutor } from '../executors/object-tracking.executor';
import { ObjectTrackingNormalizer } from '../normalizers/object-tracking.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { ObjectTrackingStepInput } from '../types/step-inputs';
import type { ObjectTrackingStepOutput } from '../types/step-outputs';

// Re-export types for parent processor
export type { ObjectTrackingStepInput, ObjectTrackingStepOutput };

/**
 * Step processor for OBJECT_TRACKING in detect_labels flow
 *
 * This processor:
 * 1. Checks cache before calling executor
 * 2. Calls ObjectTrackingExecutor (OBJECT_TRACKING)
 * 3. Calls ObjectTrackingNormalizer to transform response
 * 4. Batch inserts LabelEntity records
 * 5. Batch inserts LabelTrack records (with keyframes)
 * 6. Batch inserts LabelClip records (with track references)
 * 7. Updates LabelMedia with aggregated data
 * 8. Stores normalized response to cache
 *
 * Implements cache-aware processing to avoid redundant API calls.
 */
@Injectable()
export class ObjectTrackingStepProcessor extends BaseStepProcessor<
  ObjectTrackingStepInput,
  ObjectTrackingStepOutput
> {
  protected readonly logger = new Logger(ObjectTrackingStepProcessor.name);
  private readonly processorVersion = 'object-tracking:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly objectTrackingExecutor: ObjectTrackingExecutor,
    private readonly objectTrackingNormalizer: ObjectTrackingNormalizer,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process object tracking with cache awareness
   */
  async process(
    input: ObjectTrackingStepInput,
    _job: Job<StepJobData>
  ): Promise<ObjectTrackingStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing object tracking for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Step 1: Check cache before calling executor
      const cached = await this.labelCacheService.getCachedLabels(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      );

      let response: any;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached object tracking for media ${input.mediaId}`
        );
        response = cached.response;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Object Tracking API`
        );

        response = await this.objectTrackingExecutor.execute(
          input.gcsUri,
          input.config
        );

        // Step 8: Store normalized response to cache
        await this.labelCacheService.storeLabelCache(
          input.mediaId,
          input.version,
          ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          response,
          this.processorVersion,
          ['OBJECT_TRACKING']
        );

        this.logger.log(
          `Object tracking completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response
      const normalizedData = await this.objectTrackingNormalizer.normalize({
        response,
        mediaId: input.mediaId,
        workspaceRef: input.workspaceRef,
        taskRef: input.taskRef,
        version: input.version,
        processor: 'object-tracking', // Processor type identifier
        processorVersion: this.processorVersion, // Processor version string
      });

      // Step 4: Batch insert LabelEntity records
      const entityIds = await this.batchInsertLabelEntities(
        normalizedData.labelEntities
      );
      this.logger.debug(
        `Inserted ${entityIds.length} label entities for media ${input.mediaId}`
      );

      // Step 5: Batch insert LabelTrack records (with keyframes)
      // TODO: Uncomment when LabelTrackMutator is created (task 2)
      // const trackIds = await this.batchInsertLabelTracks(
      //   normalizedData.labelTracks
      // );
      const trackIds: string[] = []; // Placeholder until LabelTrackMutator exists
      this.logger.debug(
        `Inserted ${trackIds.length} label tracks for media ${input.mediaId}`
      );

      // Step 6: Batch insert LabelClip records (with track references)
      const clipIds = await this.batchInsertLabelClips(
        normalizedData.labelClips
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
          objectCount: normalizedData.labelMediaUpdate.objectCount || 0,
          objectTrackCount:
            normalizedData.labelMediaUpdate.objectTrackCount || 0,
          labelEntityCount: entityIds.length,
          labelTrackCount: trackIds.length,
          labelClipCount: clipIds.length,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Object tracking failed for media ${input.mediaId}: ${errorMessage}`
      );

      return {
        success: false,
        cacheHit: false,
        processorVersion: this.processorVersion,
        processingTimeMs: Date.now() - startTime,
        error: errorMessage,
        counts: {
          objectCount: 0,
          objectTrackCount: 0,
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
      labelType: any;
      canonicalName: string;
      provider: any;
      processor: string;
      metadata?: Record<string, unknown>;
    }>
  ): Promise<string[]> {
    const entityIds: string[] = [];

    for (const entity of entities) {
      const entityId = await this.labelEntityService.getOrCreateLabelEntity(
        entity.WorkspaceRef,
        entity.labelType,
        entity.canonicalName,
        entity.provider,
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
   */
  private async batchInsertLabelClips(clips: Array<any>): Promise<string[]> {
    const clipIds: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < clips.length; i += batchSize) {
      const batch = clips.slice(i, i + batchSize);

      for (const clip of batch) {
        try {
          const created =
            await this.pocketBaseService.labelClipMutator.create(clip);
          clipIds.push(created.id);
        } catch (error) {
          // Log error but continue with other clips
          this.logger.warn(
            `Failed to insert label clip: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      this.logger.debug(
        `Inserted batch ${Math.floor(i / batchSize) + 1}: ${batch.length} clips`
      );
    }

    return clipIds;
  }

  /**
   * Update LabelMedia with aggregated data
   */
  private async updateLabelMedia(
    mediaId: string,
    update: Record<string, any>
  ): Promise<void> {
    try {
      // Try to get existing LabelMedia record
      const existing = await this.pocketBaseService.mediaLabelMutator.getList(
        1,
        1,
        `MediaRef = "${mediaId}"`
      );

      if (existing.items.length > 0) {
        // Update existing record
        await this.pocketBaseService.mediaLabelMutator.update(
          existing.items[0].id,
          update
        );
      } else {
        // Create new record
        await this.pocketBaseService.mediaLabelMutator.create({
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
