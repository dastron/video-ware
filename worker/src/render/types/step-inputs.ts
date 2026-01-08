import type {
  ProbeOutput,
  RenderTimelinePayload,
  Media,
} from '@project/shared';

/**
 * Input for the RESOLVE_CLIPS step
 * Resolves media files for all timeline clips
 */
export interface ResolveClipsStepInput {
  type: 'resolve_clips';
  /** ID of the timeline being rendered */
  timelineId: string;
  /** Edit list from the render payload */
  editList: RenderTimelinePayload['editList'];
}

/**
 * Output from the RESOLVE_CLIPS step
 */
export interface ResolveClipsOutput {
  /** Map of clip ID to resolved media and file path */
  clipMediaMap: Record<string, { media: Media; filePath: string }>;
}

/**
 * Input for the COMPOSE step
 * Builds FFmpeg command and executes timeline composition
 */
export interface ComposeStepInput {
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
 * Output from the COMPOSE step
 */
export interface ComposeOutput {
  /** Local path to the rendered video file */
  outputPath: string;
  /** Probe output of the rendered video */
  probeOutput: ProbeOutput;
}

/**
 * Input for the UPLOAD step
 * Uploads rendered video to storage
 */
export interface UploadStepInput {
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
 * Output from the UPLOAD step
 */
export interface UploadOutput {
  /** Storage path where the file was uploaded */
  storagePath: string;
}

/**
 * Input for the CREATE_RECORDS step
 * Creates File, Media, and TimelineRender records
 */
export interface CreateRecordsStepInput {
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
 * Output from the CREATE_RECORDS step
 */
export interface CreateRecordsOutput {
  /** ID of the created File record */
  fileId: string;
  /** ID of the created Media record */
  mediaId: string;
  /** ID of the created TimelineRender record */
  timelineRenderId: string;
}
