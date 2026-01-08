/**
 * Labels Flow Builder
 * Builds BullMQ flow definitions for label detection operations
 */

import type { Task, DetectLabelsPayload, ProcessingProvider } from '@project/shared';
import { DetectLabelsStepType } from '../types/step.types';
import { getStepJobOptions } from '../config/step-options';
import { QUEUE_NAMES } from '../queue.constants';
import { getLabelCachePath } from '../../task-labels/utils/cache-keys';
import type { LabelsFlowDefinition } from './types';

export class LabelsFlowBuilder {
  /**
   * Build a detect_labels flow definition for DETECT_LABELS tasks
   * Builds a parent-child job hierarchy with parallel steps: VIDEO_INTELLIGENCE, SPEECH_TO_TEXT
   * Then runs NORMALIZE_LABELS and STORE_RESULTS sequentially
   */
  static buildFlow(task: Task): LabelsFlowDefinition {
    const payload = task.payload as DetectLabelsPayload;
    const { mediaId, fileRef, config } = payload;

    // Build base job data
    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
    };

    // Get current version from Media record (will be incremented on success)
    // For now, we'll use version 1 as default - the actual version should come from payload
    const version = 1;
    const processorVersion = 'detect-labels:1.0.0';

    // Create parent job with children
    const flow: LabelsFlowDefinition = {
      name: 'parent',
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        task,
        stepResults: {},
      },
      children: [],
    };

    // VIDEO_INTELLIGENCE step (runs in parallel with SPEECH_TO_TEXT)
    const videoIntelligenceOptions = getStepJobOptions(
      DetectLabelsStepType.VIDEO_INTELLIGENCE
    );
    const videoCacheKey = getLabelCachePath(
      mediaId,
      version,
      'google_video_intelligence' as ProcessingProvider
    );

    flow.children.push({
      name: DetectLabelsStepType.VIDEO_INTELLIGENCE,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.VIDEO_INTELLIGENCE,
        parentJobId: '', // Will be set by BullMQ
        input: {
          type: 'video_intelligence',
          mediaId,
          fileRef,
          gcsUri: fileRef, // Pass fileRef as gcsUri - will be resolved by processor
          provider: 'google_video_intelligence' as ProcessingProvider,
          config: {
            detectLabels: config.detectLabels !== false,
            detectObjects: config.detectObjects !== false,
            confidenceThreshold: config.confidenceThreshold || 0.5,
          },
          cacheKey: videoCacheKey,
          version,
          processor: processorVersion,
        },
      },
      opts: {
        attempts: videoIntelligenceOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: videoIntelligenceOptions.backoff,
        },
      },
    });

    // SPEECH_TO_TEXT step (runs in parallel with VIDEO_INTELLIGENCE)
    const speechToTextOptions = getStepJobOptions(
      DetectLabelsStepType.SPEECH_TO_TEXT
    );
    const speechCacheKey = getLabelCachePath(
      mediaId,
      version,
      'google_speech' as ProcessingProvider
    );

    flow.children.push({
      name: DetectLabelsStepType.SPEECH_TO_TEXT,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.SPEECH_TO_TEXT,
        parentJobId: '',
        input: {
          type: 'speech_to_text',
          mediaId,
          fileRef,
          gcsUri: fileRef, // Pass fileRef as gcsUri - will be resolved by processor
          provider: 'google_speech' as ProcessingProvider,
          cacheKey: speechCacheKey,
          version,
          processor: processorVersion,
        },
      },
      opts: {
        attempts: speechToTextOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: speechToTextOptions.backoff,
        },
      },
    });

    // NORMALIZE_LABELS step (depends on both VIDEO_INTELLIGENCE and SPEECH_TO_TEXT)
    const normalizeLabelsOptions = getStepJobOptions(
      DetectLabelsStepType.NORMALIZE_LABELS
    );

    flow.children.push({
      name: DetectLabelsStepType.NORMALIZE_LABELS,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.NORMALIZE_LABELS,
        parentJobId: '',
        input: {
          type: 'normalize_labels',
          mediaId,
          workspaceRef: task.WorkspaceRef,
          version,
          videoIntelligence: undefined, // Will be populated from VIDEO_INTELLIGENCE output
          speechToText: undefined, // Will be populated from SPEECH_TO_TEXT output
        },
      },
      opts: {
        attempts: normalizeLabelsOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: normalizeLabelsOptions.backoff,
        },
      },
      children: [
        {
          name: DetectLabelsStepType.VIDEO_INTELLIGENCE,
          queueName: QUEUE_NAMES.LABELS,
        },
        {
          name: DetectLabelsStepType.SPEECH_TO_TEXT,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });

    // STORE_RESULTS step (depends on NORMALIZE_LABELS)
    const storeResultsOptions = getStepJobOptions(
      DetectLabelsStepType.STORE_RESULTS
    );

    flow.children.push({
      name: DetectLabelsStepType.STORE_RESULTS,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.STORE_RESULTS,
        parentJobId: '',
        input: {
          type: 'store_results',
          mediaId,
          workspaceRef: task.WorkspaceRef,
          taskRef: task.id,
          version,
          labelClips: [], // Will be populated from NORMALIZE_LABELS output
          processor: processorVersion,
          provider: 'google_video_intelligence' as ProcessingProvider, // Primary provider
        },
      },
      opts: {
        attempts: storeResultsOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: storeResultsOptions.backoff,
        },
      },
      children: [
        {
          name: DetectLabelsStepType.NORMALIZE_LABELS,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });

    return flow;
  }
}
