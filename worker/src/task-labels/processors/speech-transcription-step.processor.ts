import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { LabelEntityService } from '../services/label-entity.service';
import { SpeechTranscriptionExecutor } from '../executors/speech-transcription.executor';
import { SpeechTranscriptionNormalizer } from '../normalizers/speech-transcription.normalizer';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { SpeechTranscriptionStepInput } from '../types/step-inputs';
import type { SpeechTranscriptionStepOutput } from '../types/step-outputs';
import type { LabelClipData } from '../types/normalizer-outputs';

// Re-export types for parent processor
export type { SpeechTranscriptionStepInput, SpeechTranscriptionStepOutput };

/**
 * Step processor for SPEECH_TRANSCRIPTION in detect_labels flow
 *
 * This processor:
 * 1. Checks cache before calling executor
 * 2. Calls SpeechTranscriptionExecutor (SPEECH_TRANSCRIPTION)
 * 3. Calls SpeechTranscriptionNormalizer to transform response
 * 4. Batch inserts LabelEntity records (for significant words/phrases)
 * 5. Batch inserts LabelClip records (for speech segments)
 * 6. Updates LabelMedia with aggregated data (transcript, word counts)
 * 7. Stores normalized response to cache
 *
 * Note: Speech transcription does NOT create LabelTrack records
 * as speech doesn't have spatial tracking.
 *
 * Implements cache-aware processing to avoid redundant API calls.
 */
@Injectable()
export class SpeechTranscriptionStepProcessor extends BaseStepProcessor<
  SpeechTranscriptionStepInput,
  SpeechTranscriptionStepOutput
> {
  protected readonly logger = new Logger(SpeechTranscriptionStepProcessor.name);
  private readonly processorVersion = 'speech-transcription:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly labelEntityService: LabelEntityService,
    private readonly speechTranscriptionExecutor: SpeechTranscriptionExecutor,
    private readonly speechTranscriptionNormalizer: SpeechTranscriptionNormalizer,
    private readonly pocketBaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process speech transcription with cache awareness
   */
  async process(
    input: SpeechTranscriptionStepInput,
    job: Job<StepJobData>
  ): Promise<SpeechTranscriptionStepOutput> {
    const startTime = Date.now();

    this.logger.log(
      `Processing speech transcription for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Step 1: Check cache before calling executor
      const cached = await this.labelCacheService.getCachedLabels(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_SPEECH,
        this.processorVersion
      );

      let response: any;
      let cacheHit = false;

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached speech transcription for media ${input.mediaId}`
        );
        response = cached.response;
        cacheHit = true;
      } else {
        // Step 2: Cache miss - call executor
        this.logger.log(
          `Cache miss for media ${input.mediaId}, calling Speech Transcription API`
        );

        response = await this.speechTranscriptionExecutor.execute(
          input.workspaceRef,
          input.mediaId,
          input.config
        );

        // Step 7: Store normalized response to cache
        await this.labelCacheService.storeLabelCache(
          input.mediaId,
          input.version,
          ProcessingProvider.GOOGLE_SPEECH,
          response,
          this.processorVersion,
          ['SPEECH_TRANSCRIPTION']
        );

        this.logger.log(
          `Speech transcription completed for media ${input.mediaId}, stored to cache`
        );
      }

      // Step 3: Call normalizer to transform response
      const normalizedData = await this.speechTranscriptionNormalizer.normalize(
        {
          response,
          mediaId: input.mediaId,
          workspaceRef: input.workspaceRef,
          taskRef: input.taskRef,
          version: input.version,
          processor: 'speech-transcription', // Processor type identifier
          processorVersion: this.processorVersion, // Processor version string
        }
      );

      // Step 4: Batch insert LabelEntity records (for significant words/phrases)
      // const entityIds = await this.batchInsertLabelEntities(
      //   normalizedData.labelEntities
      // );
      // this.logger.debug(
      //   `Inserted ${entityIds.length} label entities for media ${input.mediaId}`
      // );

      // Step 5: Batch insert LabelClip records (for speech segments)
      // const clipIds = await this.batchInsertLabelClips(
      //   normalizedData.labelClips
      // );
      // this.logger.debug(
      //   `Inserted ${clipIds.length} label clips for media ${input.mediaId}`
      // );

      // Step 6: Update LabelMedia with aggregated data (transcript, word counts)
      // await this.updateLabelMedia(
      //   input.mediaId,
      //   normalizedData.labelMediaUpdate
      // );
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
          transcriptLength:
            normalizedData.labelMediaUpdate.transcriptLength || 0,
          wordCount: normalizedData.labelMediaUpdate.wordCount || 0,
          labelEntityCount: 0,
          labelTrackCount: 0, // Speech transcription doesn't create tracks
          labelClipCount: 0,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Speech transcription failed for media ${input.mediaId}: ${errorMessage}`
      );

      return {
        success: false,
        cacheHit: false,
        processorVersion: this.processorVersion,
        processingTimeMs: Date.now() - startTime,
        error: errorMessage,
        counts: {
          transcriptLength: 0,
          wordCount: 0,
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
   * Batch insert LabelClip records
   * Inserts in batches of 100 for performance
   * Handles duplicate labelHash by checking for existing records first
   * Filters out invalid clips before insertion
   */
  private async batchInsertLabelClips(
    clips: Array<LabelClipData>
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
            const created =
              await this.pocketBaseService.labelClipMutator.create({
                ...clip,
                provider: clip.provider as ProcessingProvider.GOOGLE_SPEECH,
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
    if (
      typeof clip.duration !== 'number' ||
      clip.duration <= 0 ||
      !Number.isFinite(clip.duration)
    ) {
      return false;
    }

    // Check confidence (must be between 0 and 1)
    if (
      typeof clip.confidence !== 'number' ||
      clip.confidence < 0 ||
      clip.confidence > 1 ||
      !Number.isFinite(clip.confidence)
    ) {
      return false;
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
    update: Record<string, any>
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
