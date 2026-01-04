import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { TaskInputSchema, TaskStatus, TaskType } from '@project/shared';
import type { Task, TaskInput } from '@project/shared';
import type { TypedPocketBase } from '@/lib/types';
import { BaseMutator, type MutatorOptions } from './base';

// Task payload and result types
export interface ProcessUploadPayload {
  uploadId: string;
  originalFileRef: string;
  provider?: string;
  sprite?: {
    fps: number;
    cols: number;
    rows: number;
    tileWidth: number;
    tileHeight: number;
  };
  thumbnail?: {
    timestamp: number | 'midpoint';
    width: number;
    height: number;
  };
}

export interface ProcessUploadResult {
  mediaId: string;
  thumbnailFileId?: string;
  spriteFileId?: string;
  proxyFileId?: string;
  processorVersion: string;
  probeOutput: {
    duration: number;
    width: number;
    height: number;
    codec: string;
    fps: number;
    bitrate?: number;
  };
}

export class TaskMutator extends BaseMutator<Task, TaskInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Task> {
    return this.pb.collection('Tasks');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef', 'UploadRef', 'MediaRef', 'UserRef'],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(input: TaskInput): Promise<TaskInput> {
    return TaskInputSchema.parse(input);
  }

  /**
   * Create a process upload task
   * @param workspaceId The workspace ID
   * @param uploadId The upload ID
   * @param payload The task payload
   * @returns The created task
   */
  async createProcessUploadTask(
    workspaceId: string,
    uploadId: string,
    payload: ProcessUploadPayload
  ): Promise<Task> {
    return this.create({
      sourceType: 'upload',
      sourceId: uploadId,
      type: TaskType.PROCESS_UPLOAD,
      status: TaskStatus.QUEUED,
      progress: 1,
      attempts: 1,
      payload: payload as unknown as Record<string, unknown>,
      WorkspaceRef: workspaceId,
      UploadRef: uploadId,
    });
  }

  /**
   * Update task progress
   * @param id The task ID
   * @param progress The progress percentage (0-100)
   * @returns The updated task
   */
  async updateProgress(id: string, progress: number): Promise<Task> {
    return this.update(id, { progress } as Partial<Task>);
  }

  /**
   * Mark task as successful
   * @param id The task ID
   * @param result The task result
   * @returns The updated task
   */
  async markSuccess(id: string, result: ProcessUploadResult): Promise<Task> {
    return this.update(id, {
      status: TaskStatus.SUCCESS,
      progress: 100,
      result: result as unknown as Record<string, unknown>,
    } as Partial<Task>);
  }

  /**
   * Mark task as failed
   * @param id The task ID
   * @param errorLog The error message
   * @returns The updated task
   */
  async markFailed(id: string, errorLog: string): Promise<Task> {
    const task = await this.getById(id);
    return this.update(id, {
      status: TaskStatus.FAILED,
      errorLog,
      attempts: (task?.attempts || 0) + 1,
    } as Partial<Task>);
  }

  /**
   * Get queued tasks
   * @param type Optional task type filter
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of queued tasks
   */
  async getQueuedTasks(
    type?: TaskType,
    page = 1,
    perPage = 100
  ): Promise<ListResult<Task>> {
    const filter = type
      ? `status = "${TaskStatus.QUEUED}" && type = "${type}"`
      : `status = "${TaskStatus.QUEUED}"`;
    return this.getList(page, perPage, filter, 'created');
  }
}
