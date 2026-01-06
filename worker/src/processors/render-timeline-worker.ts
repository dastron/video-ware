import { BaseWorker } from './base-worker.js';
import type {
  Task,
  TypedPocketBase,
  RenderTimelinePayload,
  RenderTimelineResult,
} from '@project/shared';
import {
  FileMutator,
  TimelineRenderMutator,
  TaskStatus,
  FileType,
  FileStatus,
  FileSource,
  ProcessingProvider,
} from '@project/shared';
import { getProcessor } from './index.js';
import { readFileSync } from 'node:fs';

/**
 * Worker for processing timeline rendering tasks (RENDER_TIMELINE)
 * Handles:
 * - Rendering timelines using configured processor (FFmpeg or Google Transcoder)
 * - Creating File records for rendered output with all relevant metadata
 * - Updating Timeline records with render results
 */
export class RenderTimelineWorker extends BaseWorker {
  private fileMutator: FileMutator;
  private timelineRenderMutator: TimelineRenderMutator;

  constructor(pb: TypedPocketBase) {
    super(pb);
    this.fileMutator = new FileMutator(pb);
    this.timelineRenderMutator = new TimelineRenderMutator(pb);
  }

  async processTask(task: Task): Promise<void> {
    const timelineMutator = this.pb.collection('Timelines');

    // Parse payload
    const payload = task.payload as unknown as RenderTimelinePayload;
    const { timelineId, provider, outputSettings } = payload;

    console.log(
      `[RenderTimelineWorker] Processing render_timeline task ${task.id} for timeline ${timelineId}`
    );

    // Update task status to running
    await this.taskMutator.update(task.id, {
      status: TaskStatus.RUNNING,
      progress: 10,
    } as Partial<Task>);

    // Get timeline to access version
    const timeline = await timelineMutator.getOne(timelineId);

    // Get the processor
    const processorProvider = provider || ProcessingProvider.FFMPEG;
    const processor = getProcessor(processorProvider, this.pb);

    if (!processor.renderTimeline) {
      throw new Error(
        `Processor ${processor.provider} does not support renderTimeline`
      );
    }

    console.log(
      `[RenderTimelineWorker] Using processor: ${processor.provider} v${processor.version}`
    );

    // Step 1: Render the timeline
    await this.updateProgress(task.id, 20);
    console.log(`[RenderTimelineWorker] Rendering timeline...`);

    // Explicitly cast to string to avoid type check issues
    const outputPath = (await processor.renderTimeline(
      payload
    )) as unknown as string;

    await this.updateProgress(task.id, 80);
    console.log(`[RenderTimelineWorker] Render complete: ${outputPath}`);

    // Step 2: Probe the rendered output to get metadata
    console.log(`[RenderTimelineWorker] Probing rendered output...`);
    let probeOutput: import('@project/shared').ProbeOutput;
    try {
      probeOutput = await processor.probe(outputPath);
    } catch (e) {
      console.warn('Failed to probe rendered output, using defaults', e);
      probeOutput = {
        duration: 0,
        width: outputSettings.resolution === '1920x1080' ? 1920 : 1280,
        height: outputSettings.resolution === '1920x1080' ? 1080 : 720,
        codec: outputSettings.codec,
        fps: 30,
      };
    }

    // Step 3: Create File record for the rendered output with all relevant metadata
    const fileName =
      outputPath.split('/').pop() || `timeline-${timelineId}.mp4`;
    const fileSize = outputPath.startsWith('gs://')
      ? 0
      : this.getFileSize(outputPath);

    // Detect file source
    const fileSource = outputPath.startsWith('gs://')
      ? FileSource.GCS
      : FileSource.POCKETBASE;

    // Prepare metadata to store in File.meta
    const fileMeta = {
      // Probe output data
      probe: probeOutput,
      // Rendering settings
      renderSettings: {
        resolution: outputSettings.resolution,
        codec: outputSettings.codec,
        format: outputSettings.format,
      },
      // Processor information
      processor: {
        provider: processor.provider,
        version: processor.version,
      },
      // Timeline reference
      timelineId: timelineId,
      // Task reference
      taskId: task.id,
    };

    let fileRecord;

    if (fileSource === FileSource.POCKETBASE) {
      // Upload local file
      const fileContent = readFileSync(outputPath);
      fileRecord = await this.fileMutator.create({
        name: fileName,
        size: fileSize,
        fileStatus: FileStatus.AVAILABLE,
        fileType: FileType.RENDER,
        fileSource: fileSource,
        file: new File([fileContent], fileName, { type: 'video/mp4' }),
        meta: fileMeta as unknown as Record<string, unknown>,
        WorkspaceRef: task.WorkspaceRef,
      });
    } else {
      // GCS Reference
      fileRecord = await this.fileMutator.create({
        name: fileName,
        size: fileSize,
        fileStatus: FileStatus.AVAILABLE,
        fileType: FileType.RENDER,
        fileSource: fileSource,
        s3Key: outputPath,
        meta: fileMeta as unknown as Record<string, unknown>,
        WorkspaceRef: task.WorkspaceRef,
      });
    }

    console.log(
      `[RenderTimelineWorker] Created File record ${fileRecord.id} for rendered timeline`
    );

    // Step 4: Create TimelineRender record linking timeline, file, and version
    const timelineRender = await this.timelineRenderMutator.create({
      TimelineRef: timelineId,
      FileRef: fileRecord.id,
      timelineVersion: timeline.version,
    });

    console.log(
      `[RenderTimelineWorker] Created TimelineRender record ${timelineRender.id} for timeline version ${timeline.version}`
    );

    // Step 5: Update Timeline record with the render result
    await this.pb.collection('Timelines').update(timelineId, {
      renderTaskRef: task.id,
    });

    // Step 6: Success
    const result: RenderTimelineResult = {
      fileId: fileRecord.id,
      processorVersion: `${processor.provider}:${processor.version}`,
      // Keep mediaId for backward compatibility, but it's not used anymore
      mediaId: '',
    };

    await this.markSuccess(
      task.id,
      result as unknown as Record<string, unknown>
    );
  }
}
