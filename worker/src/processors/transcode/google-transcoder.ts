import type {
  MediaProcessor,
  ProbeOutput,
  ThumbnailConfig,
  SpriteConfig,
  TranscodeConfig,
} from '@project/shared';
import { ProcessingProvider } from '@project/shared';
import { TranscoderServiceClient } from '@google-cloud/video-transcoder';
import { VideoIntelligenceServiceClient } from '@google-cloud/video-intelligence';
import type { TypedPocketBase } from '@project/shared/types';

/**
 * Google Cloud Video Transcoder based media processor
 */
export class GoogleTranscoderProcessor implements MediaProcessor {
  readonly provider = ProcessingProvider.GOOGLE_TRANSCODER;
  readonly version = 'v1';

  private transcoderClient: TranscoderServiceClient;
  private videoIntelligenceClient: VideoIntelligenceServiceClient;
  private pb: TypedPocketBase | null = null;
  private projectId: string;
  private location: string;
  private jobPollingIntervalMs = 5000;

  constructor(pb?: TypedPocketBase) {
    this.pb = pb || null;
    this.transcoderClient = new TranscoderServiceClient();
    this.videoIntelligenceClient = new VideoIntelligenceServiceClient();
    this.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID || '';
    this.location = process.env.GOOGLE_CLOUD_LOCATION || 'us-central1';

    if (!this.projectId) {
      console.warn(
        '[GoogleTranscoderProcessor] GOOGLE_CLOUD_PROJECT_ID not set. API calls may fail.'
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

    // If we have PB, try to resolve upload or file record
    if (this.pb) {
      // Logic to get GCS URI from PB record would go here
      // For now, we assume the system stores GCS URIs in the record if using this processor
      // OR we might need to look up the file record and see if it has a GCS path.

      // Attempt to fetch record and check for gcs path property (if we added one)
      // or assume standard PB file path structure if mounted on GCSFuse (unlikely for workers)
      // For this implementation, we will assume fileRef might be a direct GCS URI
      // or we need to implement lookup logic if it's an ID.
      try {
        // Try to get upload record
        try {
          const upload = await this.pb.collection('Uploads').getOne(fileRef);
          // TODO: we need a way to know the GCS URI from the upload record
          // For now, assuming the originalFile might be stored with a full path or we construct it.
          // This is a placeholder logic.
          const filename = Array.isArray(upload.originalFile)
            ? upload.originalFile[0]
            : upload.originalFile;
          // Convention: gs://<bucket>/<collection>/<id>/<filename>
          const bucket = process.env.GOOGLE_CLOUD_STORAGE_BUCKET;
          if (bucket) {
            return `gs://${bucket}/${upload.collectionId}/${upload.id}/${filename}`;
          }
        } catch {
          // ignore
        }
      } catch (e) {
        console.error('Error resolving GCS URI', e);
      }
    }

    throw new Error(
      `Cannot resolve ${fileRef} to GCS URI. Ensure file is in GCS and GOOGLE_CLOUD_STORAGE_BUCKET is set.`
    );
  }

  /**
   * Helper to construct output GCS URI
   */
  private getOutputUri(filename: string): string {
    const bucket = process.env.GOOGLE_CLOUD_STORAGE_BUCKET;
    if (!bucket) throw new Error('GOOGLE_CLOUD_STORAGE_BUCKET not set');
    return `gs://${bucket}/processed/${filename}/`; // Transcoder expects directory for output
  }

  async probe(fileRef: string): Promise<ProbeOutput> {
    // NOTE: Video Transcoder is for transcoding. For probing, we use Video Intelligence.
    console.log(`[GoogleTranscoderProcessor] Probing ${fileRef}`);
    // const gcsUri = await this.resolveToGcsUri(fileRef);

    // const request = {
    //   inputUri: gcsUri,
    //   features: ['LABEL_DETECTION'], // Minimal feature to check file
    //   videoContext: {
    //     labelDetectionConfig: {
    //       videoConfidenceThreshold: 0.5,
    //     },
    //   },
    // };

    // In a real implementation we would use Video Intelligence to get duration/dimensions
    // However, Video Intelligence is async operation.
    // An alternative is to just assume we can't easily get strict probe data
    // without running a full analysis operation which costs money and time.
    // For MVP, we might want to skip detailed probe or use a lightweight cloud function.
    // Or, since we are likely running this worker in an environment that might have ffmpeg,
    // we could download the first few bytes.

    // Returning mock for now as full video intelligence implementation is complex
    // and might not return all codec details easily.
    return {
      duration: 0, // Placeholder
      width: 0,
      height: 0,
      codec: 'unknown',
      fps: 0,
    };
  }

  async generateThumbnail(
    fileRef: string,
    _config: ThumbnailConfig,
    _identifier?: string
  ): Promise<string> {
    console.log(`[GoogleTranscoderProcessor] Generating thumbnail ${fileRef}`);
    const bucket = process.env.GOOGLE_CLOUD_STORAGE_BUCKET;
    if (!bucket) throw new Error('GOOGLE_CLOUD_STORAGE_BUCKET not set');

    // const gcsUri = await this.resolveToGcsUri(fileRef);
    const outputUri = `gs://${bucket}/thumbnails/`;
    // const outputFilename = `thumbnail_${Date.now()}.jpg`; // Transcoder actually controls naming somewhat based on pattern

    // const job = {
    //   inputUri: gcsUri,
    //   outputUri: outputUri,
    //   config: {
    //     // Define sprite sheet task which can act as thumbnail
    //     spriteSheets: [
    //       {
    //         filePrefix: 'thumbnail-',
    //         columnCount: 1,
    //         rowCount: 1,
    //         spriteWidthPixels: config.width,
    //         spriteHeightPixels: config.height,
    //         startTimeOffset:
    //           config.timestamp === 'midpoint' ? '0s' : `${config.timestamp}s`, // TODO: specific time
    //       },
    //     ],
    //   },
    // };

    // We would submit job and wait.
    // const [operation] = await this.transcoderClient.createJob({parent: parent, job: job});
    // await operation.promise();

    return `${outputUri}thumbnail-0000000000.jpeg`;
  }

  async generateSprite(
    fileRef: string,
    _config: SpriteConfig,
    _identifier?: string
  ): Promise<string> {
    // Similar implementation to thumbnail but with multiple cols/rows
    console.log(`[GoogleTranscoderProcessor] Generating sprite ${fileRef}`);
    return 'gs://bucket/path/to/sprite.jpg';
  }

  async transcode(
    fileRef: string,
    _config: TranscodeConfig,
    _outputFileName?: string,
    _identifier?: string
  ): Promise<string> {
    console.log(`[GoogleTranscoderProcessor] Transcoding ${fileRef}`);
    return 'gs://bucket/path/to/video.mp4';
  }
}
