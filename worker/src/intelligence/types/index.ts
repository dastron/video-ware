/**
 * Intelligence types module
 * Exports step inputs, outputs, and result types for intelligence processing
 */

// Re-export step inputs
export type {
  VideoIntelligenceStepInput,
  SpeechToTextStepInput,
  StoreResultsStepInput,
  VideoIntelligenceOutput,
  SpeechToTextOutput,
  StoreResultsOutput,
} from './step-inputs';

// Intelligence step result types
import type { IntelligenceStepType } from '../../queue/types/step.types';
import type {
  VideoIntelligenceOutput,
  SpeechToTextOutput,
  StoreResultsOutput,
} from './step-inputs';

/**
 * Result type for VIDEO_INTELLIGENCE step
 */
export interface VideoIntelligenceStepResult {
  stepType: IntelligenceStepType.VIDEO_INTELLIGENCE;
  status: 'completed' | 'failed';
  output?: VideoIntelligenceOutput;
  error?: string;
}

/**
 * Result type for SPEECH_TO_TEXT step
 */
export interface SpeechToTextStepResult {
  stepType: IntelligenceStepType.SPEECH_TO_TEXT;
  status: 'completed' | 'failed';
  output?: SpeechToTextOutput;
  error?: string;
}

/**
 * Result type for STORE_RESULTS step
 */
export interface StoreResultsStepResult {
  stepType: IntelligenceStepType.STORE_RESULTS;
  status: 'completed' | 'failed';
  output?: StoreResultsOutput;
  error?: string;
}

/**
 * Union type of all intelligence step results
 */
export type IntelligenceStepResult =
  | VideoIntelligenceStepResult
  | SpeechToTextStepResult
  | StoreResultsStepResult;
