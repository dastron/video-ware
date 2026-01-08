import { Injectable, Logger } from '@nestjs/common';
import { FlowProducer } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { Task } from '@project/shared';

/**
 * Service for creating BullMQ job flows with parent-child relationships
 * Uses FlowProducer to orchestrate multi-step task processing
 */
@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);
  private flowProducer: FlowProducer;

  constructor(private readonly configService: ConfigService) {
    const redisConfig = {
      host: this.configService.get('redis.host', 'localhost'),
      port: this.configService.get('redis.port', 6379),
      password: this.configService.get('redis.password'),
    };

    this.flowProducer = new FlowProducer({ connection: redisConfig });
    this.logger.log('FlowService initialized with Redis connection');
  }

  /**
   * Create a transcode flow for PROCESS_UPLOAD tasks
   * Builds a parent-child job hierarchy with steps: PROBE, THUMBNAIL, SPRITE, TRANSCODE, FINALIZE
   */
  async createTranscodeFlow(task: Task): Promise<string> {
    this.logger.log(`Creating transcode flow for task ${task.id}`);

    const payload = task.payload as any; // ProcessUploadPayload
    const { uploadId } = payload;

    // Import step types and job options
    const { TranscodeStepType } = await import('./types/step.types');
    const { getStepJobOptions } = await import('./config/step-options');
    const { QUEUE_NAMES } = await import('./queue.constants');

    // Build base job data
    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
    };

    // Create parent job with children
    const flow = {
      name: 'parent',
      queueName: QUEUE_NAMES.TRANSCODE,
      data: {
        ...baseJobData,
        task,
        stepResults: {},
      },
      children: [] as any[],
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
            filePath: '',
            probeOutput: {}, // Will be populated from PROBE step output
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
        children: [
          {
            name: TranscodeStepType.PROBE,
            queueName: QUEUE_NAMES.TRANSCODE,
          },
        ],
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
            filePath: '',
            probeOutput: {},
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
        children: [
          {
            name: TranscodeStepType.PROBE,
            queueName: QUEUE_NAMES.TRANSCODE,
          },
        ],
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
            filePath: '',
            probeOutput: {},
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
        children: [
          {
            name: TranscodeStepType.PROBE,
            queueName: QUEUE_NAMES.TRANSCODE,
          },
        ],
      });
    }

    // FINALIZE step (always required, depends on all other steps)
    const finalizeOptions = getStepJobOptions(TranscodeStepType.FINALIZE);
    const finalizeDependencies = [TranscodeStepType.PROBE];

    if (payload.thumbnail) {
      finalizeDependencies.push(TranscodeStepType.THUMBNAIL);
    }
    if (payload.sprite) {
      finalizeDependencies.push(TranscodeStepType.SPRITE);
    }
    if (payload.transcode?.enabled) {
      finalizeDependencies.push(TranscodeStepType.TRANSCODE);
    }

    flow.children.push({
      name: TranscodeStepType.FINALIZE,
      queueName: QUEUE_NAMES.TRANSCODE,
      data: {
        ...baseJobData,
        stepType: TranscodeStepType.FINALIZE,
        parentJobId: '',
        input: {
          type: 'finalize',
          uploadId,
          probeOutput: {},
          thumbnailPath: undefined,
          spritePath: undefined,
          proxyPath: undefined,
        },
      },
      opts: {
        attempts: finalizeOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: finalizeOptions.backoff,
        },
      },
      children: finalizeDependencies.map((stepType) => ({
        name: stepType,
        queueName: QUEUE_NAMES.TRANSCODE,
      })),
    });

    // Add the flow to BullMQ
    const result = await this.flowProducer.add(flow);

    this.logger.log(
      `Created transcode flow for task ${task.id}, parent job: ${result.job.id}`
    );

    return result.job.id!;
  }

  /**
   * Create a render flow for RENDER_TIMELINE tasks
   * Builds a parent-child job hierarchy with steps: RESOLVE_CLIPS, COMPOSE, UPLOAD, CREATE_RECORDS
   */
  async createRenderFlow(task: Task): Promise<string> {
    this.logger.log(`Creating render flow for task ${task.id}`);

    const payload = task.payload as any; // RenderTimelinePayload
    const { timelineId, version, editList, outputSettings } = payload;

    // Import step types and job options
    const { RenderStepType } = await import('./types/step.types');
    const { getStepJobOptions } = await import('./config/step-options');
    const { QUEUE_NAMES } = await import('./queue.constants');

    // Build base job data
    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
    };

    // Create parent job with children
    const flow = {
      name: 'parent',
      queueName: QUEUE_NAMES.RENDER,
      data: {
        ...baseJobData,
        task,
        stepResults: {},
      },
      children: [] as any[],
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
      opts: {
        attempts: resolveClipsOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: resolveClipsOptions.backoff,
        },
      },
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
      opts: {
        attempts: composeOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: composeOptions.backoff,
        },
      },
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
      opts: {
        attempts: uploadOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: uploadOptions.backoff,
        },
      },
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
      opts: {
        attempts: createRecordsOptions.attempts,
        backoff: {
          type: 'exponential',
          delay: createRecordsOptions.backoff,
        },
      },
      children: [
        {
          name: RenderStepType.UPLOAD,
          queueName: QUEUE_NAMES.RENDER,
        },
      ],
    });

    // Add the flow to BullMQ
    const result = await this.flowProducer.add(flow);

    this.logger.log(
      `Created render flow for task ${task.id}, parent job: ${result.job.id}`
    );

    return result.job.id!;
  }

  /**
   * Create an intelligence flow for DETECT_LABELS tasks
   * Builds a parent-child job hierarchy with parallel steps: VIDEO_INTELLIGENCE, SPEECH_TO_TEXT
   * Then runs STORE_RESULTS to combine and persist the results
   */
  async createIntelligenceFlow(task: Task): Promise<string> {
    this.logger.log(`Creating intelligence flow for task ${task.id}`);

    const payload = task.payload as any; // DetectLabelsPayload
    const { mediaId, fileRef, config } = payload;

    // Import step types and job options
    const { IntelligenceStepType } = await import('./types/step.types');
    const { getStepJobOptions } = await import('./config/step-options');
    const { QUEUE_NAMES } = await import('./queue.constants');

    // Build base job data
    const baseJobData = {
      taskId: task.id,
      workspaceId: task.WorkspaceRef,
      attemptNumber: 0,
    };

    // Create parent job with children
    const flow = {
      name: 'parent',
      queueName: QUEUE_NAMES.INTELLIGENCE,
      data: {
        ...baseJobData,
        task,
        stepResults: {},
      },
      children: [] as any[],
    };

    // VIDEO_INTELLIGENCE step (runs in parallel with SPEECH_TO_TEXT)
    const videoIntelligenceOptions = getStepJobOptions(
      IntelligenceStepType.VIDEO_INTELLIGENCE
    );
    flow.children.push({
      name: IntelligenceStepType.VIDEO_INTELLIGENCE,
      queueName: QUEUE_NAMES.INTELLIGENCE,
      data: {
        ...baseJobData,
        stepType: IntelligenceStepType.VIDEO_INTELLIGENCE,
        parentJobId: '', // Will be set by BullMQ
        input: {
          type: 'video_intelligence',
          mediaId,
          fileRef,
          filePath: '', // Will be resolved by processor
          config: {
            detectLabels: config.detectLabels !== false,
            detectObjects: config.detectObjects !== false,
            detectSceneChanges: config.detectSceneChanges !== false,
            confidenceThreshold: config.confidenceThreshold || 0.5,
          },
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
      IntelligenceStepType.SPEECH_TO_TEXT
    );
    flow.children.push({
      name: IntelligenceStepType.SPEECH_TO_TEXT,
      queueName: QUEUE_NAMES.INTELLIGENCE,
      data: {
        ...baseJobData,
        stepType: IntelligenceStepType.SPEECH_TO_TEXT,
        parentJobId: '',
        input: {
          type: 'speech_to_text',
          mediaId,
          fileRef,
          filePath: '', // Will be resolved by processor
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

    // STORE_RESULTS step (depends on both VIDEO_INTELLIGENCE and SPEECH_TO_TEXT)
    // This step will run even if one of the analysis steps fails (partial success)
    const storeResultsOptions = getStepJobOptions(
      IntelligenceStepType.STORE_RESULTS
    );
    flow.children.push({
      name: IntelligenceStepType.STORE_RESULTS,
      queueName: QUEUE_NAMES.INTELLIGENCE,
      data: {
        ...baseJobData,
        stepType: IntelligenceStepType.STORE_RESULTS,
        parentJobId: '',
        input: {
          type: 'store_results',
          mediaId,
          videoIntelligence: undefined, // Will be populated from VIDEO_INTELLIGENCE output
          speechToText: undefined, // Will be populated from SPEECH_TO_TEXT output
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
          name: IntelligenceStepType.VIDEO_INTELLIGENCE,
          queueName: QUEUE_NAMES.INTELLIGENCE,
        },
        {
          name: IntelligenceStepType.SPEECH_TO_TEXT,
          queueName: QUEUE_NAMES.INTELLIGENCE,
        },
      ],
    });

    // Add the flow to BullMQ
    const result = await this.flowProducer.add(flow);

    this.logger.log(
      `Created intelligence flow for task ${task.id}, parent job: ${result.job.id}`
    );

    return result.job.id!;
  }

  /**
   * Clean up resources on module destroy
   */
  async onModuleDestroy() {
    await this.flowProducer.close();
    this.logger.log('FlowService closed');
  }
}
