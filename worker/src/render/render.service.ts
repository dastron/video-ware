import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PocketBaseService } from '../shared/services/pocketbase.service';
import { StorageService } from '../shared/services/storage.service';
import { FFmpegService } from '../shared/services/ffmpeg.service';
import type { 
  Task, 
  RenderTimelinePayload, 
  RenderTimelineResult,
  Timeline,
  TimelineClip,
  Media,
  File as FileRecord
} from '@project/shared';
import { FileType, FileStatus, MediaType, FileSource } from '@project/shared';
import * as path from 'path';
import * as fs from 'fs/promises';

@Injectable()
export class RenderService {
  private readonly logger = new Logger(RenderService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly pocketbaseService: PocketBaseService,
    private readonly storageService: StorageService,
    private readonly ffmpegService: FFmpegService,
  ) {}

  /**
   * Process render timeline task
   */
  async processTask(task: Task, progressCallback: (progress: number) => void): Promise<RenderTimelineResult> {
    const payload = task.payload as RenderTimelinePayload;
    const { timelineId, version, editList, outputSettings } = payload;

    this.logger.log(`Processing render task ${task.id} for timeline ${timelineId} version ${version}`);

    try {
      // Step 1: Get timeline record (5% progress)
      progressCallback(5);
      const timeline = await this.pocketbaseService.getTimeline(timelineId);
      if (!timeline) {
        throw new Error(`Timeline ${timelineId} not found`);
      }

      // Step 2: Get timeline clips (10% progress)
      progressCallback(10);
      const timelineClips = await this.pocketbaseService.getTimelineClips(timelineId);
      if (!timelineClips || timelineClips.length === 0) {
        throw new Error(`No clips found for timeline ${timelineId}`);
      }

      // Step 3: Resolve media files for clips (20% progress)
      progressCallback(20);
      const clipMediaMap = await this.resolveClipMedia(timelineClips);

      // Step 4: Generate temporary file paths
      const tempDir = await this.storageService.createTempDir(task.id);
      const outputPath = path.join(tempDir, `timeline_${timelineId}_v${version}.${outputSettings.format}`);

      // Step 5: Compose timeline using FFmpeg (30-80% progress)
      progressCallback(30);
      await this.composeTimeline(
        editList,
        clipMediaMap,
        outputPath,
        outputSettings,
        (composeProgress) => {
          // Map compose progress (0-100) to our progress range (30-80)
          const mappedProgress = 30 + (composeProgress * 0.5);
          progressCallback(mappedProgress);
        }
      );

      // Step 6: Upload rendered video to storage (80-90% progress)
      progressCallback(80);
      const storagePath = this.storageService.generateDerivedPath({
        workspaceId: timeline.WorkspaceRef,
        recordId: timelineId,
        suffix: 'render',
        extension: outputSettings.format,
      });
      await this.storageService.uploadFromPath(outputPath, storagePath);

      // Step 7: Create File record (90-95% progress)
      progressCallback(90);
      const fileRecord = await this.createFileRecord(timeline, outputPath, storagePath, outputSettings);

      // Step 8: Create Media record (95-98% progress)
      progressCallback(95);
      const mediaRecord = await this.createMediaRecord(timeline, fileRecord, outputPath);

      // Step 9: Create TimelineRender record (98-100% progress)
      progressCallback(98);
      await this.createTimelineRenderRecord(timelineId, version, fileRecord.id);

      // Step 10: Cleanup temporary files
      await this.cleanupTempFiles(tempDir);

      progressCallback(100);

      const result: RenderTimelineResult = {
        mediaId: mediaRecord.id,
        fileId: fileRecord.id,
        processorVersion: this.getProcessorVersion(),
      };

      this.logger.log(`Render task ${task.id} completed successfully`);
      return result;

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Render task ${task.id} failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Resolve media files for timeline clips
   */
  private async resolveClipMedia(timelineClips: TimelineClip[]): Promise<Map<string, { media: Media; filePath: string }>> {
    const clipMediaMap = new Map<string, { media: Media; filePath: string }>();

    for (const clip of timelineClips) {
      try {
        // Get media record for the clip
        const media = await this.pocketbaseService.getMedia(clip.MediaRef);
        if (!media) {
          throw new Error(`Media ${clip.MediaRef} not found for clip ${clip.id}`);
        }

        // Get the source file (prefer proxy, fallback to original upload)
        let sourceFileId = media.proxyFileRef;
        if (!sourceFileId) {
          // Get original upload and find associated file
          const upload = await this.pocketbaseService.getUploadByMedia(media.id);
          if (!upload) {
            throw new Error(`No upload found for media ${media.id}`);
          }
          
          // Find file record associated with this upload
          const files = await this.pocketbaseService.fileMutator.getByUpload(upload.id, 1, 1);
          if (!files.items || files.items.length === 0) {
            throw new Error(`No source file found for upload ${upload.id}`);
          }
          sourceFileId = files.items[0].id;
        }

        if (!sourceFileId) {
          throw new Error(`No source file ID found for media ${media.id}`);
        }

        // Get file record and resolve path
        const fileRecord = await this.pocketbaseService.getFile(sourceFileId);
        if (!fileRecord) {
          throw new Error(`File ${sourceFileId} not found`);
        }

        if (!fileRecord.s3Key) {
          throw new Error(`File ${fileRecord.id} has no storage path (s3Key)`);
        }
        const fileSource = Array.isArray(fileRecord.fileSource)
          ? fileRecord.fileSource[0]
          : fileRecord.fileSource;
        const filePath = await this.storageService.resolveFilePath({
          storagePath: fileRecord.s3Key,
          fileSource: fileSource,
          recordId: fileRecord.id,
        });
        
        clipMediaMap.set(clip.id, { media, filePath });
        this.logger.debug(`Resolved media for clip ${clip.id}: ${filePath}`);

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.logger.error(`Failed to resolve media for clip ${clip.id}: ${errorMessage}`);
        throw error;
      }
    }

    return clipMediaMap;
  }

  /**
   * Compose timeline using FFmpeg
   */
  private async composeTimeline(
    editList: RenderTimelinePayload['editList'],
    clipMediaMap: Map<string, { media: Media; filePath: string }>,
    outputPath: string,
    outputSettings: RenderTimelinePayload['outputSettings'],
    progressCallback: (progress: number) => void
  ): Promise<void> {
    this.logger.log(`Composing timeline with ${editList.length} segments`);

    try {
      // Build FFmpeg command for timeline composition
      const ffmpegArgs = await this.buildFFmpegCommand(editList, clipMediaMap, outputPath, outputSettings);
      
      // Execute FFmpeg with progress tracking
      await this.ffmpegService.executeWithProgress(ffmpegArgs, progressCallback);

      this.logger.log(`Timeline composition completed: ${outputPath}`);

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Timeline composition failed: ${errorMessage}`);
      throw error;
    }
  }

  /**
   * Build FFmpeg command for timeline composition
   */
  private async buildFFmpegCommand(
    editList: RenderTimelinePayload['editList'],
    clipMediaMap: Map<string, { media: Media; filePath: string }>,
    outputPath: string,
    outputSettings: RenderTimelinePayload['outputSettings']
  ): Promise<string[]> {
    const args: string[] = [];

    // Add input files
    const inputFiles: string[] = [];
    const filterComplex: string[] = [];
    
    for (let i = 0; i < editList.length; i++) {
      const segment = editList[i];
      
      // Find the clip media for this segment
      const clipMedia = Array.from(clipMediaMap.values()).find(cm => 
        segment.inputs.includes(cm.media.id)
      );
      
      if (!clipMedia) {
        throw new Error(`No media found for segment ${segment.key}`);
      }

      // Add input file
      args.push('-i', clipMedia.filePath);
      inputFiles.push(clipMedia.filePath);

      // Calculate segment timing
      const startTime = segment.startTimeOffset.seconds + (segment.startTimeOffset.nanos / 1e9);
      const endTime = segment.endTimeOffset.seconds + (segment.endTimeOffset.nanos / 1e9);
      const duration = endTime - startTime;

      // Create filter for this segment
      const segmentFilter = `[${i}:v]trim=start=${startTime}:duration=${duration},setpts=PTS-STARTPTS[v${i}]; [${i}:a]atrim=start=${startTime}:duration=${duration},asetpts=PTS-STARTPTS[a${i}]`;
      filterComplex.push(segmentFilter);
    }

    // Concatenate all segments
    const videoInputs = editList.map((_, i) => `[v${i}]`).join('');
    const audioInputs = editList.map((_, i) => `[a${i}]`).join('');
    const concatFilter = `${videoInputs}${audioInputs}concat=n=${editList.length}:v=1:a=1[outv][outa]`;
    filterComplex.push(concatFilter);

    // Add filter complex
    args.push('-filter_complex', filterComplex.join('; '));

    // Map output streams
    args.push('-map', '[outv]', '-map', '[outa]');

    // Add output settings
    args.push('-c:v', outputSettings.codec);
    
    // Parse resolution
    const [width, height] = outputSettings.resolution.split('x').map(Number);
    args.push('-s', `${width}x${height}`);

    // Add output format
    args.push('-f', outputSettings.format);

    // Add output file
    args.push(outputPath);

    this.logger.debug(`FFmpeg command: ffmpeg ${args.join(' ')}`);
    return args;
  }

  /**
   * Create File record for rendered video
   */
  private async createFileRecord(
    timeline: Timeline,
    outputPath: string,
    storagePath: string,
    outputSettings: RenderTimelinePayload['outputSettings']
  ): Promise<FileRecord> {
    const stats = await fs.stat(outputPath);
    const mimeType = this.getMimeType(outputSettings.format);
    
    // Read file from filesystem
    const fileBuffer = await fs.readFile(outputPath);
    
    // Create a Blob from the buffer
    const { Blob } = await import('buffer');
    const blob = new Blob([fileBuffer], { type: mimeType });
    
    // Create FormData and append all fields
    const formData = new FormData();
    formData.append('name', `${timeline.name}_render.${outputSettings.format}`);
    formData.append('size', String(stats.size));
    formData.append('fileStatus', FileStatus.AVAILABLE);
    formData.append('fileType', FileType.RENDER);
    formData.append('fileSource', FileSource.POCKETBASE); // TODO: Get from config
    formData.append('s3Key', storagePath);
    formData.append('WorkspaceRef', timeline.WorkspaceRef);
    formData.append('meta', JSON.stringify({ mimeType }));
    
    // Append the actual file
    formData.append('file', blob as unknown as Blob, `${timeline.name}_render.${outputSettings.format}`);
    
    // Use PocketBase client directly to create with FormData
    const pb = this.pocketbaseService.getClient();
    const record = await pb.collection('Files').create(formData);
    
    return record as FileRecord;
  }

  /**
   * Create Media record for rendered video
   */
  private async createMediaRecord(timeline: Timeline, fileRecord: FileRecord, outputPath: string): Promise<Media> {
    // Probe the rendered video to get metadata
    const probeResult = await this.ffmpegService.probe(outputPath);
    
    // Convert ProbeResult to ProbeOutput format
    // FFprobe output includes additional properties not in the type definition
    const videoStream = probeResult.streams.find((s) => s.codec_type === 'video') as typeof probeResult.streams[0] & {
      r_frame_rate?: string;
      avg_frame_rate?: string;
    };
    if (!videoStream) {
      throw new Error('No video stream found in rendered file');
    }

    // Parse FPS from FFmpeg format (e.g., "30/1" -> 30)
    const parseFps = (fpsString: string | undefined): number => {
      if (!fpsString) return 0;
      const [num, den] = fpsString.split('/').map(Number);
      return den && den > 0 ? num / den : 0;
    };

    const probeOutput = {
      duration: parseFloat(String(probeResult.format.duration)) || 0,
      width: videoStream.width || 0,
      height: videoStream.height || 0,
      codec: videoStream.codec_name || 'unknown',
      fps: parseFps(videoStream.r_frame_rate || videoStream.avg_frame_rate) || 0,
      bitrate: parseInt(String(probeResult.format.bit_rate)) || undefined,
      format: probeResult.format.format_name || 'unknown',
      size: parseInt(String(probeResult.format.size)) || undefined,
    };

    // Store metadata in mediaData JSON field
    const mediaData = {
      name: `${timeline.name} (Rendered)`,
      type: 'video',
      width: probeOutput.width,
      height: probeOutput.height,
      fps: probeOutput.fps,
      codec: probeOutput.codec,
      bitrate: probeOutput.bitrate,
      size: probeOutput.size,
      sourceFileRef: fileRecord.id,
      probeOutput: probeOutput,
      processorVersion: this.getProcessorVersion(),
    };
    
    // Note: UploadRef is required by schema, but rendered media doesn't have an upload
    // Using fileRecord.id as a placeholder - this may need to be handled differently
    return await this.pocketbaseService.createMedia({
      WorkspaceRef: timeline.WorkspaceRef,
      UploadRef: fileRecord.id, // Placeholder - rendered media doesn't have an upload
      mediaType: MediaType.VIDEO,
      duration: probeOutput.duration,
      mediaData: mediaData,
      proxyFileRef: fileRecord.id, // Use the rendered file as the proxy/source
      version: 1, // Initial version
    });
  }

  /**
   * Create TimelineRender record
   */
  private async createTimelineRenderRecord(
    timelineId: string,
    version: number,
    fileId: string
  ): Promise<void> {
    await this.pocketbaseService.createTimelineRender({
      TimelineRef: timelineId,
      version: version,
      FileRef: fileId,
    });
  }

  /**
   * Get MIME type for format
   */
  private getMimeType(format: string): string {
    const mimeTypes: Record<string, string> = {
      'mp4': 'video/mp4',
      'mov': 'video/quicktime',
      'avi': 'video/x-msvideo',
      'mkv': 'video/x-matroska',
      'webm': 'video/webm',
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
      this.logger.debug(`Cleaned up temp directory: ${tempDir}`);
    } catch (error) {
      this.logger.warn(`Failed to cleanup temp directory ${tempDir}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}