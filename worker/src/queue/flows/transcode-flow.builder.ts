/**
 * Transcode Flow Builder
 * Builds BullMQ flow definitions for transcode operations
 */

import type { Task, ProcessUploadPayload } from '@project/shared';
import { TranscodeStepType } from '../types/step.types';
import { getStepJobOptions } from '../config/step-options';
import { QUEUE_NAMES } from '../queue.constants';
import type { TranscodeFlowDefinition } from './types';

export class TranscodeFlowBuilder {
  /**
   * Build a transcode flow definition for PROCESS_UPLOAD tasks
   * Builds a parent-child job hierarchy with steps: PROBE, THUMBNAIL, SPRITE, TRANSCODE
   */
  static buildFlow(task: Task): TranscodeFlowDefinition {
    const payload = task.payload as ProcessUploadPayload;
    const { uploadId } = payload;

    // Build base job data
    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
    };

    // Create parent job with children
    const flow: TranscodeFlowDefinition = {
      name: 'parent',
      queueName: QUEUE_NAMES.TRANSCODE,
      data: {
        ...baseJobData,
        task,
        stepResults: {},
      },
      children: [],
    };

    // PROBE step (always required)
    const probeOptions = getStepJobOptions(TranscodeStepType.PROBE);
    flow.children.push({
      name: TranscodeStepType.PROBE,
      queueName: QUEUE_NAMES.TRANSCODE,
      data: {
        ...baseJobData,
        stepType: TranscodeStepType.PROBE,
        parentJobId: '', // Will be set by BullMQ
        input: {
          type: 'probe',
          uploadId,
          filePath: '', // Will be resolved by processor
        },
      },
      opts: {
        attempts: probeOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: probeOptions.backoff,
        },
      },
    });

    // THUMBNAIL step (if configured)
    if (payload.thumbnail) {
      const thumbnailOptions = getStepJobOptions(TranscodeStepType.THUMBNAIL);
      flow.children.push({
        name: TranscodeStepType.THUMBNAIL,
        queueName: QUEUE_NAMES.TRANSCODE,
        data: {
          ...baseJobData,
          stepType: TranscodeStepType.THUMBNAIL,
          parentJobId: '',
          input: {
            type: 'thumbnail',
            uploadId,
            filePath: '', // Will be resolved by processor
            config: payload.thumbnail,
          },
        },
        opts: {
          attempts: thumbnailOptions.attempts,
          backoff: {
            type: 'exponential',
            delay: thumbnailOptions.backoff,
          },
        },
      });
    }

    // SPRITE step (if configured)
    if (payload.sprite) {
      const spriteOptions = getStepJobOptions(TranscodeStepType.SPRITE);
      flow.children.push({
        name: TranscodeStepType.SPRITE,
        queueName: QUEUE_NAMES.TRANSCODE,
        data: {
          ...baseJobData,
          stepType: TranscodeStepType.SPRITE,
          parentJobId: '',
          input: {
            type: 'sprite',
            uploadId,
            filePath: '', // Will be resolved by processor
            config: payload.sprite,
          },
        },
        opts: {
          attempts: spriteOptions.attempts,
          backoff: {
            type: 'exponential',
            delay: spriteOptions.backoff,
          },
        },
      });
    }

    // TRANSCODE step (if enabled)
    if (payload.transcode?.enabled) {
      const transcodeOptions = getStepJobOptions(TranscodeStepType.TRANSCODE);
      flow.children.push({
        name: TranscodeStepType.TRANSCODE,
        queueName: QUEUE_NAMES.TRANSCODE,
        data: {
          ...baseJobData,
          stepType: TranscodeStepType.TRANSCODE,
          parentJobId: '',
          input: {
            type: 'transcode',
            uploadId,
            filePath: '', // Will be resolved by processor
            provider: payload.provider || 'ffmpeg',
            config: payload.transcode,
          },
        },
        opts: {
          attempts: transcodeOptions.attempts,
          backoff: {
            type: 'exponential',
            delay: transcodeOptions.backoff,
          },
        },
      });
    }

    return flow;
  }
}
