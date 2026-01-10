/**
 * Step type enums for different task processing domains
 */

import { TranscodeStepType, RenderStepType } from '@project/shared/jobs';

export enum DetectLabelsStepType {
  UPLOAD_TO_GCS = 'labels:upload_to_gcs',

  // New GCVI processor step types
  LABEL_DETECTION = 'labels:label_detection',
  OBJECT_TRACKING = 'labels:object_tracking',
  FACE_DETECTION = 'labels:face_detection',
  PERSON_DETECTION = 'labels:person_detection',
  SPEECH_TRANSCRIPTION = 'labels:speech_transcription',
}

export enum RecommendationStepType {
  GENERATE_MEDIA_RECOMMENDATIONS = 'recommendations:generate_media',
  GENERATE_TIMELINE_RECOMMENDATIONS = 'recommendations:generate_timeline',
}

/**
 * Combined union type of all step types
 */
export type StepType =
  | TranscodeStepType
  | RenderStepType
  | DetectLabelsStepType
  | RecommendationStepType;

// Re-export RenderStepType for backward compatibility
export { RenderStepType };
