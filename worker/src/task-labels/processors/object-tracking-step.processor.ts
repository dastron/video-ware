import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { LabelType, ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { ObjectTrackingExecutor } from '../executors/object-tracking.executor';
import { ObjectTrackingNormalizer } from '../normalizers/object-tracking.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { ObjectTrackingStepInput } from '../types/step-inputs';
import type { ObjectTrackingStepOutput } from '../types/step-outputs';
import type {
  ObjectTrackingResponse,
  LabelTrackData,
  LabelObjectData,
} from '../types';

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
        input.workspaceRef,
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        this.processorVersion
      );

      let response: ObjectTrackingResponse;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached object tracking for media ${input.mediaId}`
        );
        response = cached.response as ObjectTrackingResponse;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Object Tracking API`
        );

        response = await this.objectTrackingExecutor.execute(
          input.workspaceRef,
          input.mediaId,
          input.config
        );

        // Step 8: Store normalized response to cache
        await this.labelCacheService.storeLabelCache(
          input.workspaceRef,
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
        processor: 'object-tracking',
        processorVersion: this.processorVersion,
      });

      // Step 4: Batch insert LabelEntity records
      const entityIds = await this.batchInsertLabelEntities(
        normalizedData.labelEntities
      );
      this.logger.debug(
        `Inserted ${entityIds.length} label entities for media ${input.mediaId}`
      );

      // Step 5: Batch insert LabelTrack records (with keyframes)
      const trackIdMap = await this.batchInsertLabelTracks(
        normalizedData.labelTracks
      );
      this.logger.debug(
        `Inserted ${Object.keys(trackIdMap).length} label tracks for media ${input.mediaId}`
      );

      // Step 6: Batch insert LabelObject records
      const objectIds = await this.batchInsertLabelObjects(
        normalizedData.labelObjects || [],
        trackIdMap
      );
      this.logger.debug(
        `Inserted ${objectIds.length} label objects for media ${input.mediaId}`
      );

      // Clear entity cache after processing
      this.labelEntityService.clearCache();

      const processingTimeMs = Date.now() - startTime;

      return {
        success: true,
        cacheHit,
        processorVersion: this.processorVersion,
        processingTimeMs,
        counts: {
          objectCount: objectIds.length,
          objectTrackCount: Object.keys(trackIdMap).length,
          labelEntityCount: entityIds.length,
          labelTrackCount: Object.keys(trackIdMap).length,
          labelClipCount: 0,
          labelObjectCount: objectIds.length,
          labelFaceCount: 0,
          labelPersonCount: 0,
          labelSpeechCount: 0,
          labelSegmentCount: 0,
          labelShotCount: 0,
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
          labelObjectCount: 0,
          labelFaceCount: 0,
          labelPersonCount: 0,
          labelSpeechCount: 0,
          labelSegmentCount: 0,
          labelShotCount: 0,
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
      const entityId = await this.labelEntityService.getOrCreateLabelEntity(
        entity.WorkspaceRef,
        entity.labelType,
        entity.canonicalName,
        entity.provider as
          | ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
          | ProcessingProvider.GOOGLE_SPEECH,
        entity.processor,
        entity.metadata
      );
      entityIds.push(entityId);
    }

    return entityIds;
  }

  /**
   * Batch insert LabelTrack records
   * Returns a map of trackHash -> PocketBase ID
   */
  private async batchInsertLabelTracks(
    tracks: Array<LabelTrackData>
  ): Promise<Record<string, string>> {
    const trackIdMap: Record<string, string> = {};
    const batchSize = 50;

    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);

      await Promise.all(
        batch.map(async (track) => {
          try {
            // Get or create LabelEntity for this track
            const entityId =
              await this.labelEntityService.getOrCreateLabelEntity(
                track.WorkspaceRef,
                LabelType.OBJECT,
                (track.trackData.entity as string) || 'unknown',
                ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
                track.processor,
                {}
              );

            // Check if track already exists
            const existing =
              await this.pocketBaseService.labelTrackMutator.getList(
                1,
                1,
                `trackHash = "${track.trackHash}"`
              );

            if (existing.items.length > 0) {
              trackIdMap[track.trackHash] = existing.items[0].id;
              return;
            }

            const created =
              await this.pocketBaseService.labelTrackMutator.create({
                ...track,
                LabelEntityRef: entityId,
              });
            trackIdMap[track.trackHash] = created.id;
          } catch (error) {
            this.logger.warn(
              `Failed to insert label track: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        })
      );
    }

    return trackIdMap;
  }

  /**
   * Batch insert LabelObject records
   */
  private async batchInsertLabelObjects(
    objects: Array<LabelObjectData>,
    trackIdMap: Record<string, string>
  ): Promise<string[]> {
    const objectIds: string[] = [];
    const batchSize = 50;

    for (let i = 0; i < objects.length; i += batchSize) {
      const batch = objects.slice(i, i + batchSize);

      await Promise.all(
        batch.slice().map(async (obj) => {
          try {
            // Get or create LabelEntity for this object
            const entityId =
              await this.labelEntityService.getOrCreateLabelEntity(
                obj.WorkspaceRef,
                LabelType.OBJECT,
                obj.entity,
                ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
                this.processorVersion,
                {}
              );

            const trackRef = trackIdMap[obj.objectHash];

            // Check if object already exists
            const existing =
              await this.pocketBaseService.labelObjectMutator.getList(
                1,
                1,
                `objectHash = "${obj.objectHash}"`
              );

            if (existing.items.length > 0) {
              objectIds.push(existing.items[0].id);
              return;
            }

            const created =
              await this.pocketBaseService.labelObjectMutator.create({
                ...obj,
                LabelEntityRef: entityId,
                LabelTrackRef: trackRef,
              });
            objectIds.push(created.id);
          } catch (error) {
            this.logger.warn(
              `Failed to insert label object: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        })
      );
    }

    return objectIds;
  }
}
