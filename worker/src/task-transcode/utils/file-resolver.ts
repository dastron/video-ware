import { Logger } from '@nestjs/common';
import { StorageService } from '../../shared/services/storage.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { StorageBackendType, FileSource } from '@project/shared';

/**
 * Utility for resolving file paths from upload IDs
 * Shared across all transcode step processors
 */
export class FileResolver {
  private static readonly logger = new Logger(FileResolver.name);

  /**
   * Resolve file path from upload ID
   * If filePath is already provided and not empty, returns it as-is
   * Otherwise, fetches the upload record and resolves the storage path
   */
  static async resolveFilePath(
    uploadId: string,
    filePath: string | undefined,
    storageService: StorageService,
    pocketbaseService: PocketBaseService
  ): Promise<string> {
    // If filePath is already provided and not empty, use it
    if (filePath && filePath.trim() !== '') {
      return filePath;
    }

    this.logger.log(`Resolving file path for upload ${uploadId}`);

    // Get upload record
    const upload = await pocketbaseService.uploadMutator.getById(uploadId);
    if (!upload) {
      throw new Error(`Upload ${uploadId} not found`);
    }

    // Resolve file path - get storage path from upload or associated file
    let storagePath = upload.externalPath;
    let storageBackend = upload.storageBackend as
      | StorageBackendType
      | undefined;

    // If no externalPath on upload, try to get from associated file
    if (!storagePath) {
      const files = await pocketbaseService.fileMutator.getByUpload(
        uploadId,
        1,
        1
      );
      if (files.items && files.items.length > 0) {
        const file = files.items[0];
        storagePath = file.s3Key || undefined;
        if (!storageBackend && file.fileSource) {
          // Map FileSource to StorageBackendType
          const fileSource = Array.isArray(file.fileSource)
            ? file.fileSource[0]
            : file.fileSource;
          storageBackend =
            fileSource === FileSource.POCKETBASE
              ? StorageBackendType.LOCAL
              : fileSource === FileSource.S3
                ? StorageBackendType.S3
                : undefined;
        }
      }
    }

    if (!storagePath) {
      throw new Error(`No storage path found for upload ${uploadId}`);
    }

    // Resolve file path using storage service
    const resolvedPath = await storageService.resolveFilePath({
      storagePath,
      storageBackend,
      recordId: uploadId,
    });

    this.logger.log(
      `Resolved file path for upload ${uploadId}: ${resolvedPath}`
    );
    return resolvedPath;
  }
}
