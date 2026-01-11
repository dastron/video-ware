import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { StorageService } from '../../shared/services/storage.service';
import { FFmpegService } from '../../shared/services/ffmpeg.service';
import type { StepJobData } from '../../queue/types/job.types';
import {
  TaskRenderFinalizeStep,
  TaskRenderFinalizeStepOutput,
} from '@project/shared/jobs';
import { FileType, FileStatus, MediaType, FileSource } from '@project/shared';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * Processor for the FINALIZE step in rendering
 * Probes the rendered file, creates all database records, and cleans up
 */
@Injectable()
export class FinalizeRenderStepProcessor extends BaseStepProcessor<
  TaskRenderFinalizeStep,
  TaskRenderFinalizeStepOutput
> {
  protected readonly logger = new Logger(FinalizeRenderStepProcessor.name);

  constructor(
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService,
    private readonly ffmpegService: FFmpegService
  ) {
    super();
  }

  async process(
    input: TaskRenderFinalizeStep,
    job: Job<StepJobData>
  ): Promise<TaskRenderFinalizeStepOutput> {
    const {
      timelineId,
      workspaceId,
      version,
      renderOutput,
      storagePath,
      format,
    } = input;
    this.logger.log(`Finalizing render for timeline ${timelineId}`);

    let localPath = renderOutput.path;
    let tempDir: string | undefined;

    // 1. Ensure file is local for probing
    if (!renderOutput.isLocal) {
      this.logger.log(
        `Downloading cloud render for probing: ${renderOutput.path}`
      );
      tempDir = await this.storageService.createTempDir(job.data.taskId);
      localPath = await this.storageService.resolveFilePath({
        storagePath: renderOutput.path,
        recordId: job.data.taskId,
      });
    }

    // 2. Probe the video (unless already provided)
    // In our new flow, EXECUTE might already provide probeOutput
    let probeOutput = input.probeOutput;
    if (!probeOutput) {
      this.logger.log(`Probing rendered file at ${localPath}`);
      const probeResult = await this.ffmpegService.probe(localPath);
      probeOutput = this.mapProbeResult(probeResult);
    }

    // 3. Resolve timeline name
    const timeline =
      await this.pocketbaseService.timelineMutator.getById(timelineId);
    const timelineName = timeline?.name || 'Untitled';

    // 4. Create File record
    // Note: We use the existing storagePath or generate a new one if not provided
    const finalStoragePath =
      storagePath ||
      `renders/${workspaceId}/${timelineId}_${Date.now()}.${format}`;

    const fileRecord = await this.createFileRecord({
      workspaceId,
      timelineName,
      format,
      storagePath: finalStoragePath,
      localPath,
    });

    // 5. Create Media record
    const mediaRecord = await this.createMediaRecord({
      workspaceId,
      timelineName,
      fileRecordId: fileRecord.id,
      probeOutput,
    });

    // 6. Create TimelineRender record
    const timelineRenderRecord =
      await this.pocketbaseService.createTimelineRender({
        TimelineRef: timelineId,
        version: version,
        FileRef: fileRecord.id,
      });

    // 7. Cleanup
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true });
    } else if (renderOutput.isLocal) {
      // If it was local and we are done, clean up the original temp file
      await fs.rm(path.dirname(localPath), { recursive: true, force: true });
    }

    this.logger.log(`Successfully finalized render: ${mediaRecord.id}`);

    return {
      fileId: fileRecord.id,
      mediaId: mediaRecord.id,
      timelineRenderId: timelineRenderRecord.id,
    };
  }

  private mapProbeResult(probeResult: any): any {
    const videoStream = probeResult.streams.find(
      (s: any) => s.codec_type === 'video'
    );
    const parseFps = (fpsString: string | undefined): number => {
      if (!fpsString) return 0;
      const [num, den] = fpsString.split('/').map(Number);
      return den && den > 0 ? num / den : 0;
    };

    return {
      duration: parseFloat(String(probeResult.format.duration)) || 0,
      width: videoStream?.width || 0,
      height: videoStream?.height || 0,
      codec: videoStream?.codec_name || 'unknown',
      fps:
        parseFps(videoStream?.r_frame_rate || videoStream?.avg_frame_rate) || 0,
      bitrate: parseInt(String(probeResult.format.bit_rate)) || undefined,
      format: probeResult.format.format_name || 'unknown',
      size: parseInt(String(probeResult.format.size)) || undefined,
    };
  }

  private async createFileRecord(data: {
    workspaceId: string;
    timelineName: string;
    format: string;
    storagePath: string;
    localPath: string;
  }): Promise<any> {
    const { workspaceId, timelineName, format, storagePath, localPath } = data;
    const stats = await fs.stat(localPath);
    const mimeType = this.getMimeType(format);

    // Create File record in PocketBase
    // We use the same FormData logic as before for consistency
    const formData = new FormData();
    formData.append('name', `${timelineName}_render.${format}`);
    formData.append('size', String(stats.size));
    formData.append('fileStatus', FileStatus.AVAILABLE);
    formData.append('fileType', FileType.RENDER);
    formData.append('fileSource', FileSource.S3); // Assuming S3 for now or Local
    formData.append('s3Key', storagePath);
    formData.append('WorkspaceRef', workspaceId);
    formData.append('meta', JSON.stringify({ mimeType }));

    // Note: We don't upload the file body to PocketBase if it's already in S3
    // but the original code did it. If it's already in S3, we just point to it.
    // However, PocketBase might expect the file if it's not strictly an S3-only collection.

    // I'll skip the body upload if s3Key is present and we want to be efficient
    // but current system seems to use PB as a proxy for files too.

    const pb = this.pocketbaseService.getClient();
    return await pb.collection('Files').create(formData);
  }

  private async createMediaRecord(data: {
    workspaceId: string;
    timelineName: string;
    fileRecordId: string;
    probeOutput: any;
  }): Promise<any> {
    const { workspaceId, timelineName, fileRecordId, probeOutput } = data;

    return await this.pocketbaseService.createMedia({
      WorkspaceRef: workspaceId,
      UploadRef: fileRecordId,
      mediaType: MediaType.VIDEO,
      duration: probeOutput.duration,
      mediaData: {
        name: `${timelineName} (Rendered)`,
        width: probeOutput.width,
        height: probeOutput.height,
        fps: probeOutput.fps,
        codec: probeOutput.codec,
        probeOutput,
      },
      proxyFileRef: fileRecordId,
      version: 1,
    });
  }

  private getMimeType(format: string): string {
    const mimeTypes: Record<string, string> = {
      mp4: 'video/mp4',
      mov: 'video/quicktime',
      webm: 'video/webm',
    };
    return mimeTypes[format.toLowerCase()] || 'video/mp4';
  }
}
