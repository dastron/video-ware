import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { SpeechToTextStrategy } from '../strategies/speech-to-text.strategy';
import { IntelligenceStepType } from '../../queue/types/step.types';
import type { StepJobData } from '../../queue/types/job.types';
import type {
  SpeechToTextStepInput,
  SpeechToTextOutput,
} from '../types/step-inputs';

/**
 * Processor for SPEECH_TO_TEXT step
 * Transcribes audio from video using Google Speech-to-Text API
 */
@Injectable()
export class SpeechToTextStepProcessor extends BaseStepProcessor<
  SpeechToTextStepInput,
  SpeechToTextOutput
> {
  protected readonly logger = new Logger(SpeechToTextStepProcessor.name);

  constructor(private readonly speechToTextStrategy: SpeechToTextStrategy) {
    super();
  }

  /**
   * Process speech-to-text transcription
   * Extracts audio from video and transcribes it to text
   */
  async process(
    input: SpeechToTextStepInput,
    job: Job<StepJobData>
  ): Promise<SpeechToTextOutput> {
    this.logger.log(
      `Processing speech-to-text for media ${input.mediaId}, file: ${input.filePath}`
    );

    await this.updateProgress(job, 10);

    try {
      // Transcribe audio using the strategy
      // The strategy handles audio extraction and GCS upload internally
      const result = await this.speechToTextStrategy.transcribe(
        input.filePath,
        'en-US' // Default language code, could be made configurable
      );

      await this.updateProgress(job, 90);

      if (result.hasAudio) {
        this.logger.log(
          `Speech transcription completed for media ${input.mediaId}: ` +
            `${result.transcript.length} characters, ${result.words.length} words, ` +
            `confidence: ${result.confidence.toFixed(2)}`
        );
      } else {
        this.logger.log(
          `No audio found in media ${input.mediaId}, skipping transcription`
        );
      }

      await this.updateProgress(job, 100);

      return result;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Speech transcription failed for media ${input.mediaId}: ${errorMessage}`
      );
      throw new Error(`Speech transcription failed: ${errorMessage}`);
    }
  }
}
