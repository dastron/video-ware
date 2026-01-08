# Base Processor Classes

This directory contains base classes for implementing BullMQ processors with automatic task status tracking.

## BaseParentProcessor

Abstract base class for parent processors that orchestrate child step jobs and manage task status updates.

### Features

- **Automatic Task Status Updates**: Updates task status in PocketBase on job start, success, and failure
- **Retry Handling**: Tracks retry attempts and updates task status appropriately
- **Event Handling**: Provides `@OnWorkerEvent` handlers for `completed` and `failed` events
- **Error Resilience**: Gracefully handles status update failures without blocking job processing

### Usage

Extend `BaseParentProcessor` and implement the required abstract methods:

```typescript
import { Processor } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseParentProcessor } from '../../queue/processors/base-parent.processor';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { ParentJobData, StepJobData, StepResult } from '../../queue/types/job.types';

@Processor('my-queue')
export class MyParentProcessor extends BaseParentProcessor {
  protected readonly logger = new Logger(MyParentProcessor.name);

  constructor(
    protected readonly pocketbaseService: PocketBaseService,
    // ... inject your step processors
  ) {
    super();
  }

  protected async processParentJob(job: Job<ParentJobData>): Promise<void> {
    const { task } = job.data;
    
    // Update task to RUNNING
    await this.updateTaskStatus(task.id, TaskStatus.RUNNING);
    
    // Wait for children
    const childrenValues = await job.getChildrenValues();
    
    // Check for failures and update status accordingly
    // Base class will handle SUCCESS status on completion
  }

  protected async processStepJob(job: Job<StepJobData>): Promise<StepResult> {
    const { stepType, input } = job.data;
    
    // Dispatch to appropriate step processor
    // Return StepResult with status, output, timestamps
  }
}
```

### Task Status Flow

1. **Job Start**: When parent job starts, update task to `RUNNING`
2. **Job Success**: When parent job completes, base class updates task to `SUCCESS`
3. **Job Failure**: 
   - Parent job fails → task set to `FAILED`
   - Step job fails with retries remaining → task stays `RUNNING`
   - Step job exhausts retries → task set to `FAILED`

### Methods

#### `updateTaskStatus(taskId: string, status: TaskStatus): Promise<void>`

Protected method to update task status in PocketBase. Handles errors gracefully.

#### `processParentJob(job: Job<ParentJobData>): Promise<void>` (abstract)

Implement this to orchestrate child steps and determine overall success/failure.

#### `processStepJob(job: Job<StepJobData>): Promise<StepResult>` (abstract)

Implement this to dispatch to appropriate step processors based on `stepType`.

## BaseStepProcessor

Abstract base class for step processors that execute individual processing steps.

### Usage

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';

@Injectable()
export class MyStepProcessor extends BaseStepProcessor<MyInput, MyOutput> {
  protected readonly logger = new Logger(MyStepProcessor.name);

  async process(input: MyInput, job: Job): Promise<MyOutput> {
    // Implement your step logic
    // Use this.updateProgress(job, percentage) to report progress
    return output;
  }
}
```

## Example: Transcode Parent Processor

See `worker/src/transcode/processors/transcode-parent.processor.ts` for a complete example of using `BaseParentProcessor`.
