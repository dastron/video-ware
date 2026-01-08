import type { Task } from '@project/shared';
import type { StepType } from './step.types';

/**
 * Base job data shared by all job types
 */
export interface BaseJobData {
  taskId: string;
  workspaceId: string;
  attemptNumber: number;
}

/**
 * Parent job data that orchestrates child steps
 */
export interface ParentJobData extends BaseJobData {
  task: Task;
  stepResults: Record<string, StepResult>;
}

/**
 * Step job data for individual processing steps
 */
export interface StepJobData extends BaseJobData {
  stepType: StepType;
  parentJobId: string;
  input: StepInput;
}

/**
 * Result of a step execution
 */
export interface StepResult {
  stepType: StepType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  output?: unknown;
  error?: string;
  startedAt?: string;
  completedAt?: string;
}

/**
 * Discriminated union for step-specific inputs
 * Each step type has its own input interface with a 'type' discriminator
 */
export type StepInput =
  // Transcode step inputs
  | import('../../transcode/types/step-inputs').ProbeStepInput
  | import('../../transcode/types/step-inputs').ThumbnailStepInput
  | import('../../transcode/types/step-inputs').SpriteStepInput
  | import('../../transcode/types/step-inputs').TranscodeStepInput
  | import('../../transcode/types/step-inputs').FinalizeStepInput
  // Render step inputs
  | import('../../render/types/step-inputs').ResolveClipsStepInput
  | import('../../render/types/step-inputs').ComposeStepInput
  | import('../../render/types/step-inputs').UploadStepInput
  | import('../../render/types/step-inputs').CreateRecordsStepInput
  // Intelligence step inputs
  | import('../../intelligence/types/step-inputs').VideoIntelligenceStepInput
  | import('../../intelligence/types/step-inputs').SpeechToTextStepInput
  | import('../../intelligence/types/step-inputs').StoreResultsStepInput;
