import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { StorageService } from '../shared/services/storage.service';
import { VideoIntelligenceStrategy } from './strategies/video-intelligence.strategy';
import { SpeechToTextStrategy } from './strategies/speech-to-text.strategy';
import { FlowService } from '../queue/flow.service';
import type {
  Task,
  DetectLabelsPayload,
  DetectLabelsResult,
  File as FileRecord,
} from '@project/shared';

export interface IntelligenceData {
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
  transcription?: {
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
  };
}

@Injectable()
export class IntelligenceService {
  private readonly logger = new Logger(IntelligenceService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService,
    private readonly videoIntelligenceStrategy: VideoIntelligenceStrategy,
    private readonly speechToTextStrategy: SpeechToTextStrategy,
    private readonly flowService: FlowService
  ) {}

  /**
   * Process intelligence extraction task using the new flow-based architecture
   * Creates a parent-child job flow instead of monolithic processing
   */
  async processTask(task: Task): Promise<string> {
    const payload = task.payload as DetectLabelsPayload;
    this.logger.log(
      `Creating intelligence flow for task ${task.id}, media ${payload.mediaId}`
    );

    // Create the flow using FlowService
    const parentJobId = await this.flowService.createIntelligenceFlow(task);

    this.logger.log(
      `Intelligence flow created for task ${task.id}, parent job: ${parentJobId}`
    );

    return parentJobId;
  }

  /**
   * Legacy method for backward compatibility
   * This will be removed once all callers are updated to use the flow-based approach
   * @deprecated Use processTask instead
   */
  async processTaskLegacy(
    task: Task,
    progressCallback: (progress: number) => void
  ): Promise<DetectLabelsResult> {
    const payload = task.payload as DetectLabelsPayload;
    const { mediaId, fileRef, config } = payload;

    this.logger.log(`Processing intelligence task for media ${mediaId}`);

    try {
      // Get media record
      const media = await this.pocketbaseService.mediaMutator.getById(mediaId);
      if (!media) {
        throw new Error(`Media ${mediaId} not found`);
      }

      // Get file record to determine file path
      const file = await this.pocketbaseService.fileMutator.getById(fileRef);
      if (!file) {
        throw new Error(`File ${fileRef} not found`);
      }

      // Resolve file path for processing
      if (!file.s3Key) {
        throw new Error(`File ${file.id} has no storage path (s3Key)`);
      }
      const fileSource = Array.isArray(file.fileSource)
        ? file.fileSource[0]
        : file.fileSource;
      const filePath = await this.storageService.resolveFilePath({
        storagePath: file.s3Key,
        fileSource: fileSource,
        recordId: file.id,
      });

      progressCallback(10);

      // Check if intelligence data already exists (idempotency)
      const existingIntelligence = await this.getExistingIntelligence(mediaId);
      if (
        existingIntelligence &&
        this.isIntelligenceComplete(existingIntelligence, config)
      ) {
        this.logger.log(
          `Intelligence data already exists for media ${mediaId}, skipping`
        );
        progressCallback(100);
        return this.createResult(existingIntelligence);
      }

      // Perform video intelligence analysis
      progressCallback(20);
      let videoIntelligenceResult;
      try {
        // Convert file path to GCS URI if needed
        const gcsUri = await this.ensureGcsUri(filePath, file);
        videoIntelligenceResult =
          await this.videoIntelligenceStrategy.detectLabels(gcsUri, config);
        this.logger.log(
          `Video intelligence completed: ${videoIntelligenceResult.labels.length} labels, ${videoIntelligenceResult.objects.length} objects`
        );
      } catch (error) {
        this.logger.error(
          `Video intelligence failed: ${error instanceof Error ? error.message : String(error)}`
        );
        // Continue without video intelligence data
        videoIntelligenceResult = {
          labels: [],
          objects: [],
          sceneChanges: [],
        };
      }

      progressCallback(60);

      // Perform speech-to-text analysis
      let speechResult;
      try {
        speechResult = await this.speechToTextStrategy.transcribe(filePath);
        this.logger.log(
          `Speech transcription completed: ${speechResult.transcript.length} characters`
        );
      } catch (error) {
        this.logger.error(
          `Speech transcription failed: ${error instanceof Error ? error.message : String(error)}`
        );
        // Continue without speech data
        speechResult = {
          transcript: '',
          confidence: 0,
          words: [],
          languageCode: 'en-US',
          hasAudio: false,
        };
      }

      progressCallback(80);

      // Combine results
      const intelligenceData: IntelligenceData = {
        labels: videoIntelligenceResult.labels,
        objects: videoIntelligenceResult.objects,
        sceneChanges: videoIntelligenceResult.sceneChanges,
        transcription: speechResult,
      };

      // Store results in PocketBase
      await this.storeIntelligenceData(mediaId, intelligenceData);

      progressCallback(100);

      this.logger.log(`Intelligence processing completed for media ${mediaId}`);

      return this.createResult(intelligenceData);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Intelligence processing failed for media ${mediaId}: ${errorMessage}`
      );
      throw new Error(`Intelligence processing failed: ${errorMessage}`);
    }
  }

  /**
   * Get existing intelligence data for a media record
   */
  private async getExistingIntelligence(
    mediaId: string
  ): Promise<IntelligenceData | null> {
    try {
      // Get the latest media label record for this media
      const mediaLabel =
        await this.pocketbaseService.mediaLabelMutator.getLatestByMedia(
          mediaId
        );
      if (!mediaLabel) {
        return null;
      }

      // Check if intelligence data exists in the media label record
      if (mediaLabel.labels || mediaLabel.objects || mediaLabel.transcription) {
        return {
          labels: mediaLabel.labels || [],
          objects: mediaLabel.objects || [],
          sceneChanges: mediaLabel.sceneChanges || [],
          transcription: mediaLabel.transcription || undefined,
        };
      }

      return null;
    } catch (error) {
      this.logger.warn(
        `Failed to get existing intelligence data: ${error instanceof Error ? error.message : String(error)}`
      );
      return null;
    }
  }

  /**
   * Check if intelligence data is complete based on config
   */
  private isIntelligenceComplete(
    data: IntelligenceData,
    config: DetectLabelsPayload['config']
  ): boolean {
    // Check if required data exists based on config
    if (
      config.detectLabels !== false &&
      (!data.labels || data.labels.length === 0)
    ) {
      return false;
    }

    if (
      config.detectObjects !== false &&
      (!data.objects || data.objects.length === 0)
    ) {
      return false;
    }

    // If speech detection is enabled and there's audio, check for transcription
    if (data.transcription?.hasAudio && !data.transcription.transcript) {
      return false;
    }

    return true;
  }

  /**
   * Ensure file path is a GCS URI for Google Cloud services
   */
  private async ensureGcsUri(
    filePath: string,
    file: FileRecord
  ): Promise<string> {
    // If already a GCS URI, return as-is
    if (filePath.startsWith('gs://')) {
      return filePath;
    }

    // If it's a local file, we need to upload it to GCS temporarily
    // This is a simplified implementation - in practice, you might want to
    // check if the file is already in GCS or handle different storage backends
    const bucket =
      this.configService.get<string>('storage.s3Bucket') || 'default-bucket';
    const gcsKey = `intelligence/temp/${file.id}_${Date.now()}.${this.getFileExtension(filePath)}`;

    // For now, construct the GCS URI assuming the file is already in GCS
    // In a real implementation, you'd need to handle the upload
    return `gs://${bucket}/${gcsKey}`;
  }

  /**
   * Get file extension from path
   */
  private getFileExtension(filePath: string): string {
    const parts = filePath.split('.');
    return parts.length > 1 ? parts[parts.length - 1] : 'mp4';
  }

  /**
   * Store intelligence data in PocketBase
   */
  private async storeIntelligenceData(
    mediaId: string,
    data: IntelligenceData
  ): Promise<void> {
    try {
      // Get media record to extract labelData (mediaData) for storage
      const media = await this.pocketbaseService.mediaMutator.getById(mediaId);
      if (!media) {
        throw new Error(`Media ${mediaId} not found`);
      }

      // Check if a media label already exists for this media
      const existingLabel =
        await this.pocketbaseService.mediaLabelMutator.getLatestByMedia(
          mediaId
        );

      const intelligenceData = {
        MediaRef: mediaId,
        labels: data.labels,
        objects: data.objects,
        sceneChanges: data.sceneChanges,
        transcription: data.transcription,
        intelligenceProcessedAt: new Date().toISOString(),
      };

      if (existingLabel) {
        // Update existing media label
        await this.pocketbaseService.mediaLabelMutator.update(
          existingLabel.id,
          intelligenceData
        );
        this.logger.log(`Updated existing media label for media ${mediaId}`);
      } else {
        // Create new media label
        await this.pocketbaseService.mediaLabelMutator.create(intelligenceData);
        this.logger.log(`Created new media label for media ${mediaId}`);
      }

      this.logger.log(`Stored intelligence data for media ${mediaId}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to store intelligence data: ${errorMessage}`);
      throw new Error(`Failed to store intelligence data: ${errorMessage}`);
    }
  }

  /**
   * Create result object for the task
   */
  private createResult(data: IntelligenceData): DetectLabelsResult {
    return {
      summary: {
        labelCount: data.labels.length,
        objectCount: data.objects.length,
      },
      processorVersion: 'google-cloud-intelligence:1.0.0',
    };
  }
}
