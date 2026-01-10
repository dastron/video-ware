/**
 * Labels Flow Builder
 * Builds BullMQ flow definitions for label detection operations
 */

import type { Task, DetectLabelsPayload } from '@project/shared';
import { RecommendationStrategy } from '@project/shared';
import {
  DetectLabelsStepType,
  RecommendationStepType,
} from '../types/step.types';
import { getStepJobOptions } from '../config/step-options';
import { QUEUE_NAMES } from '../queue.constants';
import type { LabelsFlowDefinition } from './types';
import type { GenerateMediaRecommendationsStepInput } from '../../task-recommendations/types';

export class LabelsFlowBuilder {
  /**
   * Build a detect_labels flow definition for DETECT_LABELS tasks
   * Builds a parent-child job hierarchy:
   * 1. UPLOAD_TO_GCS (runs first, uploads file to GCS)
   * 2. Five new GCVI processors run in parallel (after UPLOAD_TO_GCS):
   *    - LABEL_DETECTION (labels + shot changes)
   *    - OBJECT_TRACKING (tracked objects with keyframes)
   *    - FACE_DETECTION (tracked faces with attributes)
   *    - PERSON_DETECTION (tracked persons with landmarks)
   *    - SPEECH_TRANSCRIPTION (speech-to-text)
   * 3. GENERATE_MEDIA_RECOMMENDATIONS (runs after all label detection steps complete)
   *
   * Each processor processes and writes its own data independently.
   * Legacy processors (VIDEO_INTELLIGENCE, SPEECH_TO_TEXT) are kept for backward compatibility.
   */
  static buildFlow(task: Task): LabelsFlowDefinition {
    const payload = task.payload as DetectLabelsPayload;
    const { mediaId, fileRef } = payload;

    // Build base job data
    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
    };

    // Get current version from Media record (will be incremented on success)
    // For now, we'll use version 1 as default - the actual version should come from payload
    const version = 1;

    // Processors will resolve gcsUri themselves using getExpectedGcsUri(mediaId, fileName)
    // The upload step uses a deterministic path, so processors can compute it

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
          workspaceRef: task.WorkspaceRef,
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

    // LABEL_DETECTION step (depends on UPLOAD_TO_GCS)
    const labelDetectionOptions = getStepJobOptions(
      DetectLabelsStepType.LABEL_DETECTION
    );

    flow.children.push({
      name: DetectLabelsStepType.LABEL_DETECTION,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.LABEL_DETECTION,
        parentJobId: '',
        input: {
          mediaId,
          workspaceRef: task.WorkspaceRef,
          taskRef: task.id,
          version,
        },
      },
      opts: {
        attempts: labelDetectionOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: labelDetectionOptions.backoff,
        },
      },
      children: [
        {
          name: DetectLabelsStepType.UPLOAD_TO_GCS,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });

    // OBJECT_TRACKING step (depends on UPLOAD_TO_GCS)
    const objectTrackingOptions = getStepJobOptions(
      DetectLabelsStepType.OBJECT_TRACKING
    );

    flow.children.push({
      name: DetectLabelsStepType.OBJECT_TRACKING,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.OBJECT_TRACKING,
        parentJobId: '',
        input: {
          mediaId,
          workspaceRef: task.WorkspaceRef,
          taskRef: task.id,
          version,
        },
      },
      opts: {
        attempts: objectTrackingOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: objectTrackingOptions.backoff,
        },
      },
      children: [
        {
          name: DetectLabelsStepType.UPLOAD_TO_GCS,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });

    // FACE_DETECTION step (depends on UPLOAD_TO_GCS)
    const faceDetectionOptions = getStepJobOptions(
      DetectLabelsStepType.FACE_DETECTION
    );

    flow.children.push({
      name: DetectLabelsStepType.FACE_DETECTION,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.FACE_DETECTION,
        parentJobId: '',
        input: {
          mediaId,
          workspaceRef: task.WorkspaceRef,
          taskRef: task.id,
          version,
        },
      },
      opts: {
        attempts: faceDetectionOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: faceDetectionOptions.backoff,
        },
      },
      children: [
        {
          name: DetectLabelsStepType.UPLOAD_TO_GCS,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });

    // PERSON_DETECTION step (depends on UPLOAD_TO_GCS)
    const personDetectionOptions = getStepJobOptions(
      DetectLabelsStepType.PERSON_DETECTION
    );

    flow.children.push({
      name: DetectLabelsStepType.PERSON_DETECTION,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.PERSON_DETECTION,
        parentJobId: '',
        input: {
          mediaId,
          workspaceRef: task.WorkspaceRef,
          taskRef: task.id,
          version,
        },
      },
      opts: {
        attempts: personDetectionOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: personDetectionOptions.backoff,
        },
      },
      children: [
        {
          name: DetectLabelsStepType.UPLOAD_TO_GCS,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });

    // SPEECH_TRANSCRIPTION step (depends on UPLOAD_TO_GCS)
    const speechTranscriptionOptions = getStepJobOptions(
      DetectLabelsStepType.SPEECH_TRANSCRIPTION
    );

    flow.children.push({
      name: DetectLabelsStepType.SPEECH_TRANSCRIPTION,
      queueName: QUEUE_NAMES.LABELS,
      data: {
        ...baseJobData,
        stepType: DetectLabelsStepType.SPEECH_TRANSCRIPTION,
        parentJobId: '',
        input: {
          mediaId,
          workspaceRef: task.WorkspaceRef,
          taskRef: task.id,
          version,
        },
      },
      opts: {
        attempts: speechTranscriptionOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: speechTranscriptionOptions.backoff,
        },
      },
      children: [
        {
          name: DetectLabelsStepType.UPLOAD_TO_GCS,
          queueName: QUEUE_NAMES.LABELS,
        },
      ],
    });
    return flow;
  }
}
