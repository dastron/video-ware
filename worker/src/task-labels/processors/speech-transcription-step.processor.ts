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

  private labelClipMutator: any;
  private labelMediaMutator: any;

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
   * Initialize mutators after module initialization
   */
  async onModuleInit() {
    const sharedModule = await (eval(`import('@project/shared')`) as Promise<
      typeof import('@project/shared')
    >);

    this.labelClipMutator = new sharedModule.LabelClipMutator(
      this.pocketBaseService.getClient()
    );
    this.labelMediaMutator = new sharedModule.MediaLabelMutator(
      this.pocketBaseService.getClient()
    );

    this.logger.log('SpeechTranscriptionStepProcessor initialized');
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
        ProcessingProvider.GOOGLE_SPEECH
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
          input.gcsUri,
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
      const entityIds = await this.batchInsertLabelEntities(
        normalizedData.labelEntities
      );
      this.logger.debug(
        `Inserted ${entityIds.length} label entities for media ${input.mediaId}`
      );

      // Step 5: Batch insert LabelClip records (for speech segments)
      const clipIds = await this.batchInsertLabelClips(
        normalizedData.labelClips
      );
      this.logger.debug(
        `Inserted ${clipIds.length} label clips for media ${input.mediaId}`
      );

      // Step 6: Update LabelMedia with aggregated data (transcript, word counts)
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
          transcriptLength:
            normalizedData.labelMediaUpdate.transcriptLength || 0,
          wordCount: normalizedData.labelMediaUpdate.wordCount || 0,
          labelEntityCount: entityIds.length,
          labelTrackCount: 0, // Speech transcription doesn't create tracks
          labelClipCount: clipIds.length,
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
