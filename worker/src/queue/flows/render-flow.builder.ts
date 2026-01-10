/**
 * Render Flow Builder
 * Builds BullMQ flow definitions for render operations
 */

import type { Task, RenderTimelinePayload } from '@project/shared';
import { RenderStepType } from '../types/step.types';
import { getStepJobOptions } from '../config/step-options';
import { QUEUE_NAMES } from '../queue.constants';
import type { RenderFlowDefinition } from './types';

export class RenderFlowBuilder {
  /**
   * Build a render flow definition for RENDER_TIMELINE tasks
   * Builds a parent-child job hierarchy with steps: RESOLVE_CLIPS, COMPOSE, UPLOAD, CREATE_RECORDS
   */
  static buildFlow(task: Task): RenderFlowDefinition {
    const payload = task.payload as RenderTimelinePayload;
    const { timelineId, version, editList, outputSettings } = payload;

    // Build base job data
    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
    };

    // Create parent job with children
    const flow: RenderFlowDefinition = {
      name: 'parent',
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepResults: {},
      },
      children: [],
    };

    // RESOLVE_CLIPS step (always required, runs first)
    const resolveClipsOptions = getStepJobOptions(RenderStepType.RESOLVE_CLIPS);
    flow.children.push({
      name: RenderStepType.RESOLVE_CLIPS,
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepType: RenderStepType.RESOLVE_CLIPS,
        parentJobId: '', // Will be set by BullMQ
        input: {
          type: 'resolve_clips',
          timelineId,
          editList,
        },
      },
      opts: resolveClipsOptions,
    });

    // COMPOSE step (depends on RESOLVE_CLIPS)
    const composeOptions = getStepJobOptions(RenderStepType.COMPOSE);
    flow.children.push({
      name: RenderStepType.COMPOSE,
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepType: RenderStepType.COMPOSE,
        parentJobId: '',
        input: {
          type: 'compose',
          timelineId,
          editList,
          clipMediaMap: {}, // Will be populated from RESOLVE_CLIPS output
          outputSettings,
          tempDir: '', // Will be created by processor
        },
      },
      opts: composeOptions,
      children: [
        {
          name: RenderStepType.RESOLVE_CLIPS,
          queueName: QUEUE_NAMES.RENDER,
        },
      ],
    });

    // UPLOAD step (depends on COMPOSE)
    const uploadOptions = getStepJobOptions(RenderStepType.UPLOAD);
    flow.children.push({
      name: RenderStepType.UPLOAD,
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepType: RenderStepType.UPLOAD,
        parentJobId: '',
        input: {
          type: 'upload',
          timelineId,
          workspaceId: task.WorkspaceRef,
          outputPath: '', // Will be populated from COMPOSE output
          format: outputSettings.format,
        },
      },
      opts: uploadOptions,
      children: [
        {
          name: RenderStepType.COMPOSE,
          queueName: QUEUE_NAMES.RENDER,
        },
      ],
    });

    // CREATE_RECORDS step (depends on UPLOAD, runs last)
    const createRecordsOptions = getStepJobOptions(
      RenderStepType.CREATE_RECORDS
    );
    flow.children.push({
      name: RenderStepType.CREATE_RECORDS,
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        stepType: RenderStepType.CREATE_RECORDS,
        parentJobId: '',
        input: {
          type: 'create_records',
          timelineId,
          workspaceId: task.WorkspaceRef,
          timelineName: '', // Will be resolved by processor
          version,
          outputPath: '', // Will be populated from COMPOSE output
          storagePath: '', // Will be populated from UPLOAD output
          probeOutput: {}, // Will be populated from COMPOSE output
          format: outputSettings.format,
          tempDir: '', // Will be populated from COMPOSE output
        },
      },
      opts: createRecordsOptions,
      children: [
        {
          name: RenderStepType.UPLOAD,
          queueName: QUEUE_NAMES.RENDER,
        },
      ],
    });

    return flow;
  }
}
