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
  LabelTrackData,
  LabelMediaData,
} from '../types';

// Re-export types for parent processor
export type { FaceDetectionStepInput, FaceDetectionStepOutput };

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
      // Face detection creates a single "Face" entity, so all tracks reference it
      const entityId = entityIds.length > 0 ? entityIds[0] : undefined;
      const { trackIds, trackIdToDbIdMap } = await this.batchInsertLabelTracks(
        normalizedData.labelTracks,
        entityId
      );
      this.logger.debug(
        `Inserted ${trackIds.length} label tracks for media ${input.mediaId}`
      );

      // Step 6: Batch insert LabelClip records (with track references)
      // Face detection creates a single "Face" entity, so all clips reference it
      const clipIds = await this.batchInsertLabelClips(
        normalizedData.labelClips,
        entityId,
        trackIdToDbIdMap
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
   * Handles duplicate trackHash by checking for existing records first
   * Sets LabelEntityRef on tracks if entityId is provided
   * Stores keyframes data in the keyframes column
   *
   * Note: Tracks are already validated and filtered by the normalizer
   *
   * @returns Object with trackIds array and trackIdToDbIdMap for linking clips to tracks
   */
  private async batchInsertLabelTracks(
    tracks: LabelTrackData[],
    entityId?: string
  ): Promise<{ trackIds: string[]; trackIdToDbIdMap: Map<string, string> }> {
    const trackIds: string[] = [];
    const trackIdToDbIdMap = new Map<string, string>(); // Map trackId -> database ID
    const batchSize = 100;

    for (let i = 0; i < tracks.length; i += batchSize) {
      const batch = tracks.slice(i, i + batchSize);
      let insertedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const track of batch) {
        try {
          // Check if a track with this trackHash already exists
          const existing =
            await this.pocketBaseService.labelTrackMutator.getList(
              1,
              1,
              `trackHash = "${track.trackHash}"`
            );

          if (existing.items.length > 0) {
            // Track already exists, use existing ID
            const dbId = existing.items[0].id;
            trackIds.push(dbId);
            trackIdToDbIdMap.set(track.trackId, dbId);
            skippedCount++;
            this.logger.debug(
              `Skipped duplicate label track with hash ${track.trackHash}`
            );
          } else {
            // Track doesn't exist, create it
            // Set LabelEntityRef if entityId is provided (required field)
            // keyframes are already included in the track data from normalizer
            const labelEntityRef = entityId || track.LabelEntityRef;
            if (!labelEntityRef) {
              this.logger.error(
                `Cannot create label track without LabelEntityRef for trackId ${track.trackId}`
              );
              errorCount++;
              continue;
            }

            const created =
              await this.pocketBaseService.labelTrackMutator.create({
                ...track,
                LabelEntityRef: labelEntityRef,
                provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
                keyframes: track.keyframes, // Ensure keyframes are stored
              });
            trackIds.push(created.id);
            trackIdToDbIdMap.set(track.trackId, created.id);
            insertedCount++;
          }
        } catch (error) {
          // Check if this is a unique constraint error (race condition)
          if (this.isUniqueConstraintErrorForTrack(error)) {
            // Try to fetch the existing record
            try {
              const existing =
                await this.pocketBaseService.labelTrackMutator.getList(
                  1,
                  1,
                  `trackHash = "${track.trackHash}"`
                );
              if (existing.items.length > 0) {
                const dbId = existing.items[0].id;
                trackIds.push(dbId);
                trackIdToDbIdMap.set(track.trackId, dbId);
                skippedCount++;
                this.logger.debug(
                  `Resolved duplicate label track with hash ${track.trackHash} (race condition)`
                );
              } else {
                // Shouldn't happen, but log it
                this.logger.warn(
                  `Unique constraint error for trackHash ${track.trackHash} but record not found`
                );
                errorCount++;
              }
            } catch (fetchError) {
              this.logger.error(
                `Failed to fetch existing label track after unique constraint error: ${fetchError instanceof Error ? fetchError.message : String(fetchError)}`
              );
              errorCount++;
            }
          } else {
            // Some other error occurred
            this.logger.error(
              `Failed to insert label track: ${error instanceof Error ? error.message : String(error)}`
            );
            errorCount++;
          }
        }
      }

      this.logger.debug(
        `Batch ${Math.floor(i / batchSize) + 1}: Inserted ${insertedCount}, skipped ${skippedCount} duplicate tracks, ${errorCount} errors`
      );
    }

    return { trackIds, trackIdToDbIdMap };
  }

  /**
   * Batch insert LabelClip records
   * Inserts in batches of 100 for performance
   * Handles duplicate labelHash by checking for existing records first
   * Sets LabelEntityRef and LabelTrackRef on clips if provided
   *
   * Note: Clips are already validated and filtered by the normalizer
   */
  private async batchInsertLabelClips(
    clips: LabelClipData[],
    entityId?: string,
    trackIdToDbIdMap?: Map<string, string>
  ): Promise<string[]> {
    const clipIds: string[] = [];
    const batchSize = 100;

    for (let i = 0; i < clips.length; i += batchSize) {
      const batch = clips.slice(i, i + batchSize);
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
            // Set LabelTrackRef if trackId is found in labelData
            let labelTrackRef: string | undefined;
            if (
              trackIdToDbIdMap &&
              clip.labelData &&
              typeof clip.labelData === 'object'
            ) {
              const labelData = clip.labelData as Record<string, unknown>;
              const trackId = labelData.trackId;
              if (trackId && typeof trackId === 'string') {
                labelTrackRef = trackIdToDbIdMap.get(trackId);
              }
            }

            const created =
              await this.pocketBaseService.labelClipMutator.create({
                ...clip,
                LabelEntityRef: entityId || clip.LabelEntityRef,
                LabelTrackRef: labelTrackRef || clip.LabelTrackRef,
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
   * Check if an error is a unique constraint violation for clips
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
   * Check if an error is a unique constraint violation for tracks
   *
   * @param error The error to check
   * @returns True if the error is a unique constraint violation
   */
  private isUniqueConstraintErrorForTrack(error: unknown): boolean {
    if (!error) return false;

    // Check for PocketBase error structure
    if (typeof error === 'object' && 'data' in error) {
      const data = (error as { data?: { trackHash?: { code?: string } } }).data;
      if (data?.trackHash?.code === 'validation_not_unique') {
        return true;
      }
    }

    // Check error message
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes('unique constraint') ||
      message.includes('UNIQUE constraint') ||
      message.includes('validation_not_unique') ||
      message.includes('trackHash')
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
