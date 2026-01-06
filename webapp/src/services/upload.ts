import type { TypedPocketBase } from '@project/shared';
import {
  UploadMutator,
  TaskMutator,
  FileMutator,
} from '@project/shared/mutator';
import {
  UploadStatus,
  ProcessingProvider,
  type ProcessUploadPayload,
} from '@project/shared';
import type { Upload, Task } from '@project/shared';

/**
 * File validation result
 */
export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Upload service configuration
 */
export interface UploadServiceConfig {
  /** Allowed MIME types for uploads */
  allowedTypes?: string[];
  /** Maximum file size in bytes */
  maxSize?: number;
  /** Default processing provider */
  defaultProvider?: ProcessingProvider;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<UploadServiceConfig> = {
  allowedTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
  maxSize: 8 * 1024 * 1024 * 1024, // 8GB
  defaultProvider: ProcessingProvider.FFMPEG,
};

/**
 * Upload service that handles file uploads and processing orchestration
 * Validates files, manages upload lifecycle, and enqueues processing tasks
 */
export class UploadService {
  private pb: TypedPocketBase;
  private uploadMutator: UploadMutator;
  private taskMutator: TaskMutator;
  private fileMutator: FileMutator;
  private config: Required<UploadServiceConfig>;

  constructor(pb: TypedPocketBase, config?: UploadServiceConfig) {
    this.pb = pb;
    this.uploadMutator = new UploadMutator(pb);
    this.taskMutator = new TaskMutator(pb);
    this.fileMutator = new FileMutator(pb);
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Validate a file for upload
   * Checks file type and size against configured limits
   * @param file The file to validate
   * @returns Validation result with error message if invalid
   */
  validateFile(file: File): FileValidationResult {
    // Check file type
    if (!this.config.allowedTypes.includes(file.type)) {
      return {
        valid: false,
        error: `Invalid file type: ${file.type}. Allowed types: ${this.config.allowedTypes.join(', ')}`,
      };
    }

    // Check file size
    if (file.size > this.config.maxSize) {
      const maxSizeGB = this.config.maxSize / (1024 * 1024 * 1024);
      const fileSizeGB = (file.size / (1024 * 1024 * 1024)).toFixed(2);
      return {
        valid: false,
        error: `File too large: ${fileSizeGB}GB. Maximum allowed size: ${maxSizeGB}GB`,
      };
    }

    return { valid: true };
  }

  /**
   * Initiate an upload with file validation and task enqueueing
   * @param workspaceId The workspace ID
   * @param file The file to upload
   * @param userId Optional user ID (defaults to current authenticated user)
   * @param onProgress Optional progress callback
   * @returns The created upload record
   * @throws Error if validation fails or upload creation fails
   */
  async initiateUpload(
    workspaceId: string,
    file: File,
    userId?: string,
    _onProgress?: (progress: number) => void
  ): Promise<Upload> {
    // Validate file
    const validation = this.validateFile(file);
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    try {
      // Get current user ID if not provided (upload mutator will also handle this, but we need it for task creation)
      const currentUserId =
        userId || this.pb.authStore.record?.id || this.pb.authStore.model?.id;
      if (!currentUserId) {
        throw new Error('User must be authenticated to create uploads');
      }

      // Create upload record with file (UserRef will be set automatically by mutator if not provided)
      const upload = await this.uploadMutator.createWithFile(
        {
          name: file.name,
          size: file.size,
          status: UploadStatus.UPLOADING,
          WorkspaceRef: workspaceId,
          UserRef: userId, // Optional - mutator will use current user if not provided
        },
        file
      );

      // Update status to uploaded (file transfer complete)
      const updatedUpload = await this.uploadMutator.updateStatus(
        upload.id,
        UploadStatus.UPLOADED
      );

      // Enqueue processing task (use the upload's UserRef to ensure consistency)
      await this.enqueueProcessingTask(
        workspaceId,
        upload.id,
        upload.UserRef || currentUserId
      );

      return updatedUpload;
    } catch (error) {
      // If upload creation failed, throw with context
      if (error instanceof Error) {
        throw new Error(`Upload failed: ${error.message}`);
      }
      throw new Error('Upload failed: Unknown error');
    }
  }

  /**
   * Enqueue a processing task for an upload
   * @param workspaceId The workspace ID
   * @param uploadId The upload ID
   * @param userId Optional user ID
   * @returns The created task
   */
  private async enqueueProcessingTask(
    workspaceId: string,
    uploadId: string,
    _userId?: string
  ): Promise<Task> {
    // Default processing configuration
    const payload: ProcessUploadPayload = {
      uploadId,
      originalFileRef: uploadId, // Will be resolved by worker
      provider: this.config.defaultProvider,
      sprite: {
        fps: 1,
        cols: 10,
        rows: 10,
        tileWidth: 320,
        tileHeight: 180,
      },
      thumbnail: {
        timestamp: 'midpoint',
        width: 640,
        height: 360,
      },
      transcode: {
        enabled: true,
        codec: 'h265',
        resolution: '720p',
      },
    };

    return this.taskMutator.createProcessUploadTask(
      workspaceId,
      uploadId,
      payload
    );
  }

  /**
   * Retry a failed upload by creating a new processing task
   * @param uploadId The upload ID to retry
   * @returns The new task
   * @throws Error if upload not found or not in failed state
   */
  async retryUpload(uploadId: string): Promise<Task> {
    const upload = await this.uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    if (upload.status !== UploadStatus.FAILED) {
      throw new Error(
        `Upload is not in failed state. Current status: ${upload.status}`
      );
    }

    // Reset upload status to uploaded
    await this.uploadMutator.updateStatus(uploadId, UploadStatus.UPLOADED);

    // Create new processing task
    return this.enqueueProcessingTask(
      upload.WorkspaceRef,
      uploadId,
      upload.UserRef
    );
  }

  /**
   * Cancel an in-progress upload
   * Updates the upload status to failed
   * @param uploadId The upload ID to cancel
   * @returns The updated upload
   * @throws Error if upload not found or not in cancellable state
   */
  async cancelUpload(uploadId: string): Promise<Upload> {
    const upload = await this.uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload not found: ${uploadId}`);
    }

    // Only allow cancellation of uploads in progress
    const cancellableStates: readonly UploadStatus[] = [
      UploadStatus.QUEUED,
      UploadStatus.UPLOADING,
      UploadStatus.UPLOADED,
      UploadStatus.PROCESSING,
    ] as const;

    if (
      !(cancellableStates as readonly UploadStatus[]).includes(
        upload.status as UploadStatus
      )
    ) {
      throw new Error(
        `Upload cannot be cancelled. Current status: ${upload.status}`
      );
    }

    // Update status to failed with cancellation message
    return this.uploadMutator.updateStatus(
      uploadId,
      UploadStatus.FAILED,
      'Upload cancelled by user'
    );
  }

  /**
   * Get uploads for a workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of uploads
   */
  async getWorkspaceUploads(workspaceId: string, page = 1, perPage = 50) {
    return this.uploadMutator.getByWorkspace(workspaceId, page, perPage);
  }

  /**
   * Get upload by ID
   * @param uploadId The upload ID
   * @returns The upload or null if not found
   */
  async getUpload(uploadId: string): Promise<Upload | null> {
    return this.uploadMutator.getById(uploadId);
  }
}

/**
 * Create an UploadService instance from a PocketBase client
 */
export function createUploadService(
  pb: TypedPocketBase,
  config?: UploadServiceConfig
): UploadService {
  return new UploadService(pb, config);
}
