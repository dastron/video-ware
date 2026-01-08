/**
 * Step type enums for different task processing domains
 */

export enum TranscodeStepType {
  PROBE = 'transcode:probe',
  THUMBNAIL = 'transcode:thumbnail',
  SPRITE = 'transcode:sprite',
  TRANSCODE = 'transcode:transcode',
  FINALIZE = 'transcode:finalize',
}

export enum RenderStepType {
  RESOLVE_CLIPS = 'render:resolve_clips',
  COMPOSE = 'render:compose',
  UPLOAD = 'render:upload',
  CREATE_RECORDS = 'render:create_records',
}

export enum DetectLabelsStepType {
  VIDEO_INTELLIGENCE = 'labels:video_intelligence',
  SPEECH_TO_TEXT = 'labels:speech_to_text',
  NORMALIZE_LABELS = 'labels:normalize_labels',
  STORE_RESULTS = 'labels:store_results',
}

/**
 * Combined union type of all step types
 */
export type StepType =
  | TranscodeStepType
  | RenderStepType
  | DetectLabelsStepType;
