import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { IntelligenceStepType } from '../../queue/types/step.types';
import type { StepJobData } from '../../queue/types/job.types';
import type {
  StoreResultsStepInput,
  StoreResultsOutput,
} from '../types/step-inputs';
import { MediaLabelInput } from '@project/shared';

/**
 * Processor for STORE_RESULTS step
 * Combines results from video intelligence and speech-to-text steps
 * and stores them in a MediaLabel record in PocketBase
 */
@Injectable()
export class StoreResultsStepProcessor extends BaseStepProcessor<
  StoreResultsStepInput,
  StoreResultsOutput
> {
  protected readonly logger = new Logger(StoreResultsStepProcessor.name);

  constructor(private readonly pocketbaseService: PocketBaseService) {
    super();
  }

  /**
   * Process storing intelligence results
   * Creates or updates MediaLabel record with combined intelligence data
   */
  async process(
    input: StoreResultsStepInput,
    job: Job<StepJobData>
  ): Promise<StoreResultsOutput> {
    this.logger.log(`Storing intelligence results for media ${input.mediaId}`);


    try {
      // Verify media exists
      const media = await this.pocketbaseService.mediaMutator.getById(
        input.mediaId
      );
      if (!media) {
        throw new Error(`Media ${input.mediaId} not found`);
      }


      // Check if a media label already exists for this media
      const existingLabel =
        await this.pocketbaseService.mediaLabelMutator.getLatestByMedia(
          input.mediaId
        );


      // Prepare intelligence data for storage
      const intelligenceData: MediaLabelInput = {
        MediaRef: input.mediaId,
        labels: input.videoIntelligence?.labels || [],
        objects: input.videoIntelligence?.objects || [],
        sceneChanges: input.videoIntelligence?.sceneChanges || [],
        transcription: input.speechToText || undefined,
        intelligenceProcessedAt: new Date().toISOString(),
      };

      let mediaLabelId: string;

      if (existingLabel) {
        // Update existing media label
        await this.pocketbaseService.mediaLabelMutator.update(
          existingLabel.id,
          intelligenceData
        );
        mediaLabelId = existingLabel.id;
        this.logger.log(
          `Updated existing media label ${mediaLabelId} for media ${input.mediaId}`
        );
      } else {
        // Create new media label
        const newLabel =
          await this.pocketbaseService.mediaLabelMutator.create(
            intelligenceData
          );
        mediaLabelId = newLabel.id;
        this.logger.log(
          `Created new media label ${mediaLabelId} for media ${input.mediaId}`
        );
      }


      // Calculate summary statistics
      const summary = {
        labelCount: intelligenceData.labels.length,
        objectCount: intelligenceData.objects.length,
        hasTranscription: !!(
          intelligenceData.transcription &&
          intelligenceData.transcription.transcript.length > 0
        ),
      };

      this.logger.log(
        `Intelligence results stored for media ${input.mediaId}: ` +
          `${summary.labelCount} labels, ${summary.objectCount} objects, ` +
          `transcription: ${summary.hasTranscription}`
      );


      return {
        mediaLabelId,
        summary,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to store intelligence results for media ${input.mediaId}: ${errorMessage}`
      );
      throw new Error(`Failed to store intelligence results: ${errorMessage}`);
    }
  }
}
