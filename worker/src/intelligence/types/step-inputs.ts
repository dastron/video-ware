import type { DetectLabelsConfig, ProcessingProvider } from '@project/shared';

/**
 * Output from the VIDEO_INTELLIGENCE step
 */
export interface VideoIntelligenceOutput {
  /** Detected labels with confidence scores and time segments */
  labels: Array<{
    entity: string;
    confidence: number;
    segments: Array<{
      startTime: number;
      endTime: number;
      confidence: number;
    }>;
  }>;
  /** Detected objects with bounding boxes and time offsets */
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
  /** Scene change detection results */
  sceneChanges: Array<{
    timeOffset: number;
  }>;
}

/**
 * Output from the SPEECH_TO_TEXT step
 */
export interface SpeechToTextOutput {
  /** Full transcript text */
  transcript: string;
  /** Overall confidence score */
  confidence: number;
  /** Word-level timing and confidence */
  words: Array<{
    word: string;
    startTime: number;
    endTime: number;
    confidence: number;
  }>;
  /** Detected language code */
  languageCode: string;
  /** Whether audio was detected in the file */
  hasAudio: boolean;
}

/**
 * Input for the VIDEO_INTELLIGENCE step
 * Detects labels, objects, and scene changes in video
 */
export interface VideoIntelligenceStepInput {
  type: 'video_intelligence';
  /** ID of the Media record being analyzed */
  mediaId: string;
  /** ID of the File record to analyze */
  fileRef: string;
  /** Path to the media file (local or GCS URI) */
  filePath: string;
  /** Processing provider to use */
  provider: ProcessingProvider;
  /** Detection configuration */
  config: DetectLabelsConfig;
}

/**
 * Input for the SPEECH_TO_TEXT step
 * Transcribes audio from video
 */
export interface SpeechToTextStepInput {
  type: 'speech_to_text';
  /** ID of the Media record being analyzed */
  mediaId: string;
  /** ID of the File record to analyze */
  fileRef: string;
  /** Path to the media file (local or GCS URI) */
  filePath: string;
  /** Processing provider to use */
  provider: ProcessingProvider;
}

/**
 * Input for the STORE_RESULTS step
 * Combines and stores intelligence results in PocketBase
 */
export interface StoreResultsStepInput {
  type: 'store_results';
  /** ID of the Media record being analyzed */
  mediaId: string;
  /** Video intelligence results (optional if step failed) */
  videoIntelligence?: VideoIntelligenceOutput;
  /** Speech-to-text results (optional if step failed) */
  speechToText?: SpeechToTextOutput;
}

/**
 * Output from the STORE_RESULTS step
 */
export interface StoreResultsOutput {
  /** ID of the created or updated MediaLabel record */
  mediaLabelId: string;
  /** Summary of stored data */
  summary: {
    labelCount: number;
    objectCount: number;
    hasTranscription: boolean;
  };
}
