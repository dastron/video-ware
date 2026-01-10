import {
  TranscodeStepType,
  RenderStepType,
  DetectLabelsStepType,
  RecommendationStepType,
} from '../types/step.types';

/**
 * Job options configuration for each step type
 * Defines retry attempts and exponential backoff delays
 */
export interface StepJobOptions {
  attempts: number;
  backoff: number; // Initial backoff delay in milliseconds
}

/**
 * Step-specific job options with retry and backoff configuration
 */
export const STEP_JOB_OPTIONS: Record<string, StepJobOptions> = {
  // Transcode steps
  [TranscodeStepType.PROBE]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },
  [TranscodeStepType.THUMBNAIL]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },
  [TranscodeStepType.SPRITE]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },
  [TranscodeStepType.FILMSTRIP]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },
  [TranscodeStepType.TRANSCODE]: {
    attempts: 5,
    backoff: 60000, // 1 minute
  },
  [TranscodeStepType.FINALIZE]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },

  // Render steps
  [RenderStepType.RESOLVE_CLIPS]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },
  [RenderStepType.COMPOSE]: {
    attempts: 3,
    backoff: 60000, // 1 minute
  },
  [RenderStepType.UPLOAD]: {
    attempts: 5,
    backoff: 60000, // 1 minute
  },
  [RenderStepType.CREATE_RECORDS]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },

  // Detect Labels steps
  [DetectLabelsStepType.UPLOAD_TO_GCS]: {
    attempts: 3,
    backoff: 60000, // 1 minute
  },

  // Recommendation steps
  [RecommendationStepType.GENERATE_MEDIA_RECOMMENDATIONS]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },
  [RecommendationStepType.GENERATE_TIMELINE_RECOMMENDATIONS]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },
};

/**
 * Get job options for a specific step type
 * Returns default options if step type is not configured
 */
export function getStepJobOptions(stepType: string): StepJobOptions {
  return (
    STEP_JOB_OPTIONS[stepType] || {
      attempts: 3,
      backoff: 30000,
    }
  );
}
