/**
 * S3 Watcher Service - Monitors S3 bucket for new files and creates upload tasks
 *
 * This service polls an S3 bucket at a configurable interval, checking for new files
 * that match a configured prefix. When new files are detected, it creates Upload and
 * Task records to process them through the standard pipeline.
 *
 * Features:
 * - Deduplication using WatchedFile records
 * - Change detection via ETags
 * - Configurable reprocessing of modified files
 * - Workspace-scoped ingestion
 *
 * Usage:
 *   const watcher = new S3WatcherService(pb, config, storageBackend);
 *   await watcher.start();
 */

import type { TypedPocketBase } from '@project/shared';
import {
  WatchedFileMutator,
  UploadMutator,
  TaskMutator,
  WatchedFileStatus,
  UploadStatus,
  TaskType,
  TaskStatus,
} from '@project/shared';
import {
  WatcherConfig,
  type StorageBackend,
  type StorageFile,
} from '@project/shared/storage';

export class S3WatcherService {
  private pb: TypedPocketBase;
  private config: WatcherConfig;
  private storageBackend: StorageBackend;
  private watchedFileMutator: WatchedFileMutator;
  private uploadMutator: UploadMutator;
  private taskMutator: TaskMutator;
  private isRunning: boolean = false;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(
    pb: TypedPocketBase,
    config: WatcherConfig,
    storageBackend: StorageBackend
  ) {
    this.pb = pb;
    this.config = config;
    this.storageBackend = storageBackend;
    this.watchedFileMutator = new WatchedFileMutator(pb);
    this.uploadMutator = new UploadMutator(pb);
    this.taskMutator = new TaskMutator(pb);
  }

  /**
   * Start the watcher service
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log('[S3Watcher] Already running');
      return;
    }

    console.log('[S3Watcher] Starting S3 directory watcher...');
    console.log(`[S3Watcher] Prefix: ${this.config.prefix}`);
    console.log(`[S3Watcher] Workspace: ${this.config.workspaceId}`);
    console.log(`[S3Watcher] Interval: ${this.config.intervalSeconds}s`);
    console.log(
      `[S3Watcher] Reprocess modified: ${this.config.reprocessModified}`
    );

    this.isRunning = true;

    // Run initial scan immediately
    await this.scan();

    // Schedule periodic scans
    this.intervalHandle = setInterval(
      () => this.scan(),
      this.config.intervalSeconds * 1000
    );
  }

  /**
   * Stop the watcher service
   */
  stop(): void {
    if (!this.isRunning) {
      return;
    }

    console.log('[S3Watcher] Stopping S3 directory watcher...');
    this.isRunning = false;

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Scan the S3 bucket for new or modified files
   */
  private async scan(): Promise<void> {
    try {
      console.log('[S3Watcher] Scanning for new files...');

      // List objects from S3 with configured prefix
      const files = await this.storageBackend.listFiles(this.config.prefix);

      console.log(`[S3Watcher] Found ${files.length} file(s) in S3`);

      // Process each file
      for (const file of files) {
        await this.processFile(file);
      }

      console.log('[S3Watcher] Scan complete');
    } catch (error) {
      console.error('[S3Watcher] Error during scan:', error);
    }
  }

  /**
   * Process a single file from S3
   * @param file The S3 file metadata
   */
  private async processFile(file: StorageFile): Promise<void> {
    try {
      // Get S3 bucket from storage backend config
      const bucket = this.getS3Bucket();

      // Check if we've already processed this file
      const existingWatchedFile = await this.watchedFileMutator.getByS3Key(
        file.key,
        bucket
      );

      if (existingWatchedFile) {
        // File already tracked - check if it's been modified
        await this.handleExistingFile(existingWatchedFile, file);
      } else {
        // New file - create records and process
        await this.handleNewFile(file, bucket);
      }
    } catch (error) {
      console.error(`[S3Watcher] Error processing file ${file.key}:`, error);
    }
  }

  /**
   * Handle a new file that hasn't been tracked before
   * @param file The S3 file metadata
   * @param bucket The S3 bucket name
   */
  private async handleNewFile(
    file: StorageFile,
    bucket: string
  ): Promise<void> {
    console.log(`[S3Watcher] New file detected: ${file.key}`);

    try {
      // Create WatchedFile record
      const watchedFile = await this.watchedFileMutator.create({
        s3Key: file.key,
        s3Bucket: bucket,
        etag: file.etag,
        size: file.size,
        lastModified: file.lastModified.toISOString(),
        status: WatchedFileStatus.PENDING,
        WorkspaceRef: this.config.workspaceId,
      });

      // Extract filename from S3 key
      const fileName = this.extractFileName(file.key);

      // Create Upload record
      const upload = await this.uploadMutator.create({
        name: fileName,
        size: file.size,
        status: UploadStatus.UPLOADED,
        WorkspaceRef: this.config.workspaceId,
        UserRef: this.pb.authStore.record?.id || '',
        storageBackend: this.storageBackend.type,
        externalPath: file.key,
        storageConfig: {
          bucket,
          etag: file.etag,
        },
      });

      // Create Task record to process the upload
      const task = await this.taskMutator.create({
        type: TaskType.PROCESS_UPLOAD,
        status: TaskStatus.QUEUED,
        WorkspaceRef: this.config.workspaceId,
        UserRef: this.pb.authStore.record?.id || '',
        sourceType: 'Upload',
        sourceId: upload.id,
        payload: {
          uploadId: upload.id,
        },
      });

      // Update WatchedFile with Upload reference and mark as processing
      await this.watchedFileMutator.update(watchedFile.id, {
        UploadRef: upload.id,
        status: WatchedFileStatus.PROCESSING,
      });

      console.log(
        `[S3Watcher] Created Upload ${upload.id} and Task ${task.id} for ${file.key}`
      );
    } catch (error) {
      console.error(
        `[S3Watcher] Error creating records for ${file.key}:`,
        error
      );

      // Try to mark the watched file as failed if it was created
      try {
        const watchedFile = await this.watchedFileMutator.getByS3Key(
          file.key,
          bucket
        );
        if (watchedFile) {
          await this.watchedFileMutator.markFailed(
            watchedFile.id,
            error instanceof Error ? error.message : 'Unknown error'
          );
        }
      } catch (updateError) {
        console.error(
          `[S3Watcher] Error marking watched file as failed:`,
          updateError
        );
      }
    }
  }

  /**
   * Handle an existing file that's already been tracked
   * @param watchedFile The existing WatchedFile record
   * @param file The current S3 file metadata
   */
  private async handleExistingFile(
    watchedFile: any,
    file: StorageFile
  ): Promise<void> {
    // Check if file has been modified (different ETag)
    const hasChanged = watchedFile.etag !== file.etag;

    if (!hasChanged) {
      // File hasn't changed, skip
      return;
    }

    console.log(`[S3Watcher] File modified: ${file.key}`);

    // Check if we should reprocess modified files
    if (!this.config.reprocessModified) {
      console.log(
        `[S3Watcher] Skipping modified file (reprocessModified=false): ${file.key}`
      );
      return;
    }

    // Check if the file is already being processed or completed
    if (
      watchedFile.status === WatchedFileStatus.PROCESSING ||
      watchedFile.status === WatchedFileStatus.COMPLETED
    ) {
      console.log(
        `[S3Watcher] File already processed or processing: ${file.key}`
      );
      return;
    }

    try {
      // Update WatchedFile with new metadata
      await this.watchedFileMutator.update(watchedFile.id, {
        etag: file.etag,
        size: file.size,
        lastModified: file.lastModified.toISOString(),
        status: WatchedFileStatus.PENDING,
      });

      // Extract filename from S3 key
      const fileName = this.extractFileName(file.key);
      const bucket = this.getS3Bucket();

      // Create new Upload record for the modified file
      const upload = await this.uploadMutator.create({
        name: fileName,
        size: file.size,
        status: UploadStatus.UPLOADED,
        WorkspaceRef: this.config.workspaceId,
        UserRef: this.pb.authStore.record?.id || '',
        storageBackend: this.storageBackend.type,
        externalPath: file.key,
        storageConfig: {
          bucket,
          etag: file.etag,
        },
      });

      // Create new Task record
      const task = await this.taskMutator.create({
        type: TaskType.PROCESS_UPLOAD,
        status: TaskStatus.QUEUED,
        WorkspaceRef: this.config.workspaceId,
        UserRef: this.pb.authStore.record?.id || '',
        sourceType: 'Upload',
        sourceId: upload.id,
        payload: {
          uploadId: upload.id,
        },
      });

      // Update WatchedFile with new Upload reference and mark as processing
      await this.watchedFileMutator.update(watchedFile.id, {
        UploadRef: upload.id,
        status: WatchedFileStatus.PROCESSING,
      });

      console.log(
        `[S3Watcher] Created Upload ${upload.id} and Task ${task.id} for modified file ${file.key}`
      );
    } catch (error) {
      console.error(
        `[S3Watcher] Error reprocessing modified file ${file.key}:`,
        error
      );

      // Mark as failed
      try {
        await this.watchedFileMutator.markFailed(
          watchedFile.id,
          error instanceof Error ? error.message : 'Unknown error'
        );
      } catch (updateError) {
        console.error(
          `[S3Watcher] Error marking watched file as failed:`,
          updateError
        );
      }
    }
  }

  /**
   * Extract filename from S3 key
   * @param key The S3 object key
   * @returns The filename
   */
  private extractFileName(key: string): string {
    const parts = key.split('/');
    return parts[parts.length - 1] || key;
  }

  /**
   * Get the S3 bucket name from storage backend config
   * @returns The bucket name
   */
  private getS3Bucket(): string {
    // Access the storage backend config
    // This assumes the storage backend is S3StorageBackend
    // In a real implementation, you might want to add a method to StorageBackend interface
    const config = (this.storageBackend as any).config;
    if (config && config.s3 && config.s3.bucket) {
      return config.s3.bucket;
    }
    throw new Error('S3 bucket not configured in storage backend');
  }
}
