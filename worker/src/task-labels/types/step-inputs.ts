/**
 * Step Input Types
 *
 * Input types for all five GCVI step processors.
 * These types define the data required to execute each processor step.
 */

/**
 * Base input type shared by all step processors
 */
export interface BaseStepInput {
  mediaId: string;
  workspaceRef: string;
  taskRef: string;
  version: number;
}

/**
 * Label Detection Step Input
 *
 * Processes video for label detection and shot change detection.
 * Features: LABEL_DETECTION, SHOT_CHANGE_DETECTION
 */
export interface LabelDetectionStepInput extends BaseStepInput {
  config?: {
    labelDetectionMode?: 'SHOT_MODE' | 'SHOT_AND_FRAME_MODE';
    videoConfidenceThreshold?: number; // default: 0.2
  };
}

/**
 * Object Tracking Step Input
 *
 * Processes video for object tracking with keyframe data.
 * Features: OBJECT_TRACKING
 */
export interface ObjectTrackingStepInput extends BaseStepInput {
  config?: Record<string, never>; // Uses default model, no additional config required
}

/**
 * Face Detection Step Input
 *
 * Processes video for face detection with attributes.
 * Features: FACE_DETECTION
 */
export interface FaceDetectionStepInput extends BaseStepInput {
  config?: {
    includeBoundingBoxes?: boolean; // default: true
    includeAttributes?: boolean; // default: true
  };
}

/**
 * Person Detection Step Input
 *
 * Processes video for person detection with landmarks and attributes.
 * Features: PERSON_DETECTION
 */
export interface PersonDetectionStepInput extends BaseStepInput {
  config?: {
    includeBoundingBoxes?: boolean; // default: true
    includePoseLandmarks?: boolean; // default: true
    includeAttributes?: boolean; // default: true
  };
}

/**
 * Speech Transcription Step Input
 *
 * Processes video for speech transcription.
 * Features: SPEECH_TRANSCRIPTION
 */
export interface SpeechTranscriptionStepInput extends BaseStepInput {
  config?: {
    languageCode?: string; // default: 'en-US'
    enableAutomaticPunctuation?: boolean; // default: true
  };
}
