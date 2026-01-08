/**
 * Step Output Types
 *
 * Output types for all five GCVI step processors.
 * These types define the data returned after each processor step completes.
 */

/**
 * Base output type shared by all step processors
 */
export interface BaseStepOutput {
  success: boolean;
  cacheHit: boolean;
  processorVersion: string;
  processingTimeMs?: number;
  error?: string;
}

/**
 * Entity counts returned by processors
 */
export interface EntityCounts {
  labelEntityCount: number;
  labelTrackCount: number;
  labelClipCount: number;
}

/**
 * Label Detection Step Output
 *
 * Results from label detection and shot change detection processing.
 */
export interface LabelDetectionStepOutput extends BaseStepOutput {
  counts: {
    segmentLabelCount: number;
    shotLabelCount: number;
    shotCount: number;
  } & EntityCounts;
}

/**
 * Object Tracking Step Output
 *
 * Results from object tracking processing.
 */
export interface ObjectTrackingStepOutput extends BaseStepOutput {
  counts: {
    objectCount: number;
    objectTrackCount: number;
  } & EntityCounts;
}

/**
 * Face Detection Step Output
 *
 * Results from face detection processing.
 */
export interface FaceDetectionStepOutput extends BaseStepOutput {
  counts: {
    faceCount: number;
    faceTrackCount: number;
  } & EntityCounts;
}

/**
 * Person Detection Step Output
 *
 * Results from person detection processing.
 */
export interface PersonDetectionStepOutput extends BaseStepOutput {
  counts: {
    personCount: number;
    personTrackCount: number;
  } & EntityCounts;
}

/**
 * Speech Transcription Step Output
 *
 * Results from speech transcription processing.
 */
export interface SpeechTranscriptionStepOutput extends BaseStepOutput {
  counts: {
    transcriptLength: number;
    wordCount: number;
  } & EntityCounts;
}

/**
 * Union type for all step outputs
 */
export type StepOutput =
  | LabelDetectionStepOutput
  | ObjectTrackingStepOutput
  | FaceDetectionStepOutput
  | PersonDetectionStepOutput
  | SpeechTranscriptionStepOutput;
