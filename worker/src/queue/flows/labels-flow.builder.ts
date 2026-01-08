/**
 * Labels Flow Builder
 * Builds BullMQ flow definitions for label detection operations
 */

import type {
  Task,
  DetectLabelsPayload,
  ProcessingProvider,
} from '@project/shared';
import { DetectLabelsStepType } from '../types/step.types';
import { getStepJobOptions } from '../config/step-options';
import { QUEUE_NAMES } from '../queue.constants';
import { getLabelCachePath } from '../../task-labels/utils/cache-keys';
import type { LabelsFlowDefinition } from './types';

export class LabelsFlowBuilder {
  /**
   * Build a detect_labels flow definition for DETECT_LABELS tasks
   * Builds a parent-child job hierarchy:
   * 1. UPLOAD_TO_GCS (runs first, uploads file to GCS)
   * 2. VIDEO_INTELLIGENCE → PROCESS_VIDEO_INTELLIGENCE_LABELS (parallel branch)
   * 3. SPEECH_TO_TEXT → PROCESS_SPEECH_TO_TEXT_LABELS (parallel branch)
   *
   * Each extraction step processes and writes its own data independently
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

    // UPLOAD_TO_GCS step (runs first)
    const uploadOptions = getStepJobOptions(DetectLabelsStepType.UPLOAD_TO_GCS);

    flow.children.push({
      name: DetectLabelsStepType.UPLOAD_TO_GCS,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.UPLOAD_TO_GCS,
        parentJobId: '',
        input: {
          type: 'upload_to_gcs',
          mediaId,
          fileRef,
        },
      },
      opts: {
        attempts: uploadOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: uploadOptions.backoff,
        },
      },
    });

    // VIDEO_INTELLIGENCE step (depends on UPLOAD_TO_GCS)
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
        parentJobId: '',
        input: {
          type: 'video_intelligence',
          mediaId,
          fileRef,
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
      children: [
        {
          name: DetectLabelsStepType.UPLOAD_TO_GCS,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });

    // SPEECH_TO_TEXT step (depends on UPLOAD_TO_GCS)
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
      children: [
        {
          name: DetectLabelsStepType.UPLOAD_TO_GCS,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });

    // PROCESS_VIDEO_INTELLIGENCE_LABELS step (depends on VIDEO_INTELLIGENCE)
    const processVideoLabelsOptions = getStepJobOptions(
      DetectLabelsStepType.PROCESS_VIDEO_INTELLIGENCE_LABELS
    );

    flow.children.push({
      name: DetectLabelsStepType.PROCESS_VIDEO_INTELLIGENCE_LABELS,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.PROCESS_VIDEO_INTELLIGENCE_LABELS,
        parentJobId: '',
        input: {
          type: 'process_video_intelligence_labels',
          mediaId,
          workspaceRef: task.WorkspaceRef,
          taskRef: task.id,
          version,
          processor: processorVersion,
        },
      },
      opts: {
        attempts: processVideoLabelsOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: processVideoLabelsOptions.backoff,
        },
      },
      children: [
        {
          name: DetectLabelsStepType.VIDEO_INTELLIGENCE,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });

    // PROCESS_SPEECH_TO_TEXT_LABELS step (depends on SPEECH_TO_TEXT)
    const processSpeechLabelsOptions = getStepJobOptions(
      DetectLabelsStepType.PROCESS_SPEECH_TO_TEXT_LABELS
    );

    flow.children.push({
      name: DetectLabelsStepType.PROCESS_SPEECH_TO_TEXT_LABELS,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.PROCESS_SPEECH_TO_TEXT_LABELS,
        parentJobId: '',
        input: {
          type: 'process_speech_to_text_labels',
          mediaId,
          workspaceRef: task.WorkspaceRef,
          taskRef: task.id,
          version,
          processor: processorVersion,
        },
      },
      opts: {
        attempts: processSpeechLabelsOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: processSpeechLabelsOptions.backoff,
        },
      },
      children: [
        {
          name: DetectLabelsStepType.SPEECH_TO_TEXT,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });

    return flow;
  }
}
