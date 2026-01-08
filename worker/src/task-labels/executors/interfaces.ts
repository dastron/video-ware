/**
 * Executor interfaces for label detection operations
 *
 * These define the contracts for different label detection providers.
 * Executors are pure strategy implementations with no database operations.
 */

import type { LabelType, LabelData } from '@project/shared';

/**
 * Google Video Intelligence API response structure
 */
export interface VideoIntelligenceResponse {
  annotationResults?: Array<{
    segmentLabelAnnotations?: Array<{
      entity?: {
        entityId?: string;
        description?: string;
      };
      segments?: Array<{
        segment?: {
          startTimeOffset?: string | { seconds?: number; nanos?: number };
          endTimeOffset?: string | { seconds?: number; nanos?: number };
        };
        confidence?: number;
      }>;
    }>;
    objectAnnotations?: Array<{
      entity?: {
        entityId?: string;
        description?: string;
      };
      confidence?: number;
      frames?: Array<{
        timeOffset?: string | { seconds?: number; nanos?: number };
        normalizedBoundingBox?: {
          left?: number;
          top?: number;
          right?: number;
          bottom?: number;
        };
      }>;
      segment?: {
        startTimeOffset?: string | { seconds?: number; nanos?: number };
        endTimeOffset?: string | { seconds?: number; nanos?: number };
      };
    }>;
    shotAnnotations?: Array<{
      startTimeOffset?: string | { seconds?: number; nanos?: number };
      endTimeOffset?: string | { seconds?: number; nanos?: number };
    }>;
    personDetectionAnnotations?: Array<{
      tracks?: Array<{
        segment?: {
          startTimeOffset?: string | { seconds?: number; nanos?: number };
          endTimeOffset?: string | { seconds?: number; nanos?: number };
        };
        confidence?: number;
        timestampedObjects?: Array<{
          timeOffset?: string | { seconds?: number; nanos?: number };
          normalizedBoundingBox?: {
            left?: number;
            top?: number;
            right?: number;
            bottom?: number;
          };
        }>;
      }>;
    }>;
  }>;
}

/**
 * Google Speech-to-Text API response structure
 */
export interface SpeechToTextResponse {
  results?: Array<{
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
      words?: Array<{
        startTime?: string | { seconds?: number; nanos?: number };
        endTime?: string | { seconds?: number; nanos?: number };
        word?: string;
      }>;
    }>;
    languageCode?: string;
  }>;
}

/**
 * Normalized label clip for storage
 */
export interface NormalizedLabelClip {
  labelType: LabelType;
  start: number; // seconds (float)
  end: number; // seconds (float)
  duration: number; // seconds (float)
  confidence: number; // 0-1
  labelData: LabelData;
}

/**
 * Configuration for video intelligence detection
 */
export interface VideoIntelligenceConfig {
  detectLabels?: boolean;
  detectObjects?: boolean;
  detectShots?: boolean;
  detectPersons?: boolean;
  confidenceThreshold?: number;
}

/**
 * Result from video intelligence detection
 */
export interface VideoIntelligenceResult {
  response: VideoIntelligenceResponse;
  features: string[];
}

/**
 * Executor for video intelligence operations
 */
export interface IVideoIntelligenceExecutor {
  /**
   * Analyze video using Video Intelligence API
   *
   * @param gcsUri - GCS URI of the video file
   * @param config - Detection configuration
   * @returns Video intelligence response with detected features
   */
  execute(
    gcsUri: string,
    config: VideoIntelligenceConfig
  ): Promise<VideoIntelligenceResult>;
}

/**
 * Result from speech-to-text transcription
 */
export interface SpeechToTextResult {
  response: SpeechToTextResponse;
}

/**
 * Executor for speech-to-text operations
 */
export interface ISpeechToTextExecutor {
  /**
   * Transcribe audio from video using Speech-to-Text API
   *
   * @param gcsUri - GCS URI of the video/audio file
   * @returns Speech-to-text response with transcription
   */
  execute(gcsUri: string): Promise<SpeechToTextResult>;
}
