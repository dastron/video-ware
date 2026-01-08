import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import { FFmpegService } from '../../shared/services/ffmpeg.service';
import { StorageService } from '../../shared/services/storage.service';
import * as path from 'path';
import * as fs from 'fs/promises';
import * as os from 'os';

export interface SpeechToTextStrategyResult {
  transcript: string;
  confidence: number;
  words: Array<{
    word: string;
    startTime: number;
    endTime: number;
    confidence: number;
  }>;
  languageCode: string;
  hasAudio: boolean;
}

@Injectable()
export class SpeechToTextStrategy {
  private readonly logger = new Logger(SpeechToTextStrategy.name);

  constructor(
    private readonly googleCloudService: GoogleCloudService,
    private readonly ffmpegService: FFmpegService,
    private readonly storageService: StorageService
  ) {}

  /**
   * Transcribe speech from video using Google Speech-to-Text API
   * Handles audio extraction from video files
   */
  async transcribe(
    videoFilePath: string,
    languageCode: string = 'en-US'
  ): Promise<SpeechToTextStrategyResult> {
    this.logger.log(`Starting speech transcription for: ${videoFilePath}`);

    let tempAudioPath: string | null = null;
    let gcsAudioUri: string | null = null;

    try {
      // First, probe the video to check if it has audio
      const probeResult = await this.ffmpegService.probe(videoFilePath);
      
      // Check if video has audio stream
      const audioStream = probeResult.streams.find(stream => stream.codec_type === 'audio');
      if (!audioStream) {
        this.logger.log('No audio stream found in video file');
        return {
          transcript: '',
          confidence: 0,
          words: [],
          languageCode,
          hasAudio: false,
        };
      }

      this.logger.log(`Audio stream found: ${audioStream.codec_name}, ${audioStream.channels} channels`);

      // Extract audio from video to a temporary WAV file
      tempAudioPath = await this.extractAudioToTemp(videoFilePath);

      // Upload audio to GCS for processing (Google Speech-to-Text requires GCS URI)
      gcsAudioUri = await this.uploadAudioToGcs(tempAudioPath);

      // Transcribe using Google Speech-to-Text
      const transcriptionResult = await this.googleCloudService.transcribeSpeech(
        gcsAudioUri,
        languageCode,
        true // enableWordTimeOffsets
      );

      this.logger.log(
        `Speech transcription completed: ${transcriptionResult.transcript.length} characters, ${transcriptionResult.words.length} words`
      );

      return {
        transcript: transcriptionResult.transcript,
        confidence: transcriptionResult.confidence,
        words: transcriptionResult.words,
        languageCode: transcriptionResult.languageCode,
        hasAudio: true,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Speech transcription failed: ${errorMessage}`);
      throw new Error(`Speech transcription failed: ${errorMessage}`);
    } finally {
      // Clean up temporary files
      if (tempAudioPath) {
        try {
          await fs.unlink(tempAudioPath);
          this.logger.debug(`Cleaned up temporary audio file: ${tempAudioPath}`);
        } catch (cleanupError) {
          this.logger.warn(`Failed to clean up temporary audio file: ${cleanupError}`);
        }
      }

      // Note: We don't clean up the GCS file here as it might be needed for debugging
      // or could be cleaned up by a separate process
    }
  }

  /**
   * Extract audio from video to a temporary WAV file
   */
  private async extractAudioToTemp(videoFilePath: string): Promise<string> {
    const tempDir = os.tmpdir();
    const audioFileName = `audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.wav`;
    const tempAudioPath = path.join(tempDir, audioFileName);

    this.logger.debug(`Extracting audio to: ${tempAudioPath}`);

    try {
      // Extract audio using FFmpeg
      // Convert to WAV for optimal Speech-to-Text performance
      await this.ffmpegService.extractAudio(
        videoFilePath,
        tempAudioPath,
        'wav'
      );

      // Verify the file was created
      const stats = await fs.stat(tempAudioPath);
      if (stats.size === 0) {
        throw new Error('Extracted audio file is empty');
      }

      this.logger.debug(`Audio extracted successfully: ${stats.size} bytes`);
      return tempAudioPath;
    } catch (error) {
      // Clean up on failure
      try {
        await fs.unlink(tempAudioPath);
      } catch {
        // Ignore cleanup errors
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Audio extraction failed: ${errorMessage}`);
    }
  }

  /**
   * Upload audio file to GCS for processing
   * Returns the GCS URI for the uploaded file
   */
  private async uploadAudioToGcs(audioFilePath: string): Promise<string> {
    const audioFileName = `temp_audio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.wav`;
    const gcsKey = `intelligence/audio/${audioFileName}`;

    this.logger.debug(`Uploading audio to GCS: ${gcsKey}`);

    try {
      // Read the audio file
      const audioBuffer = await fs.readFile(audioFilePath);

      // Upload to storage (which should handle GCS upload)
      await this.storageService.upload(gcsKey, audioBuffer);

      // Construct GCS URI
      // Note: This assumes the storage service is configured for GCS
      // The actual URI format may need to be adjusted based on storage configuration
      const gcsUri = `gs://${process.env.STORAGE_S3_BUCKET || 'default-bucket'}/${gcsKey}`;

      this.logger.debug(`Audio uploaded to GCS: ${gcsUri}`);
      return gcsUri;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to upload audio to GCS: ${errorMessage}`);
    }
  }
}