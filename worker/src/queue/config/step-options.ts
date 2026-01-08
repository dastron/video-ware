import {
  TranscodeStepType,
  RenderStepType,
  IntelligenceStepType,
  DetectLabelsStepType,
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

  // Intelligence steps
  [IntelligenceStepType.VIDEO_INTELLIGENCE]: {
    attempts: 3,
    backoff: 120000, // 2 minutes
  },
  [IntelligenceStepType.SPEECH_TO_TEXT]: {
    attempts: 3,
    backoff: 120000, // 2 minutes
  },
  [IntelligenceStepType.STORE_RESULTS]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },

  // Detect Labels steps
  [DetectLabelsStepType.VIDEO_INTELLIGENCE]: {
    attempts: 3,
    backoff: 120000, // 2 minutes
  },
  [DetectLabelsStepType.SPEECH_TO_TEXT]: {
    attempts: 3,
    backoff: 120000, // 2 minutes
  },
  [DetectLabelsStepType.NORMALIZE_LABELS]: {
    attempts: 3,
    backoff: 30000, // 30 seconds
  },
  [DetectLabelsStepType.STORE_RESULTS]: {
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
