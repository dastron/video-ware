import type { File as FileRecord, ProbeOutput, ProcessUploadResult, TaskStatus } from '@project/shared';

/**
 * Internal result from processing operations containing local file paths
 * and probe output before uploading to storage
 */
export interface InternalProcessResult {
  /** Local path to generated thumbnail */
  thumbnailPath: string;
  /** Local path to generated sprite sheet */
  spritePath: string;
  /** Local path to transcoded proxy video (optional) */
  proxyPath?: string;
  /** Metadata extracted from the source media */
  probeOutput: ProbeOutput;
}

/**
 * Collection of file records created during processing
 */
export interface FileRecords {
  /** Thumbnail file record */
  thumbnail: FileRecord;
  /** Sprite sheet file record */
  sprite: FileRecord;
  /** Proxy/transcoded file record (optional) */
  proxy?: FileRecord;
}

/**
 * Update payload for task status changes
 */
export interface TaskUpdatePayload {
  status: TaskStatus;
  progress?: number;
  result?: ProcessUploadResult;
  errorLog?: string;
  updated?: string;
}

