import { Injectable, Logger } from '@nestjs/common';
import { StorageService } from '../../../shared/services/storage.service';
import type { IUploadExecutor, UploadResult } from '../interfaces';

/**
 * Executor for uploading rendered files to storage
 * Pure operation - uploads file to storage backend
 */
@Injectable()
export class FFmpegUploadExecutor implements IUploadExecutor {
  private readonly logger = new Logger(FFmpegUploadExecutor.name);

  constructor(private readonly storageService: StorageService) {}

  async execute(
    outputPath: string,
    storagePath: string
  ): Promise<UploadResult> {
    this.logger.log(`Uploading file from ${outputPath} to ${storagePath}`);

    try {
      await this.storageService.uploadFromPath(outputPath, storagePath);
      
      this.logger.log(`File uploaded successfully to ${storagePath}`);
      return { storagePath };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`File upload failed: ${errorMessage}`);
      throw error;
    }
  }
}
