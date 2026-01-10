/**
 * Executor interfaces for render operations
 * Step input/output types are now exported from @project/shared/jobs
 */

import type {
  ProbeOutput,
  RenderTimelinePayload,
  Media,
} from '@project/shared';

// Re-export step input/output types from shared for backward compatibility
export type {
  TaskRenderResolveClipsStep as ResolveClipsStepInput,
  TaskRenderComposeStep as ComposeStepInput,
  TaskRenderUploadStep as UploadStepInput,
  TaskRenderCreateRecordsStep as CreateRecordsStepInput,
  TaskRenderResolveClipsStepOutput as ResolveClipsOutput,
  TaskRenderComposeStepOutput as ComposeOutput,
  TaskRenderUploadStepOutput as UploadOutput,
  TaskRenderCreateRecordsStepOutput as CreateRecordsOutput,
} from '@project/shared/jobs';

// ============================================================================
// Executor Result Types
// ============================================================================

/**
 * Result from resolving clip media files
 */
export interface ResolveClipsResult {
  /** Map of clip ID to resolved media and file path */
  clipMediaMap: Record<string, { media: Media; filePath: string }>;
}

/**
 * Result from composing a timeline
 */
export interface ComposeResult {
  /** Local path to the rendered video file */
  outputPath: string;
  /** Probe output of the rendered video */
  probeOutput: ProbeOutput;
}

/**
 * Result from uploading a file
 */
export interface UploadResult {
  /** Storage path where the file was uploaded */
  storagePath: string;
}

// ============================================================================
// Executor Interfaces
// ============================================================================

/**
 * Executor for resolving clip media files
 */
export interface IResolveClipsExecutor {
  execute(
    timelineId: string,
    editList: RenderTimelinePayload['editList']
  ): Promise<ResolveClipsResult>;
}

/**
 * Executor for composing timeline using FFmpeg
 */
export interface IComposeExecutor {
  execute(
    editList: RenderTimelinePayload['editList'],
    clipMediaMap: Record<string, { media: Media; filePath: string }>,
    outputPath: string,
    outputSettings: RenderTimelinePayload['outputSettings'],
    onProgress?: (progress: number) => void
  ): Promise<ComposeResult>;
}

/**
 * Executor for uploading rendered files to storage
 */
export interface IUploadExecutor {
  execute(outputPath: string, storagePath: string): Promise<UploadResult>;
}
