import { Injectable, Logger } from '@nestjs/common';
import { GoogleCloudService, VideoIntelligenceResult } from '../../shared/services/google-cloud.service';
import type { DetectLabelsConfig } from '@project/shared';

export interface VideoIntelligenceStrategyResult {
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

@Injectable()
export class VideoIntelligenceStrategy {
  private readonly logger = new Logger(VideoIntelligenceStrategy.name);

  constructor(private readonly googleCloudService: GoogleCloudService) {}

  /**
   * Detect labels, objects, and scene changes using Google Video Intelligence API
   */
  async detectLabels(
    gcsUri: string,
    config: DetectLabelsConfig
  ): Promise<VideoIntelligenceStrategyResult> {
    this.logger.log(`Starting video intelligence analysis for: ${gcsUri}`);

    try {
      // Determine which features to enable based on config
      const features: string[] = [];
      
      if (config.detectLabels !== false) {
        features.push('LABEL_DETECTION');
      }
      
      if (config.detectObjects !== false) {
        features.push('OBJECT_TRACKING');
      }
      
      // Always include shot change detection for scene changes
      features.push('SHOT_CHANGE_DETECTION');

      // Call Google Cloud Video Intelligence API
      const result = await this.googleCloudService.analyzeVideo(gcsUri, features);

      // Filter results based on confidence threshold
      const confidenceThreshold = config.confidenceThreshold || 0.5;

      const filteredLabels = result.labels.filter(
        label => label.confidence >= confidenceThreshold
      );

      const filteredObjects = result.objects.filter(
        obj => obj.confidence >= confidenceThreshold
      );

      this.logger.log(
        `Video intelligence analysis completed: ${filteredLabels.length} labels, ${filteredObjects.length} objects, ${result.sceneChanges.length} scene changes`
      );

      return {
        labels: filteredLabels,
        objects: filteredObjects,
        sceneChanges: result.sceneChanges,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Video intelligence analysis failed: ${errorMessage}`);
      throw new Error(`Video Intelligence analysis failed: ${errorMessage}`);
    }
  }
}