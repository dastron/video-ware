import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService } from '../../../shared/services/google-cloud.service';
import type {
  IVideoIntelligenceExecutor,
  VideoIntelligenceConfig,
  VideoIntelligenceResult,
  VideoIntelligenceResponse,
} from '../interfaces';

/**
 * Google Cloud Video Intelligence executor
 *
 * Pure implementation of video analysis using Google Video Intelligence API.
 * No database operations - just API calls and response handling.
 */
@Injectable()
export class GoogleVideoIntelligenceExecutor
  implements IVideoIntelligenceExecutor
{
  private readonly logger = new Logger(GoogleVideoIntelligenceExecutor.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  async execute(
    gcsUri: string,
    config: VideoIntelligenceConfig
  ): Promise<VideoIntelligenceResult> {
    this.logger.log(`Analyzing video: ${gcsUri}`);

    // Build features array based on config
    const features: string[] = [];
    if (config.detectLabels) features.push('LABEL_DETECTION');
    if (config.detectObjects) features.push('OBJECT_TRACKING');
    if (config.detectShots) features.push('SHOT_CHANGE_DETECTION');
    if (config.detectPersons) features.push('PERSON_DETECTION');

    if (features.length === 0) {
      throw new Error('At least one detection feature must be enabled');
    }

    this.logger.debug(
      `Requesting features: ${features.join(', ')} with confidence threshold: ${config.confidenceThreshold ?? 0.5}`
    );

    // Call Google Video Intelligence API
    const response = await this.googleCloudService.analyzeVideo(
      gcsUri,
      features
    );

    this.logger.log(`Video analysis complete for ${gcsUri}`);

    return {
      response: response as VideoIntelligenceResponse,
      features,
    };
  }
}
