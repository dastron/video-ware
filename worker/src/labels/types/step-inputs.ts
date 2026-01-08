/**
 * Step types and input/output interfaces for detect_labels BullMQ flow
 */

import type { ProcessingProvider } from '@project/shared';
import type {
  VideoIntelligenceResponse,
  SpeechToTextResponse,
  NormalizedLabelClip,
} from './normalizer';

/**
 * Step types for detect_labels flow
 */
export enum DetectLabelsStep {
  VIDEO_INTELLIGENCE = 'labels:video_intelligence',
  SPEECH_TO_TEXT = 'labels:speech_to_text',
  NORMALIZE_LABELS = 'labels:normalize_labels',
  STORE_RESULTS = 'labels:store_results',
}

/**
 * Input for VIDEO_INTELLIGENCE step
 * Detects labels, objects, shots, and persons in video using Google Video Intelligence API
 */
export interface VideoIntelligenceStepInput {
  type: 'video_intelligence';
  /** ID of the Media record being analyzed */
  mediaId: string;
  /** ID of the File record to analyze */
  fileRef: string;
  /** GCS URI or local path to the media file */
  gcsUri: string;
  /** Processing provider to use */
  provider: ProcessingProvider;
  /** Detection configuration */
  config: {
    detectLabels?: boolean;
    detectObjects?: boolean;
    detectShots?: boolean;
    detectPersons?: boolean;
    confidenceThreshold?: number;
  };
  /** Storage path for cache check */
  cacheKey: string;
  /** Current data version */
  version: number;
  /** Current processor version */
  processor: string;
}

/**
 * Output from VIDEO_INTELLIGENCE step
 */
export interface VideoIntelligenceStepOutput {
  /** Raw provider response */
  response: VideoIntelligenceResponse;
  /** Storage path where raw JSON was stored */
  rawJsonPath: string;
  /** Whether cached data was used (no API call made) */
  usedCache: boolean;
  /** Processor version used */
  processor: string;
}

/**
 * Input for SPEECH_TO_TEXT step
 * Transcribes audio from video using Google Speech-to-Text API
 */
export interface SpeechToTextStepInput {
  type: 'speech_to_text';
  /** ID of the Media record being analyzed */
  mediaId: string;
  /** ID of the File record to analyze */
  fileRef: string;
  /** GCS URI or local path to the media file */
  gcsUri: string;
  /** Processing provider to use */
  provider: ProcessingProvider;
  /** Storage path for cache check */
  cacheKey: string;
  /** Current data version */
  version: number;
  /** Current processor version */
  processor: string;
}

/**
 * Output from SPEECH_TO_TEXT step
 */
export interface SpeechToTextStepOutput {
  /** Raw provider response */
  response: SpeechToTextResponse;
  /** Storage path where raw JSON was stored */
  rawJsonPath: string;
  /** Whether cached data was used (no API call made) */
  usedCache: boolean;
  /** Processor version used */
  processor: string;
}

/**
 * Input for NORMALIZE_LABELS step
 * Normalizes provider responses into label_clip format
 */
export interface NormalizeLabelsStepInput {
  type: 'normalize_labels';
  /** ID of the Media record being analyzed */
  mediaId: string;
  /** Workspace reference */
  workspaceRef: string;
  /** Current data version */
  version: number;
  /** Video intelligence results (optional if step failed) */
  videoIntelligence?: VideoIntelligenceStepOutput;
  /** Speech-to-text results (optional if step failed) */
  speechToText?: SpeechToTextStepOutput;
}

/**
 * Output from NORMALIZE_LABELS step
 */
export interface NormalizeLabelsStepOutput {
  /** Normalized label clips ready for storage */
  labelClips: NormalizedLabelClip[];
  /** Summary of normalized data */
  summary: {
    shotCount: number;
    objectCount: number;
    personCount: number;
    speechCount: number;
  };
}

/**
 * Input for STORE_RESULTS step
 * Upserts label_clips to PocketBase and updates Media record
 */
export interface StoreResultsStepInput {
  type: 'store_results';
  /** ID of the Media record being analyzed */
  mediaId: string;
  /** Workspace reference */
  workspaceRef: string;
  /** Task reference */
  taskRef: string;
  /** Current data version */
  version: number;
  /** Normalized label clips to store */
  labelClips: NormalizedLabelClip[];
  /** Processor version to set on Media record */
  processor: string;
  /** Provider used for processing */
  provider: ProcessingProvider;
}

/**
 * Output from STORE_RESULTS step
 */
export interface StoreResultsStepOutput {
  /** IDs of created/updated label_clip records */
  labelClipIds: string[];
  /** Summary of stored data */
  summary: {
    shotCount: number;
    objectCount: number;
    personCount: number;
    speechCount: number;
  };
}
