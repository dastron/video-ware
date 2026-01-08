import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createStorageBackend,
  LocalStorageBackend,
  StorageBackend,
  StorageConfig,
} from '@project/shared/storage';
import { StorageBackendType, FileSource } from '@project/shared';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Parameters for resolving a file path from storage
 */
export interface ResolveFilePathParams {
  /** Storage path (e.g., "uploads/workspace/upload/original.mp4") */
  storagePath: string;
  /** Storage backend type - if not provided, uses the configured backend or fileSource */
  storageBackend?: StorageBackendType;
  /** File source enum (alternative to storageBackend, for File records) */
  fileSource?: FileSource;
  /** Optional record ID for temp file naming when downloading from remote storage */
  recordId?: string;
}

/**
 * Parameters for generating a derived storage path
 */
export interface GenerateDerivedPathParams {
  /** Base storage path to derive from (e.g., "uploads/workspace/upload/original.mp4") */
  baseStoragePath?: string;
  /** Workspace ID - used if baseStoragePath is not provided */
  workspaceId?: string;
  /** Record ID (upload ID, timeline ID, etc.) - used if baseStoragePath is not provided */
  recordId?: string;
  /** Suffix for the derived file (e.g., "thumbnail", "sprite", "proxy") */
  suffix: string;
  /** File extension (e.g., "jpg", "mp4") */
  extension: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private backend!: StorageBackend;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.initializeBackend();
  }

  private async initializeBackend() {
    const storageType = this.configService.get<string>(
      'storage.type',
      'local'
    ) as StorageBackendType;

    const config: StorageConfig = {
      type: storageType,
    };

    if (storageType === StorageBackendType.LOCAL) {
      const localPath = this.configService.get<string>(
        'storage.localPath',
        './data'
      );
      config.local = {
        basePath: localPath,
      };
    } else if (storageType === StorageBackendType.S3) {
      const s3Bucket = this.configService.get<string>('storage.s3Bucket');
      const s3Region = this.configService.get<string>('storage.s3Region');
      const s3Endpoint = this.configService.get<string>('storage.s3Endpoint');
      const s3AccessKeyId = this.configService.get<string>(
        'storage.s3AccessKeyId'
      );
      const s3SecretAccessKey = this.configService.get<string>(
        'storage.s3SecretAccessKey'
      );
      const s3ForcePathStyle = this.configService.get<boolean>(
        'storage.s3ForcePathStyle',
        false
      );

      if (!s3Bucket || !s3Region || !s3AccessKeyId || !s3SecretAccessKey) {
        throw new Error(
          'S3 storage configuration is incomplete. Please check S3 environment variables.'
        );
      }

      config.s3 = {
        endpoint: s3Endpoint || `https://s3.${s3Region}.amazonaws.com`,
        bucket: s3Bucket,
        region: s3Region,
        accessKeyId: s3AccessKeyId,
        secretAccessKey: s3SecretAccessKey,
        forcePathStyle: s3ForcePathStyle,
      };
    }

    try {
      this.backend = await createStorageBackend(config);
      this.logger.log(`Initialized storage backend: ${storageType}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to initialize storage backend: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Map FileSource enum to StorageBackendType
   */
  private mapFileSourceToStorageBackend(
    fileSource: FileSource
  ): StorageBackendType {
    switch (fileSource) {
      case FileSource.S3:
        return StorageBackendType.S3;
      case FileSource.POCKETBASE:
        return StorageBackendType.LOCAL;
      case FileSource.GCS:
        // GCS not directly supported, but treat as S3-compatible
        return StorageBackendType.S3;
      default:
        throw new Error(`Unsupported file source: ${fileSource}`);
    }
  }

  /**
   * Resolve file path for processing - downloads from S3 to temp if needed
   * Returns local file path that can be used by FFmpeg and other tools
   *
   * @param params - Parameters containing storage path, backend type, and optional record ID
   * @returns Local filesystem path to the file
   */
  async resolveFilePath(params: ResolveFilePathParams): Promise<string> {
    const { storagePath, storageBackend, recordId } = params;

    if (!storagePath) {
      throw new Error('Storage path is required');
    }

    let backendType: StorageBackendType;
    if (storageBackend) {
      backendType = storageBackend;
    } else if ('fileSource' in params && params.fileSource) {
      // Support FileSource enum from File records
      backendType = this.mapFileSourceToStorageBackend(
        params.fileSource as FileSource
      );
    } else {
      backendType = this.backend.type;
    }

    // For local storage, return the resolved path directly
    if (backendType === StorageBackendType.LOCAL) {
      if (this.backend.type === StorageBackendType.LOCAL) {
        // Use the backend's resolvePath method for local storage
        return (this.backend as LocalStorageBackend).resolvePath(storagePath);
      }
      // Fallback for legacy configuration
      const localPath = this.configService.get<string>(
        'storage.localPath',
        './data'
      );
      return path.resolve(localPath, storagePath);
    }

    // For S3 storage, download to temporary file
    if (backendType === StorageBackendType.S3) {
      const tempRecordId = recordId || 'unknown';
      return await this.downloadToTemp(storagePath, tempRecordId);
    }

    throw new Error(`Unsupported storage type: ${backendType}`);
  }

  /**
   * Download file from S3 to temporary location for processing
   */
  private async downloadToTemp(
    storagePath: string,
    recordId: string
  ): Promise<string> {
    try {
      // Check if file exists in storage
      const exists = await this.backend.exists(storagePath);
      if (!exists) {
        throw new Error(`File not found in storage: ${storagePath}`);
      }

      // Create temp directory
      const tempDir = path.join(os.tmpdir(), 'worker-temp', recordId);
      await fs.promises.mkdir(tempDir, { recursive: true });

      // Generate temp file path
      const fileName = path.basename(storagePath);
      const tempFilePath = path.join(tempDir, fileName);

      // Check if already downloaded
      if (fs.existsSync(tempFilePath)) {
        this.logger.log(`Using cached temp file: ${tempFilePath}`);
        return tempFilePath;
      }

      // Download file
      this.logger.log(`Downloading ${storagePath} to ${tempFilePath}`);
      const stream = await this.backend.download(storagePath);

      // Write to temp file
      const writeStream = fs.createWriteStream(tempFilePath);
      const reader = stream.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          writeStream.write(Buffer.from(value));
        }
      } finally {
        reader.releaseLock();
        writeStream.end();
      }

      // Wait for write to complete
      await new Promise<void>((resolve, reject) => {
        writeStream.on('finish', resolve);
        writeStream.on('error', reject);
      });

      this.logger.log(
        `Downloaded ${storagePath} to temp file: ${tempFilePath}`
      );
      return tempFilePath;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to download ${storagePath} to temp: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Upload file to storage
   */
  async upload(
    storagePath: string,
    data: Buffer | ReadableStream
  ): Promise<void> {
    try {
      await this.backend.upload(data, storagePath);
      this.logger.log(`Uploaded file to storage: ${storagePath}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to upload ${storagePath}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Upload file from local path to storage
   */
  async uploadFromPath(localPath: string, storagePath: string): Promise<void> {
    try {
      const buffer = await fs.promises.readFile(localPath);
      await this.upload(storagePath, buffer);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to upload from ${localPath} to ${storagePath}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Download file from storage
   */
  async download(storagePath: string): Promise<ReadableStream> {
    try {
      return await this.backend.download(storagePath);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to download ${storagePath}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Check if file exists in storage
   */
  async exists(storagePath: string): Promise<boolean> {
    try {
      return await this.backend.exists(storagePath);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to check existence of ${storagePath}: ${errorMessage}`
      );
      return false;
    }
  }

  /**
   * Delete file from storage
   */
  async delete(storagePath: string): Promise<void> {
    try {
      await this.backend.delete(storagePath);
      this.logger.log(`Deleted file from storage: ${storagePath}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete ${storagePath}: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Get URL for file access
   */
  async getUrl(storagePath: string, expirySeconds?: number): Promise<string> {
    try {
      return await this.backend.getUrl(storagePath, expirySeconds);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to get URL for ${storagePath}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * List files with prefix
   */
  async listFiles(prefix: string) {
    try {
      return await this.backend.listFiles(prefix);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to list files with prefix ${prefix}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Clean up temporary files for a record
   */
  async cleanupTemp(recordId: string): Promise<void> {
    try {
      const tempDir = path.join(os.tmpdir(), 'worker-temp', recordId);
      if (fs.existsSync(tempDir)) {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        this.logger.log(`Cleaned up temp directory: ${tempDir}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to cleanup temp directory for ${recordId}: ${errorMessage}`
      );
    }
  }

  /**
   * Create temporary directory for processing
   */
  async createTempDir(taskId: string): Promise<string> {
    try {
      const tempDir = path.join(os.tmpdir(), 'worker-temp', taskId);
      await fs.promises.mkdir(tempDir, { recursive: true });
      this.logger.debug(`Created temp directory: ${tempDir}`);
      return tempDir;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to create temp directory for ${taskId}: ${errorMessage}`
      );
      throw error;
    }
  }

  /**
   * Get the storage backend instance
   */
  getBackend(): StorageBackend {
    return this.backend;
  }

  /**
   * Generate storage path for derived files
   *
   * @param params - Parameters for generating the derived path
   * @returns Storage path for the derived file
   */
  generateDerivedPath(params: GenerateDerivedPathParams): string {
    const { baseStoragePath, workspaceId, recordId, suffix, extension } =
      params;

    let basePath: string;

    if (baseStoragePath) {
      // Use provided base path
      basePath = baseStoragePath;
    } else if (workspaceId && recordId) {
      // Construct path from workspace and record ID
      basePath = `uploads/${workspaceId}/${recordId}/original`;
    } else {
      throw new Error(
        'Either baseStoragePath or both workspaceId and recordId must be provided'
      );
    }

    const dir = path.dirname(basePath);
    return `${dir}/${suffix}.${extension}`;
  }
}
