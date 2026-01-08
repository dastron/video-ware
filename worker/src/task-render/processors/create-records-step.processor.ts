import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { StorageService } from '../../shared/services/storage.service';
import type { StepJobData } from '../../queue/types/job.types';
import type { CreateRecordsStepInput, CreateRecordsOutput } from '../executors/interfaces';
import type { File as FileRecord, Media } from '@project/shared';
import { FileType, FileStatus, MediaType, FileSource } from '@project/shared';
import * as fs from 'fs/promises';

/**
 * Processor for the CREATE_RECORDS step
 * Creates File, Media, and TimelineRender records
 * Cleans up temporary files
 */
@Injectable()
export class CreateRecordsStepProcessor extends BaseStepProcessor<
  CreateRecordsStepInput,
  CreateRecordsOutput
> {
  protected readonly logger = new Logger(CreateRecordsStepProcessor.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService
  ) {
    super();
  }

  async process(
    input: CreateRecordsStepInput,
    job: Job<StepJobData>
  ): Promise<CreateRecordsOutput> {
    this.logger.log(`Creating records for timeline ${input.timelineId} render`);


    // Create File record
    const fileRecord = await this.createFileRecord(input);


    // Create Media record
    const mediaRecord = await this.createMediaRecord(input, fileRecord);


    // Create TimelineRender record
    const timelineRenderRecord = await this.createTimelineRenderRecord(
      input.timelineId,
      input.version,
      fileRecord.id
    );


    // Clean up temporary files
    await this.cleanupTempFiles(input.tempDir);


    this.logger.log(
      `Successfully created records for timeline ${input.timelineId} render`
    );

    return {
      fileId: fileRecord.id,
      mediaId: mediaRecord.id,
      timelineRenderId: timelineRenderRecord.id,
    };
  }

  /**
   * Create File record for rendered video
   */
  private async createFileRecord(
    input: CreateRecordsStepInput
  ): Promise<FileRecord> {
    const stats = await fs.stat(input.outputPath);
    const mimeType = this.getMimeType(input.format);

    // Read file from filesystem
    const fileBuffer = await fs.readFile(input.outputPath);

    // Create a Blob from the buffer
    const { Blob } = await import('buffer');
    const blob = new Blob([fileBuffer], { type: mimeType });

    // Create FormData and append all fields
    const formData = new FormData();
    formData.append('name', `${input.timelineName}_render.${input.format}`);
    formData.append('size', String(stats.size));
    formData.append('fileStatus', FileStatus.AVAILABLE);
    formData.append('fileType', FileType.RENDER);
    formData.append('fileSource', FileSource.POCKETBASE);
    formData.append('s3Key', input.storagePath);
    formData.append('WorkspaceRef', input.workspaceId);
    formData.append('meta', JSON.stringify({ mimeType }));

    // Append the actual file
    formData.append(
      'file',
      blob as unknown as Blob,
      `${input.timelineName}_render.${input.format}`
    );

    // Use PocketBase client directly to create with FormData
    const pb = this.pocketbaseService.getClient();
    const record = await pb.collection('Files').create(formData);

    this.logger.log(`Created File record: ${record.id}`);

    return record as FileRecord;
  }

  /**
   * Create Media record for rendered video
   */
  private async createMediaRecord(
    input: CreateRecordsStepInput,
    fileRecord: FileRecord
  ): Promise<Media> {
    // Store metadata in mediaData JSON field
    const mediaData = {
      name: `${input.timelineName} (Rendered)`,
      type: 'video',
      width: input.probeOutput.width,
      height: input.probeOutput.height,
      fps: input.probeOutput.fps,
      codec: input.probeOutput.codec,
      bitrate: input.probeOutput.bitrate,
      size: input.probeOutput.size,
      sourceFileRef: fileRecord.id,
      probeOutput: input.probeOutput,
      processorVersion: this.getProcessorVersion(),
    };

    // Note: UploadRef is required by schema, but rendered media doesn't have an upload
    // Using fileRecord.id as a placeholder - this may need to be handled differently
    const mediaRecord = await this.pocketbaseService.createMedia({
      WorkspaceRef: input.workspaceId,
      UploadRef: fileRecord.id, // Placeholder - rendered media doesn't have an upload
      mediaType: MediaType.VIDEO,
      duration: input.probeOutput.duration,
      mediaData: mediaData,
      proxyFileRef: fileRecord.id, // Use the rendered file as the proxy/source
      version: 1, // Initial version
    });

    this.logger.log(`Created Media record: ${mediaRecord.id}`);

    return mediaRecord;
  }

  /**
   * Create TimelineRender record
   */
  private async createTimelineRenderRecord(
    timelineId: string,
    version: number,
    fileId: string
  ): Promise<{ id: string }> {
    const record = await this.pocketbaseService.createTimelineRender({
      TimelineRef: timelineId,
      version: version,
      FileRef: fileId,
    });

    this.logger.log(`Created TimelineRender record: ${record.id}`);

    return record;
  }

  /**
   * Get MIME type for format
   */
  private getMimeType(format: string): string {
    const mimeTypes: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      avi: 'video/x-msvideo',
      mkv: 'video/x-matroska',
      webm: 'video/webm',
    };

    return mimeTypes[format.toLowerCase()] || 'video/mp4';
  }

  /**
   * Get processor version string
   */
  private getProcessorVersion(): string {
    return 'nestjs-worker:1.0.0+ffmpeg-render';
  }

  /**
   * Clean up temporary files
   */
  private async cleanupTempFiles(tempDir: string): Promise<void> {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
      this.logger.log(`Cleaned up temp directory: ${tempDir}`);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Failed to cleanup temp directory ${tempDir}: ${errorMessage}`
      );
      // Don't throw - cleanup failure shouldn't fail the entire step
    }
  }
}
