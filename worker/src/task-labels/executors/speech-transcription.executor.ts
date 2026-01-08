/**
 * Speech Transcription Executor
 *
 * Executes Google Cloud Speech-to-Text API calls for SPEECH_TRANSCRIPTION feature.
 * This is a pure strategy implementation with no database operations.
 */

import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import type {
  SpeechTranscriptionResponse,
  TranscribedWord,
} from '../types/executor-responses';
import { SpeechClient } from '@google-cloud/speech';

/**
 * Configuration for speech transcription
 */
export interface SpeechTranscriptionConfig {
  languageCode?: string; // default: 'en-US'
  enableAutomaticPunctuation?: boolean; // default: true
  enableWordTimeOffsets?: boolean; // default: true
  model?: string; // default: 'video' (optimized for video audio)
  useEnhanced?: boolean; // default: true
}

/**
 * Executor for Speech Transcription API calls
 */
@Injectable()
export class SpeechTranscriptionExecutor {
  private readonly logger = new Logger(SpeechTranscriptionExecutor.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  /**
   * Execute speech transcription on an audio/video file
   *
   * @param gcsUri - GCS URI of the audio/video file (gs://bucket/path)
   * @param config - Speech transcription configuration
   * @returns Normalized speech transcription response
   */
  async execute(
    gcsUri: string,
    config: SpeechTranscriptionConfig = {}
  ): Promise<SpeechTranscriptionResponse> {
    this.logger.log(`Executing speech transcription for: ${gcsUri}`);

    try {
      // Create Speech client
      const client = new SpeechClient();

      // Build request
      const request = {
        audio: {
          uri: gcsUri,
        },
        config: {
          languageCode: config.languageCode || 'en-US',
          enableWordTimeOffsets: config.enableWordTimeOffsets ?? true,
          enableAutomaticPunctuation: config.enableAutomaticPunctuation ?? true,
          model: config.model || 'video', // Optimized for video audio quality
          useEnhanced: config.useEnhanced ?? true,
        },
      };

      this.logger.debug(
        `Speech transcription request: ${JSON.stringify({
          gcsUri,
          languageCode: config.languageCode || 'en-US',
          model: config.model || 'video',
        })}`
      );

      // Execute API call (long-running operation)
      const [operation] = await client.longRunningRecognize(request);
      this.logger.log(
        `Speech transcription operation started: ${operation.name}`
      );

      // Wait for operation to complete
      const [response] = await operation.promise();

      if (!response.results || response.results.length === 0) {
        this.logger.warn('No speech transcription results returned');
        return {
          transcript: '',
          confidence: 0,
          words: [],
          languageCode: config.languageCode || 'en-US',
        };
      }

      // Combine all results
      let fullTranscript = '';
      let totalConfidence = 0;
      const allWords: TranscribedWord[] = [];

      for (const result of response.results) {
        if (result.alternatives && result.alternatives.length > 0) {
          const alternative = result.alternatives[0];
          fullTranscript += alternative.transcript + ' ';
          totalConfidence += alternative.confidence || 0;

          // Process word-level timing
          if (alternative.words) {
            for (const word of alternative.words) {
              allWords.push({
                word: word.word || '',
                startTime: this.parseTimeOffset(word.startTime),
                endTime: this.parseTimeOffset(word.endTime),
                confidence: alternative.confidence || 0,
              });
            }
          }
        }
      }

      const avgConfidence =
        response.results.length > 0
          ? totalConfidence / response.results.length
          : 0;

      this.logger.log(
        `Speech transcription completed: ${fullTranscript.length} characters, ` +
          `${allWords.length} words, confidence: ${avgConfidence.toFixed(2)}`
      );

      return {
        transcript: fullTranscript.trim(),
        confidence: avgConfidence,
        words: allWords,
        languageCode: config.languageCode || 'en-US',
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Speech transcription failed: ${errorMessage}`);
      throw new Error(`Speech transcription execution failed: ${errorMessage}`);
    }
  }

  /**
   * Parse Google Cloud time offset to seconds
   */
  private parseTimeOffset(timeOffset: any): number {
    if (!timeOffset) return 0;

    const seconds = parseInt(timeOffset.seconds || '0');
    const nanos = parseInt(timeOffset.nanos || '0');

    return seconds + nanos / 1000000000;
  }
}
