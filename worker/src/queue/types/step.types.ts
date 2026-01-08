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
  UPLOAD_TO_GCS = 'labels:upload_to_gcs',
  VIDEO_INTELLIGENCE = 'labels:video_intelligence',
  PROCESS_VIDEO_INTELLIGENCE_LABELS = 'labels:process_video_intelligence_labels',
  SPEECH_TO_TEXT = 'labels:speech_to_text',
  PROCESS_SPEECH_TO_TEXT_LABELS = 'labels:process_speech_to_text_labels',
}

/**
 * Combined union type of all step types
 */
export type StepType =
  | TranscodeStepType
  | RenderStepType
  | DetectLabelsStepType;
