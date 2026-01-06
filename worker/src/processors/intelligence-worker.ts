import { BaseWorker } from './base-worker.js';
import type {
  Task,
  TypedPocketBase,
  DetectLabelsPayload,
} from '@project/shared';
import { MediaMutator, TaskStatus, ProcessingProvider } from '@project/shared';
import { getProcessor } from './index.js';

/**
 * Worker for processing intelligence/label detection tasks (DETECT_LABELS)
 * Handles:
 * - Object and label detection using Google Video Intelligence
 * - Configurable detection features
 */
export class IntelligenceWorker extends BaseWorker {
  private mediaMutator: MediaMutator;

  constructor(pb: TypedPocketBase) {
    super(pb);
    this.mediaMutator = new MediaMutator(pb);
  }

  async processTask(task: Task): Promise<void> {
    // Parse payload
    const payload = task.payload as unknown as DetectLabelsPayload;
    const { mediaId, fileRef, provider, config } = payload;

    console.log(
      `[IntelligenceWorker] Processing detect_labels task ${task.id} for media ${mediaId}`
    );

    // Update task status to running
    await this.taskMutator.update(task.id, {
      status: TaskStatus.RUNNING,
      progress: 10,
    } as Partial<Task>);

    // Get the media record
    const media = await this.mediaMutator.getById(mediaId);
    if (!media) {
      throw new Error(`Media ${mediaId} not found`);
    }

    // Get the processor
    const processorProvider =
      provider || ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE;
    const processor = getProcessor(processorProvider, this.pb);

    if (!processor.detectLabels) {
      throw new Error(
        `Processor ${processor.provider} does not support detectLabels`
      );
    }

    console.log(
      `[IntelligenceWorker] Using processor: ${processor.provider} v${processor.version}`
    );

    // Step 1: Run detection
    await this.updateProgress(task.id, 20);
    const result = await processor.detectLabels(fileRef, config);

    // Step 2: Mark task as successful
    await this.markSuccess(
      task.id,
      result as unknown as Record<string, unknown>
    );
  }
}
