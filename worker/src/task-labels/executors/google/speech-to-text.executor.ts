import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../../shared/services/google-cloud.service';
import type {
  ISpeechToTextExecutor,
  SpeechToTextResult,
  SpeechToTextResponse,
} from '../interfaces';

/**
 * Google Cloud Speech-to-Text executor
 *
 * Pure implementation of audio transcription using Google Speech-to-Text API.
 * No database operations - just API calls and response handling.
 */
@Injectable()
export class GoogleSpeechToTextExecutor implements ISpeechToTextExecutor {
  private readonly logger = new Logger(GoogleSpeechToTextExecutor.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  async execute(gcsUri: string): Promise<SpeechToTextResult> {
    this.logger.log(`Transcribing audio: ${gcsUri}`);

    // Call Google Speech-to-Text API
    const response = await this.googleCloudService.transcribeAudio(gcsUri);

    this.logger.log(`Audio transcription complete for ${gcsUri}`);

    return {
      response: response as SpeechToTextResponse,
    };
  }
}
