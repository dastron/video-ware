/**
 * Render job types
 * Defines step types, input types, and output types for render jobs
 */

import type {
  ProbeOutput,
  RenderTimelinePayload,
} from '../../types/task-contracts.js';
import type { Media } from '../../schema/media.js';

/**
 * Render step type enum
 * Defines all possible steps in a render job
 */
export enum RenderStepType {
  RESOLVE_CLIPS = 'render:resolve_clips',
  COMPOSE = 'render:compose',
  UPLOAD = 'render:upload',
  CREATE_RECORDS = 'render:create_records',
}

/**
 * Input for the RESOLVE_CLIPS step
 * Resolves media files for all timeline clips
 */
export interface TaskRenderResolveClipsStep {
  type: 'resolve_clips';
  /** ID of the timeline being rendered */
  timelineId: string;
  /** Edit list from the render payload */
  editList: RenderTimelinePayload['editList'];
}

/**
 * Input for the COMPOSE step
 * Builds FFmpeg command and executes timeline composition
 */
export interface TaskRenderComposeStep {
  type: 'compose';
  /** ID of the timeline being rendered */
  timelineId: string;
  /** Edit list from the render payload */
  editList: RenderTimelinePayload['editList'];
  /** Resolved clip media from RESOLVE_CLIPS step */
  clipMediaMap: Record<string, { media: Media; filePath: string }>;
  /** Output settings for the render */
  outputSettings: RenderTimelinePayload['outputSettings'];
  /** Temporary directory for output */
  tempDir: string;
}

/**
 * Input for the UPLOAD step
 * Uploads rendered video to storage
 */
export interface TaskRenderUploadStep {
  type: 'upload';
  /** ID of the timeline being rendered */
  timelineId: string;
  /** Workspace ID for storage path generation */
  workspaceId: string;
  /** Local path to the rendered video file */
  outputPath: string;
  /** Output format (e.g., 'mp4', 'mov') */
  format: string;
}

/**
 * Input for the CREATE_RECORDS step
 * Creates File, Media, and TimelineRender records
 */
export interface TaskRenderCreateRecordsStep {
  type: 'create_records';
  /** ID of the timeline being rendered */
  timelineId: string;
  /** Workspace ID */
  workspaceId: string;
  /** Timeline name for record naming */
  timelineName: string;
  /** Version number for the render */
  version: number;
  /** Local path to the rendered video file */
  outputPath: string;
  /** Storage path where the file was uploaded */
  storagePath: string;
  /** Probe output of the rendered video */
  probeOutput: ProbeOutput;
  /** Output format (e.g., 'mp4', 'mov') */
  format: string;
  /** Temporary directory to clean up */
  tempDir: string;
}

/**
 * Union type of all render step inputs
 */
export type TaskRenderInput =
  | TaskRenderResolveClipsStep
  | TaskRenderComposeStep
  | TaskRenderUploadStep
  | TaskRenderCreateRecordsStep;

// Legacy type aliases for backward compatibility during migration
/** @deprecated Use TaskRenderResolveClipsStep instead */
export type ResolveClipsStepInput = TaskRenderResolveClipsStep;
/** @deprecated Use TaskRenderComposeStep instead */
export type ComposeStepInput = TaskRenderComposeStep;
/** @deprecated Use TaskRenderUploadStep instead */
export type UploadStepInput = TaskRenderUploadStep;
/** @deprecated Use TaskRenderCreateRecordsStep instead */
export type CreateRecordsStepInput = TaskRenderCreateRecordsStep;
/** @deprecated Use TaskRenderInput instead */
export type RenderJobInput = TaskRenderInput;

/**
 * Output from the RESOLVE_CLIPS step
 */
export interface TaskRenderResolveClipsStepOutput {
  /** Map of clip ID to resolved media and file path */
  clipMediaMap: Record<string, { media: Media; filePath: string }>;
}

/**
 * Output from the COMPOSE step
 */
export interface TaskRenderComposeStepOutput {
  /** Local path to the rendered video file */
  outputPath: string;
  /** Probe output of the rendered video */
  probeOutput: ProbeOutput;
}

/**
 * Output from the UPLOAD step
 */
export interface TaskRenderUploadStepOutput {
  /** Storage path where the file was uploaded */
  storagePath: string;
}

/**
 * Output from the CREATE_RECORDS step
 */
export interface TaskRenderCreateRecordsStepOutput {
  /** ID of the created File record */
  fileId: string;
  /** ID of the created Media record */
  mediaId: string;
  /** ID of the created TimelineRender record */
  timelineRenderId: string;
}

/**
 * Union type of all render step outputs
 */
export type TaskRenderResult =
  | TaskRenderResolveClipsStepOutput
  | TaskRenderComposeStepOutput
  | TaskRenderUploadStepOutput
  | TaskRenderCreateRecordsStepOutput;

// Legacy type aliases for backward compatibility during migration
/** @deprecated Use TaskRenderResolveClipsStepOutput instead */
export type ResolveClipsOutput = TaskRenderResolveClipsStepOutput;
/** @deprecated Use TaskRenderComposeStepOutput instead */
export type ComposeOutput = TaskRenderComposeStepOutput;
/** @deprecated Use TaskRenderUploadStepOutput instead */
export type UploadOutput = TaskRenderUploadStepOutput;
/** @deprecated Use TaskRenderCreateRecordsStepOutput instead */
export type CreateRecordsOutput = TaskRenderCreateRecordsStepOutput;
/** @deprecated Use TaskRenderResult instead */
export type RenderJobResult = TaskRenderResult;
