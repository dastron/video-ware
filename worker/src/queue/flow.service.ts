import { Injectable, Logger } from '@nestjs/common';
import { FlowProducer } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { Task } from '@project/shared';
import { TaskType } from '@project/shared';
import {
  TranscodeFlowBuilder,
  RenderFlowBuilder,
  LabelsFlowBuilder,
} from './flows';
import type { FlowDefinition } from './flows';

/**
 * Service for creating BullMQ job flows with parent-child relationships
 * Uses FlowProducer to orchestrate multi-step task processing
 *
 * Flow definitions are created by flow builders based on task type
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
   * Create and add a flow based on task type
   *
   * @param task - Task record containing type and payload
   * @returns Parent job ID
   */
  async createFlow(task: Task): Promise<string> {
    this.logger.log(`Creating flow for task ${task.id} (type: ${task.type})`);

    const flowDefinition = this.buildFlowForTask(task);
    const result = await this.flowProducer.add(flowDefinition);

    this.logger.log(
      `Flow created for task ${task.id}, parent job: ${result.job.id}`
    );

    return result.job.id!;
  }

  /**
   * Add a pre-built flow to BullMQ
   * Generic method that accepts any flow definition
   *
   * @param flowDefinition - Flow definition with parent and child jobs
   * @returns Parent job ID
   */
  async addFlow(flowDefinition: FlowDefinition): Promise<string> {
    this.logger.log(`Adding flow to BullMQ: ${flowDefinition.name}`);

    const result = await this.flowProducer.add(flowDefinition);

    this.logger.log(`Flow added, parent job: ${result.job.id}`);

    return result.job.id!;
  }

  /**
   * Build flow definition based on task type
   */
  private buildFlowForTask(task: Task): FlowDefinition {
    switch (task.type) {
      case TaskType.PROCESS_UPLOAD:
        return TranscodeFlowBuilder.buildFlow(task);

      case TaskType.RENDER_TIMELINE:
        return RenderFlowBuilder.buildFlow(task);

      case TaskType.DETECT_LABELS:
        return LabelsFlowBuilder.buildFlow(task);

      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }
  }

  /**
   * Clean up resources on module destroy
   */
  async onModuleDestroy() {
    await this.flowProducer.close();
    this.logger.log('FlowService closed');
  }
}
