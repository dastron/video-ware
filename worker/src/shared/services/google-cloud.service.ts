import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Google Cloud Video Intelligence
import {
  VideoIntelligenceServiceClient,
  protos,
} from '@google-cloud/video-intelligence';
const Feature = protos.google.cloud.videointelligence.v1.Feature;
const LabelDetectionMode =
  protos.google.cloud.videointelligence.v1.LabelDetectionMode;

// Google Cloud Speech-to-Text
import { SpeechClient } from '@google-cloud/speech';

// Google Cloud Transcoder
import { TranscoderServiceClient } from '@google-cloud/video-transcoder';

type gcLabelDetectionMode =
  protos.google.cloud.videointelligence.v1.LabelDetectionMode;
type gcObjectAnnotation =
  protos.google.cloud.videointelligence.v1.IObjectTrackingAnnotation;
type gcLabelAnnotation =
  protos.google.cloud.videointelligence.v1.ILabelAnnotation;
type gcFeatures = protos.google.cloud.videointelligence.v1.Feature[];

export interface VideoIntelligenceResult {
  labels: Array<{
    entity: string;
    confidence: number;
    segments: Array<{
      startTime: number;
      endTime: number;
      confidence: number;
    }>;
  }>;
  objects: Array<{
    entity: string;
    confidence: number;
    frames: Array<{
      timeOffset: number;
      boundingBox: {
        left: number;
        top: number;
        right: number;
        bottom: number;
      };
    }>;
  }>;
  sceneChanges: Array<{
    timeOffset: number;
  }>;
}

export interface SpeechTranscriptionResult {
  transcript: string;
  confidence: number;
  words: Array<{
    word: string;
    startTime: number;
    endTime: number;
    confidence: number;
  }>;
  languageCode: string;
}

export interface TranscoderJobResult {
  jobId: string;
  state: string;
  outputUri: string;
  progress?: number;
  error?: string;
}

@Injectable()
export class GoogleCloudService implements OnModuleInit {
  private readonly logger = new Logger(GoogleCloudService.name);

  private videoIntelligenceClient!: VideoIntelligenceServiceClient;
  private speechClient!: SpeechClient;
  private transcoderClient!: TranscoderServiceClient;

  private readonly projectId: string;
  private readonly keyFilename?: string;
  private readonly enabled: {
    videoIntelligence: boolean;
    speech: boolean;
    transcoder: boolean;
  };

  constructor(private readonly configService: ConfigService) {
    this.projectId = this.configService.get<string>(
      'google.projectId'
    ) as string;
    this.keyFilename = this.configService.get<string>('google.keyFilename');

    this.enabled = {
      videoIntelligence: this.configService.get<boolean>(
        'processors.enableGoogleVideoIntelligence',
        false
      ),
      speech: this.configService.get<boolean>(
        'processors.enableGoogleSpeech',
        false
      ),
      transcoder: this.configService.get<boolean>(
        'processors.enableGoogleTranscoder',
        false
      ),
    };
  }

  async onModuleInit() {
    await this.initializeClients();
  }

  private async initializeClients() {
    if (!this.projectId) {
      this.logger.warn(
        'Google Cloud Project ID not configured. Google Cloud services will be disabled.'
      );
      return;
    }

    const clientConfig = {
      projectId: this.projectId,
      ...(this.keyFilename && { keyFilename: this.keyFilename }),
    };

    try {
      // Initialize Video Intelligence client
      if (this.enabled.videoIntelligence) {
        this.videoIntelligenceClient = new VideoIntelligenceServiceClient(
          clientConfig
        );
        this.logger.log('Google Cloud Video Intelligence client initialized');
      }

      // Initialize Speech client
      if (this.enabled.speech) {
        this.speechClient = new SpeechClient(clientConfig);
        this.logger.log('Google Cloud Speech-to-Text client initialized');
      }

      // Initialize Transcoder client
      if (this.enabled.transcoder) {
        this.transcoderClient = new TranscoderServiceClient(clientConfig);
        this.logger.log('Google Cloud Transcoder client initialized');
      }

      this.logger.log('Google Cloud services initialized successfully');
    } catch (error) {
      this.logger.error(
        `Failed to initialize Google Cloud clients: ${error instanceof Error ? error.message : String(error)}`
      );
      throw error;
    }
  }

  /**
   * Analyze video for labels, objects, and scene changes
   */
  async analyzeVideo(
    gcsUri: string,
    features: string[] = [
      'LABEL_DETECTION',
      'OBJECT_TRACKING',
      'SHOT_CHANGE_DETECTION',
    ]
  ): Promise<VideoIntelligenceResult> {
    if (!this.videoIntelligenceClient) {
      throw new Error('Video Intelligence client not initialized');
    }

    try {
      this.logger.log(`Starting video analysis for: ${gcsUri}`);

      const request = {
        inputUri: gcsUri,
        features: features as unknown as gcFeatures,
        videoContext: {
          labelDetectionConfig: {
            labelDetectionMode:
              'SHOT_AND_FRAME_MODE' as unknown as gcLabelDetectionMode,
            stationaryCamera: false,
          },
          objectTrackingConfig: {
            model: 'builtin/latest',
          },
          shotChangeDetectionConfig: {
            model: 'builtin/latest',
          },
        },
      };
      const [operation] =
        await this.videoIntelligenceClient.annotateVideo(request);
      this.logger.log(`Video analysis operation started: ${operation.name}`);

      // Wait for operation to complete
      const [result] = await operation.promise();

      if (!result.annotationResults || result.annotationResults.length === 0) {
        throw new Error('No annotation results returned');
      }

      const annotation = result.annotationResults[0];

      // Process labels
      const labels = (annotation.segmentLabelAnnotations || []).map(
        (label: gcLabelAnnotation) => ({
          entity: label.entity?.description || '',
          confidence: label.segments?.[0]?.confidence || 0,
          segments: (label.segments || []).map((segment: any) => ({
            startTime: this.parseTimeOffset(segment.segment?.startTimeOffset),
            endTime: this.parseTimeOffset(segment.segment?.endTimeOffset),
            confidence: segment.confidence || 0,
          })),
        })
      );

      // Process objects
      const objects = (annotation.objectAnnotations || []).map(
        (obj: gcObjectAnnotation) => ({
          entity: obj.entity?.description || '',
          confidence: obj.confidence || 0,
          frames: (obj.frames || []).map((frame) => ({
            timeOffset: this.parseTimeOffset(frame.timeOffset),
            boundingBox: {
              left: frame.normalizedBoundingBox?.left || 0,
              top: frame.normalizedBoundingBox?.top || 0,
              right: frame.normalizedBoundingBox?.right || 0,
              bottom: frame.normalizedBoundingBox?.bottom || 0,
            },
          })),
        })
      );

      // Process scene changes
      const sceneChanges = (annotation.shotAnnotations || []).map(
        (shot: any) => ({
          timeOffset: this.parseTimeOffset(shot.startTimeOffset),
        })
      );

      this.logger.log(
        `Video analysis completed: ${labels.length} labels, ${objects.length} objects, ${sceneChanges.length} scene changes`
      );

      return {
        labels,
        objects,
        sceneChanges,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Video analysis failed: ${errorMessage}`);
      throw new Error(`Video Intelligence analysis failed: ${errorMessage}`);
    }
  }

  /**
   * Transcribe speech from audio file
   */
  async transcribeSpeech(
    gcsUri: string,
    languageCode: string = 'en-US',
    enableWordTimeOffsets: boolean = true
  ): Promise<SpeechTranscriptionResult> {
    if (!this.speechClient) {
      throw new Error('Speech client not initialized');
    }

    try {
      this.logger.log(`Starting speech transcription for: ${gcsUri}`);

      const request = {
        audio: {
          uri: gcsUri,
        },
        config: {
          encoding: 'LINEAR16' as const,
          languageCode: languageCode,
          enableWordTimeOffsets: enableWordTimeOffsets,
          enableAutomaticPunctuation: true,
          model: 'video',
          useEnhanced: true,
        },
      };

      const [operation] = await this.speechClient.longRunningRecognize(request);
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
          languageCode,
        };
      }

      // Combine all results
      let fullTranscript = '';
      let totalConfidence = 0;
      const allWords: Array<{
        word: string;
        startTime: number;
        endTime: number;
        confidence: number;
      }> = [];

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
        `Speech transcription completed: ${fullTranscript.length} characters, ${allWords.length} words`
      );

      return {
        transcript: fullTranscript.trim(),
        confidence: avgConfidence,
        words: allWords,
        languageCode,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Speech transcription failed: ${errorMessage}`);
      throw new Error(`Speech transcription failed: ${errorMessage}`);
    }
  }

  /**
   * Create transcoding job
   */
  async createTranscodeJob(
    inputUri: string,
    outputUri: string,
    preset: string = 'preset/web-hd'
  ): Promise<TranscoderJobResult> {
    if (!this.transcoderClient) {
      throw new Error('Transcoder client not initialized');
    }

    try {
      this.logger.log(`Creating transcode job: ${inputUri} -> ${outputUri}`);

      const parent = `projects/${this.projectId}/locations/us-central1`;

      const request = {
        parent: parent,
        job: {
          inputUri: inputUri,
          outputUri: outputUri,
          templateId: preset,
        },
      };

      const [job] = await this.transcoderClient.createJob(request);

      if (!job.name) {
        throw new Error('Job creation failed - no job name returned');
      }

      this.logger.log(`Transcode job created: ${job.name}`);

      return {
        jobId: job.name,
        state: String(job.state || 'PENDING'),
        outputUri: outputUri,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Transcode job creation failed: ${errorMessage}`);
      throw new Error(`Transcoder job creation failed: ${errorMessage}`);
    }
  }

  /**
   * Get transcoding job status
   */
  async getTranscodeJobStatus(jobId: string): Promise<TranscoderJobResult> {
    if (!this.transcoderClient) {
      throw new Error('Transcoder client not initialized');
    }

    try {
      const [job] = await this.transcoderClient.getJob({ name: jobId });

      // Extract progress if available (may not be in IJob type definition)
      const jobWithProgress = job as typeof job & { progress?: number };

      return {
        jobId: job.name || jobId,
        state: (job.state as string) || 'UNKNOWN',
        outputUri: job.config?.output?.uri || '',
        progress: jobWithProgress.progress ?? 0,
        error: job.error?.message || undefined,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to get transcode job status: ${errorMessage}`);
      throw new Error(`Failed to get job status: ${errorMessage}`);
    }
  }

  /**
   * Health check for Video Intelligence service
   */
  async isVideoIntelligenceHealthy(): Promise<boolean> {
    if (!this.videoIntelligenceClient || !this.enabled.videoIntelligence) {
      return false;
    }

    try {
      // Simple health check - just verify client can make a request
      // We don't actually process anything, just check connectivity
      await this.videoIntelligenceClient.initialize();
      return true;
    } catch (error) {
      this.logger.warn(
        `Video Intelligence health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Health check for Speech service
   */
  async isSpeechHealthy(): Promise<boolean> {
    if (!this.speechClient || !this.enabled.speech) {
      return false;
    }

    try {
      // Simple health check - just verify client can make a request
      await this.speechClient.initialize();
      return true;
    } catch (error) {
      this.logger.warn(
        `Speech service health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Health check for Transcoder service
   */
  async isTranscoderHealthy(): Promise<boolean> {
    if (!this.transcoderClient || !this.enabled.transcoder) {
      return false;
    }

    try {
      // Simple health check - just verify client can make a request
      await this.transcoderClient.initialize();
      return true;
    } catch (error) {
      this.logger.warn(
        `Transcoder service health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  /**
   * Overall health check for all enabled Google Cloud services
   */
  async isHealthy(): Promise<boolean> {
    const checks = [];

    if (this.enabled.videoIntelligence) {
      checks.push(this.isVideoIntelligenceHealthy());
    }
    if (this.enabled.speech) {
      checks.push(this.isSpeechHealthy());
    }
    if (this.enabled.transcoder) {
      checks.push(this.isTranscoderHealthy());
    }

    if (checks.length === 0) {
      // No services enabled
      return true;
    }

    try {
      const results = await Promise.all(checks);
      return results.every((result) => result === true);
    } catch (error) {
      this.logger.error(
        `Google Cloud health check failed: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
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

  /**
   * Get enabled services
   */
  getEnabledServices(): string[] {
    const services = [];
    if (this.enabled.videoIntelligence) services.push('Video Intelligence');
    if (this.enabled.speech) services.push('Speech-to-Text');
    if (this.enabled.transcoder) services.push('Transcoder');
    return services;
  }
}
