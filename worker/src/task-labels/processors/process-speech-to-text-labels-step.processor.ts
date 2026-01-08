import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { LabelNormalizerService } from '../services/label-normalizer.service';
import { LabelCacheService } from '../services/label-cache.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { ProcessingProvider } from '@project/shared';
import type { StepJobData } from '../../queue/types/job.types';
import type { SpeechToTextResponse } from '../executors/interfaces';

/**
 * Step input/output types
 */
export interface ProcessSpeechToTextLabelsStepInput {
  type: 'process_speech_to_text_labels';
  mediaId: string;
  workspaceRef: string;
  taskRef: string;
  version: number;
  processor: string;
}

export interface ProcessSpeechToTextLabelsStepOutput {
  labelClipsCreated: number;
  summary: {
    speechCount: number;
  };
}

/**
 * Processor for PROCESS_SPEECH_TO_TEXT_LABELS step
 * Reads speech-to-text cache, normalizes to label_clips, and writes to PocketBase
 */
@Injectable()
export class ProcessSpeechToTextLabelsStepProcessor extends BaseStepProcessor<
  ProcessSpeechToTextLabelsStepInput,
  ProcessSpeechToTextLabelsStepOutput
> {
  protected readonly logger = new Logger(
    ProcessSpeechToTextLabelsStepProcessor.name,
  );

  constructor(
    private readonly labelNormalizerService: LabelNormalizerService,
    private readonly labelCacheService: LabelCacheService,
    private readonly pocketbaseService: PocketBaseService,
  ) {
    super();
  }

  /**
   * Process speech-to-text labels
   * Reads from cache, normalizes, and writes to database
   */
  async process(
    input: ProcessSpeechToTextLabelsStepInput,
    job: Job<StepJobData>,
  ): Promise<ProcessSpeechToTextLabelsStepOutput> {
    this.logger.log(
      `Processing speech-to-text labels for media ${input.mediaId}, version ${input.version}`,
    );

    try {
      // Read speech-to-text results from cache
      const cache = await this.labelCacheService.getCachedLabels(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_SPEECH,
      );

      if (!cache) {
        throw new Error(
          `No speech-to-text cache found for media ${input.mediaId}, version ${input.version}`,
        );
      }

      // Normalize to label clips
      this.logger.log(
        `Normalizing speech-to-text results for media ${input.mediaId}`,
      );

      const normalizedResult =
        await this.labelNormalizerService.normalizeSpeechToText({
          response: cache.response as SpeechToTextResponse,
          mediaId: input.mediaId,
          version: input.version,
          rawJsonPath: `labels/${input.mediaId}/v${input.version}/google_speech.json`,
          processor: cache.metadata.processor,
        });

      this.logger.log(
        `Normalized ${normalizedResult.labelClips.length} speech segments`,
      );

      // // Write to database
      // const labelClipIds: string[] = [];

      // for (const labelClip of normalizedResult.labelClips) {
      //   try {
      //     // Check if label clip already exists (idempotency)
      //     const existingFilter = [
      //       `MediaRef = "${input.mediaId}"`,
      //       `version = ${input.version}`,
      //       `provider = "${ProcessingProvider.GOOGLE_SPEECH}"`,
      //       `labelType = "${labelClip.labelType}"`,
      //       `start = ${labelClip.start}`,
      //       `end = ${labelClip.end}`,
      //     ].join(' && ');

      //     const existing =
      //       await this.pocketbaseService.labelClipMutator.getList(
      //         1,
      //         1,
      //         existingFilter,
      //       );

      //     let recordId: string;

      //     if (existing.items.length > 0) {
      //       // Update existing record
      //       const existingRecord = existing.items[0];
      //       this.logger.debug(
      //         `Updating existing label clip ${existingRecord.id}`,
      //       );

      //       const updated =
      //         await this.pocketbaseService.labelClipMutator.update(
      //           existingRecord.id,
      //           {
      //             WorkspaceRef: input.workspaceRef,
      //             MediaRef: input.mediaId,
      //             TaskRef: input.taskRef,
      //             labelType: labelClip.labelType,
      //             start: labelClip.start,
      //             end: labelClip.end,
      //             duration: labelClip.duration,
      //             confidence: labelClip.confidence,
      //             version: input.version,
      //             processor: input.processor,
      //             provider: ProcessingProvider.GOOGLE_SPEECH,
      //             labelData: labelClip.labelData,
      //           },
      //         );

      //       recordId = updated.id;
      //     } else {
      //       // Create new record
      //       const created =
      //         await this.pocketbaseService.labelClipMutator.create({
      //           WorkspaceRef: input.workspaceRef,
      //           MediaRef: input.mediaId,
      //           TaskRef: input.taskRef,
      //           labelType: labelClip.labelType,
      //           start: labelClip.start,
      //           end: labelClip.end,
      //           duration: labelClip.duration,
      //           confidence: labelClip.confidence,
      //           version: input.version,
      //           processor: input.processor,
      //           provider: ProcessingProvider.GOOGLE_SPEECH,
      //           labelData: labelClip.labelData as any,
      //         });

      //       recordId = created.id;
      //     }

      //     labelClipIds.push(recordId);
      //   } catch (error) {
      //     const errorMessage =
      //       error instanceof Error ? error.message : String(error);
      //     this.logger.error(
      //       `Failed to upsert label clip: ${errorMessage}`,
      //     );
      //     // Continue with other clips
      //   }
      // }

      // this.logger.log(
      //   `Stored ${labelClipIds.length} speech-to-text label clips for media ${input.mediaId}`,
      // );

      return {
        labelClipsCreated: normalizedResult?.labelClips?.length,
        summary: normalizedResult.summary,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to process speech-to-text labels for media ${input.mediaId}: ${errorMessage}`,
      );
      throw new Error(
        `Speech-to-text label processing failed: ${errorMessage}`,
      );
    }
  }
}
