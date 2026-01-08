import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { LabelNormalizerService } from '../services/label-normalizer.service';
import type { StepJobData } from '../../queue/types/job.types';
import type {
  NormalizeLabelsStepInput,
  NormalizeLabelsStepOutput,
} from '../types/step-inputs';

/**
 * Processor for NORMALIZE_LABELS step in detect_labels flow
 * Normalizes provider responses into label_clip format using LabelNormalizerService
 * Combines results from VIDEO_INTELLIGENCE and SPEECH_TO_TEXT steps
 */
@Injectable()
export class NormalizeLabelsStepProcessor extends BaseStepProcessor<
  NormalizeLabelsStepInput,
  NormalizeLabelsStepOutput
> {
  protected readonly logger = new Logger(NormalizeLabelsStepProcessor.name);

  constructor(
    private readonly labelNormalizerService: LabelNormalizerService,
  ) {
    super();
  }

  /**
   * Process label normalization
   * Converts provider responses into normalized label_clip format
   */
  async process(
    input: NormalizeLabelsStepInput,
    job: Job<StepJobData>,
  ): Promise<NormalizeLabelsStepOutput> {
    this.logger.log(
      `Normalizing labels for media ${input.mediaId}, version ${input.version}`,
    );

    try {
      const allLabelClips: any[] = [];
      let shotCount = 0;
      let objectCount = 0;
      let personCount = 0;
      let speechCount = 0;

      // Normalize video intelligence results if available
      if (input.videoIntelligence) {
        this.logger.log(
          `Normalizing video intelligence results for media ${input.mediaId}`,
        );

        const videoResult =
          await this.labelNormalizerService.normalizeVideoIntelligence({
            response: input.videoIntelligence.response,
            mediaId: input.mediaId,
            version: input.version,
            rawJsonPath: input.videoIntelligence.rawJsonPath,
            processor: input.videoIntelligence.processor,
          });

        allLabelClips.push(...videoResult.labelClips);
        shotCount = videoResult.summary.shotCount;
        objectCount = videoResult.summary.objectCount;
        personCount = videoResult.summary.personCount;

        this.logger.log(
          `Normalized ${videoResult.labelClips.length} video intelligence labels`,
        );
      }

      // Normalize speech-to-text results if available
      if (input.speechToText) {
        this.logger.log(
          `Normalizing speech-to-text results for media ${input.mediaId}`,
        );

        const speechResult =
          await this.labelNormalizerService.normalizeSpeechToText({
            response: input.speechToText.response,
            mediaId: input.mediaId,
            version: input.version,
            rawJsonPath: input.speechToText.rawJsonPath,
            processor: input.speechToText.processor,
          });

        allLabelClips.push(...speechResult.labelClips);
        speechCount = speechResult.summary.speechCount;

        this.logger.log(
          `Normalized ${speechResult.labelClips.length} speech segments`,
        );
      }

      // Check if we have any results
      if (allLabelClips.length === 0) {
        this.logger.warn(
          `No label clips generated for media ${input.mediaId} - both analysis steps may have failed or returned no results`,
        );
      }

      this.logger.log(
        `Normalization completed for media ${input.mediaId}: ${allLabelClips.length} total label clips`,
      );

      return {
        labelClips: allLabelClips,
        summary: {
          shotCount,
          objectCount,
          personCount,
          speechCount,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Label normalization failed for media ${input.mediaId}: ${errorMessage}`,
      );
      throw new Error(`Label normalization failed: ${errorMessage}`);
    }
  }
}
