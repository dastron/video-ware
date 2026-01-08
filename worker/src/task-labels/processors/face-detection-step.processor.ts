import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { FaceDetectionExecutor } from '../executors/face-detection.executor';
import { FaceDetectionNormalizer } from '../normalizers/face-detection.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { FaceDetectionStepInput } from '../types/step-inputs';
import type { FaceDetectionStepOutput } from '../types/step-outputs';

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

  private labelClipMutator: any;
  private labelTrackMutator: any;
  private labelMediaMutator: any;

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
   * Initialize mutators after module initialization
   */
  async onModuleInit() {
    const sharedModule = await (eval(`import('@project/shared')`) as Promise<
      typeof import('@project/shared')
    >);

    this.labelClipMutator = new sharedModule.LabelClipMutator(
      this.pocketBaseService.getClient()
    );
    // TODO: LabelTrackMutator needs to be created in shared package (task 2)
    // this.labelTrackMutator = new sharedModule.LabelTrackMutator(
    //   this.pocketBaseService.getClient()
    // );
    this.labelMediaMutator = new sharedModule.MediaLabelMutator(
      this.pocketBaseService.getClient()
    );

    this.logger.log('FaceDetectionStepProcessor initialized');
  }

  /**
   * Process face detection with cache awareness
   */
  async process(
    input: FaceDetectionStepInput,
    job: Job<StepJobData>
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
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      );

      let response: any;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached face detection for media ${input.mediaId}`
        );
        response = cached.response;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Face Detection API`
        );

        response = await this.faceDetectionExecutor.execute(
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
          const created = await this.labelClipMutator.create(clip);
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
      const existing = await this.labelMediaMutator.getList(
        1,
        1,
        `MediaRef = "${mediaId}"`
      );

      if (existing.items.length > 0) {
        // Update existing record
        await this.labelMediaMutator.update(existing.items[0].id, update);
      } else {
        // Create new record
        await this.labelMediaMutator.create({
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
