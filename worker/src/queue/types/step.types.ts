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

export enum IntelligenceStepType {
  VIDEO_INTELLIGENCE = 'intelligence:video_intelligence',
  SPEECH_TO_TEXT = 'intelligence:speech_to_text',
  STORE_RESULTS = 'intelligence:store_results',
}

/**
 * Combined union type of all step types
 */
export type StepType =
  | TranscodeStepType
  | RenderStepType
  | IntelligenceStepType;
