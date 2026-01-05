import type {
  MediaProcessor,
  ProbeOutput,
  ThumbnailConfig,
  SpriteConfig,
  DetectLabelsConfig,
  DetectLabelsResult,
} from '@project/shared';
import { ProcessingProvider } from '@project/shared';
import { VideoIntelligenceServiceClient } from '@google-cloud/video-intelligence';
import type { TypedPocketBase } from '@project/shared/types';

/**
 * Google Cloud Video Intelligence based media processor
 */
export class GoogleVideoIntelligenceProcessor implements MediaProcessor {
  readonly provider = ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE;
  readonly version = 'v1';

  private videoIntelligenceClient: VideoIntelligenceServiceClient;
  private pb: TypedPocketBase | null = null;
  private projectId: string;
  private location: string;

  constructor(pb?: TypedPocketBase) {
    this.pb = pb || null;
    this.videoIntelligenceClient = new VideoIntelligenceServiceClient();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
    this.location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

    if (!this.projectId) {
      console.warn(
        '[GoogleVideoIntelligenceProcessor] GOOGLE_CLOUD_PROJECT_ID not set. API calls may fail.'
      );
    }
  }

  /**
   * Helper to resolve file reference to GCS URI
   */
  private async resolveToGcsUri(fileRef: string): Promise<string> {
    if (fileRef.startsWith('gs://')) {
      return fileRef;
    }

    if (this.pb) {
      try {
        // Try to get upload record
        const upload = await this.pb.collection('Uploads').getOne(fileRef);
        const filename = Array.isArray(upload.originalFile)
          ? upload.originalFile[0]
          : upload.originalFile;
        const bucket = process.env.GOOGLE_CLOUD_STORAGE_BUCKET;
        if (bucket) {
          return `gs://${bucket}/${upload.collectionId}/${upload.id}/${filename}`;
        }
      } catch (e) {
        // Ignore and fallback
      }
    }

    throw new Error(
      `Cannot resolve ${fileRef} to GCS URI. Ensure file is in GCS and GOOGLE_CLOUD_STORAGE_BUCKET is set.`
    );
  }

  async probe(fileRef: string): Promise<ProbeOutput> {
    // This processor is mainly for intelligence, but we implement probe as per interface
    // In a real scenario, this might call Video Intelligence to get duration/dimensions
    return {
      duration: 0,
      width: 0,
      height: 0,
      codec: 'unknown',
      fps: 0,
    };
  }

  async generateThumbnail(
    fileRef: string,
    config: ThumbnailConfig
  ): Promise<string> {
    throw new Error(
      'generateThumbnail not supported by GoogleVideoIntelligenceProcessor'
    );
  }

  async generateSprite(fileRef: string, config: SpriteConfig): Promise<string> {
    throw new Error(
      'generateSprite not supported by GoogleVideoIntelligenceProcessor'
    );
  }

  async detectLabels(
    fileRef: string,
    config: DetectLabelsConfig
  ): Promise<DetectLabelsResult> {
    console.log(
      `[GoogleVideoIntelligenceProcessor] Detecting labels for ${fileRef}`
    );
    const gcsUri = await this.resolveToGcsUri(fileRef);

    const features: any[] = [];
    if (config.detectLabels !== false) features.push('LABEL_DETECTION');
    if (config.detectObjects) features.push('OBJECT_TRACKING');

    if (features.length === 0) {
      throw new Error('No features selected for Video Intelligence detection');
    }

    const request = {
      inputUri: gcsUri,
      features: features,
      videoContext: {
        labelDetectionConfig: {
          videoConfidenceThreshold: config.confidenceThreshold || 0.5,
        },
        objectTrackingConfig: {
          model: 'stable',
        },
      },
    };

    // NOTE: In a real production environment, this is a long-running operation.
    // We submit and wait, or use cloud events. For this implementation, we wait.
    const [operation] =
      await this.videoIntelligenceClient.annotateVideo(request);
    console.log('[GoogleVideoIntelligenceProcessor] Waiting for operation...');
    const [operationResult] = await operation.promise();

    const annotationResults = operationResult.annotationResults?.[0];
    const labelCount = annotationResults?.segmentLabelAnnotations?.length || 0;
    const objectCount = annotationResults?.objectAnnotations?.length || 0;

    return {
      summary: {
        labelCount,
        objectCount,
      },
      processorVersion: `google-video-intelligence:${this.version}`,
    };
  }
}
