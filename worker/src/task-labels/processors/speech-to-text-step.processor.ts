import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { ProcessingProvider } from '@project/shared';
import { LabelCacheService } from '../services/label-cache.service';
import { GoogleSpeechToTextExecutor } from '../executors/google/speech-to-text.executor';
import { GoogleCloudService } from '../../shared/services/google-cloud.service';
import { StorageService } from '../../shared/services/storage.service';
import { FFmpegService } from '../../shared/services/ffmpeg.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { SpeechToTextResponse } from '../executors/interfaces';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Step input/output types
 */
export interface SpeechToTextStepInput {
  type: 'speech_to_text';
  mediaId: string;
  fileRef: string;
  provider: ProcessingProvider;
  cacheKey: string;
  version: number;
  processor: string;
}

export interface SpeechToTextStepOutput {
  cacheHit: boolean;
  cachedPath: string;
  transcriptLength: number;
  wordCount: number;
  processor: string;
}

/**
 * Processor for SPEECH_TO_TEXT step in detect_labels flow
 * Transcribes audio from video using Google Speech-to-Text API
 * Implements cache-aware processing to avoid redundant API calls
 */
@Injectable()
export class SpeechToTextStepProcessor extends BaseStepProcessor<
  SpeechToTextStepInput,
  SpeechToTextStepOutput
> {
  protected readonly logger = new Logger(SpeechToTextStepProcessor.name);
  private readonly processorVersion = 'speech-to-text:1.0.0';

  constructor(
    private readonly labelCacheService: LabelCacheService,
    private readonly speechToTextExecutor: GoogleSpeechToTextExecutor,
    private readonly googleCloudService: GoogleCloudService,
    private readonly storageService: StorageService,
    private readonly ffmpegService: FFmpegService
  ) {
    super();
  }

  /**
   * Process speech-to-text transcription with cache awareness
   * Extracts audio from video, uploads to GCS, then transcribes
   */
  async process(
    input: SpeechToTextStepInput,
    job: Job<StepJobData>
  ): Promise<SpeechToTextStepOutput> {
    this.logger.log(
      `Processing speech-to-text for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Check cache before API call
      const cached = await this.labelCacheService.getCachedLabels(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_SPEECH
      );

      if (
        cached &&
        this.labelCacheService.isCacheValid(cached, this.processorVersion)
      ) {
        this.logger.log(
          `Using cached speech-to-text for media ${input.mediaId}, version ${input.version}`
        );

        const response = cached.response as SpeechToTextResponse;
        const transcriptLength = this.getTranscriptLength(response);
        const wordCount = this.getWordCount(response);

        return {
          cacheHit: true,
          cachedPath: input.cacheKey,
          transcriptLength,
          wordCount,
          processor: this.processorVersion,
        };
      }

      // Cache miss or invalid - process audio
      this.logger.log(
        `Cache miss or invalid for media ${input.mediaId}, extracting audio and transcribing`
      );

      // Step 1: Get audio file (extract from video if needed)
      const audioGcsUri = await this.prepareAudioForTranscription(
        input.fileRef,
        input.mediaId
      );
      this.logger.log(`Audio ready for transcription: ${audioGcsUri}`);

      // Step 2: Execute speech-to-text transcription via executor
      const result = await this.speechToTextExecutor.execute(audioGcsUri);
      const { response } = result;

      // Step 3: Store raw JSON to cache
      await this.labelCacheService.storeLabelCache(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_SPEECH,
        response,
        this.processorVersion,
        ['SPEECH_RECOGNITION']
      );

      this.logger.log(
        `Speech-to-text completed for media ${input.mediaId}, stored to cache`
      );

      const transcriptLength = this.getTranscriptLength(response);
      const wordCount = this.getWordCount(response);

      return {
        cacheHit: false,
        cachedPath: input.cacheKey,
        transcriptLength,
        wordCount,
        processor: this.processorVersion,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Speech-to-text failed for media ${input.mediaId}: ${errorMessage}`
      );
      throw new Error(`Speech-to-text transcription failed: ${errorMessage}`);
    }
  }

  /**
   * Prepare audio file for transcription
   * Extracts audio from video, converts to FLAC, and uploads to GCS
   */
  private async prepareAudioForTranscription(
    fileRef: string,
    mediaId: string
  ): Promise<string> {
    // Check if audio file already exists in GCS
    const audioFileName = 'audio.flac';
    const expectedAudioGcsUri = await this.googleCloudService.getExpectedGcsUri(
      mediaId,
      audioFileName
    );

    const audioExists =
      await this.googleCloudService.checkGcsFileExists(expectedAudioGcsUri);

    if (audioExists) {
      this.logger.log(
        `Audio file already exists in GCS: ${expectedAudioGcsUri}`
      );
      return expectedAudioGcsUri;
    }

    // Audio doesn't exist - need to extract and upload
    this.logger.log(`Extracting audio from video for media ${mediaId}`);

    // Get local video file path
    const videoPath = await this.storageService.resolveFilePath({
      storagePath: fileRef,
      recordId: mediaId,
    });

    // Create temp directory for audio extraction
    const tempDir = await this.storageService.createTempDir(
      `speech-${mediaId}`
    );
    const audioPath = path.join(tempDir, audioFileName);

    try {
      // Extract audio to FLAC format (lossless, well-supported by Speech API)
      await this.ffmpegService.extractAudio(videoPath, audioPath, 'flac');
      this.logger.log(`Audio extracted to: ${audioPath}`);

      // Upload audio to GCS
      const audioGcsUri = await this.googleCloudService.uploadToGcsTempBucket(
        audioPath,
        mediaId
      );
      this.logger.log(`Audio uploaded to GCS: ${audioGcsUri}`);

      return audioGcsUri;
    } finally {
      // Clean up temp audio file
      try {
        if (fs.existsSync(audioPath)) {
          await fs.promises.unlink(audioPath);
          this.logger.debug(`Cleaned up temp audio file: ${audioPath}`);
        }
      } catch (cleanupError) {
        this.logger.warn(`Failed to cleanup temp audio file: ${cleanupError}`);
      }
    }
  }

  /**
   * Get deterministic GCS URI for a media file
   * All steps use the same path - upload step ensures file exists there
   */
  private async getGcsUri(fileRef: string, mediaId: string): Promise<string> {
    // If already a GCS URI, return as-is
    if (fileRef.startsWith('gs://')) {
      return fileRef;
    }

    // Get deterministic GCS path
    const fileName = fileRef.split('/').pop() || 'video';
    return await this.googleCloudService.getExpectedGcsUri(mediaId, fileName);
  }

  /**
   * Resolve GCS URI - check if file exists in GCS, otherwise throw error
   * This method is used when no gcsUri is provided from upload step
   * @deprecated Use getGcsUri instead - upload step ensures file exists
   */
  private async resolveGcsUri(
    fileRef: string,
    mediaId: string
  ): Promise<string> {
    // If already a GCS URI, return as-is
    if (fileRef.startsWith('gs://')) {
      this.logger.log(`File already in GCS: ${fileRef}`);
      return fileRef;
    }

    // Check if file exists in GCS using deterministic path
    const fileName = fileRef.split('/').pop() || 'video';
    const expectedGcsUri = await this.googleCloudService.getExpectedGcsUri(
      mediaId,
      fileName
    );

    const exists =
      await this.googleCloudService.checkGcsFileExists(expectedGcsUri);

    if (exists) {
      this.logger.log(`Found existing file in GCS: ${expectedGcsUri}`);
      return expectedGcsUri;
    }

    // File not in GCS - this shouldn't happen if upload step ran first
    throw new Error(
      `File not found in GCS: ${expectedGcsUri}. Upload step should run before this step.`
    );
  }

  /**
   * Resolve file path and upload to GCS if needed
   * Returns GCS URI (gs://bucket/path)
   * @deprecated Use upload step instead
   */
  private async resolveAndUploadToGcs(
    fileRef: string,
    mediaId: string
  ): Promise<string> {
    // If already a GCS URI, return as-is
    if (fileRef.startsWith('gs://')) {
      this.logger.log(`File already in GCS: ${fileRef}`);
      return fileRef;
    }

    // For local or S3 files, we need to upload to GCS
    this.logger.log(`Resolving local file path for: ${fileRef}`);

    // Get local file path (downloads from S3 if needed)
    const localPath = await this.storageService.resolveFilePath({
      storagePath: fileRef,
    });

    this.logger.log(`Uploading local file to GCS: ${localPath}`);

    // Upload to GCS temp bucket
    const gcsUri = await this.googleCloudService.uploadToGcsTempBucket(
      localPath,
      mediaId
    );

    return gcsUri;
  }

  /**
   * Ensure file path is a GCS URI
   * Google Speech-to-Text API requires gs:// URIs
   * @deprecated Use resolveAndUploadToGcs instead
   */
  private ensureGcsUri(filePath: string): string {
    // If already a GCS URI, return as-is
    if (filePath.startsWith('gs://')) {
      return filePath;
    }

    // If it's an S3 path or local path, we need to construct a GCS URI
    // This assumes the file has already been uploaded to GCS
    if (filePath.includes('s3://') || filePath.startsWith('/')) {
      throw new Error(
        'Speech-to-Text requires GCS URI (gs://). ' +
          'File must be uploaded to Google Cloud Storage before transcription.'
      );
    }

    // Assume it's a relative path within the default GCS bucket
    const bucket = process.env.GCS_BUCKET || 'default-bucket';
    return `gs://${bucket}/${filePath}`;
  }

  /**
   * Get the processor version for this step
   */
  getProcessorVersion(): string {
    return this.processorVersion;
  }

  /**
   * Get total transcript length from speech-to-text response
   */
  private getTranscriptLength(response: SpeechToTextResponse): number {
    return response.transcript?.length || 0;
  }

  /**
   * Get total word count from speech-to-text response
   */
  private getWordCount(response: SpeechToTextResponse): number {
    return response.words?.length || 0;
  }
}
