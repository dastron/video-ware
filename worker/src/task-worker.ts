/**
 * Task Worker - Background processor for media uploads and other long-running tasks
 *
 * This worker polls the PocketBase Tasks collection for queued tasks and processes them.
 * It uses a worker registry pattern to delegate task processing to specialized workers.
 *
 * Features:
 * - Idempotent processing (checks for existing Media before creating)
 * - Exponential backoff retry logic
 * - Deterministic output naming
 * - Distributed task processing across specialized workers
 *
 * Usage:
 *   node worker/src/task-worker.ts
 *   or
 *   tsx worker/src/task-worker.ts
 */

import PocketBase from 'pocketbase';
import { env } from '@project/shared/env';
import {
  TaskType,
  TaskMutator,
  type Task,
  type TypedPocketBase,
} from '@project/shared';
import { TranscodeWorker } from './processors/transcode-worker.js';
import { IntelligenceWorker } from './processors/intelligence-worker.js';
import { RenderTimelineWorker } from './processors/render-timeline-worker.js';
import type { BaseWorker } from './processors/base-worker.js';

// Configuration
const POCKETBASE_URL = env.POCKETBASE_URL;
const POLL_INTERVAL_MS = 60000; // Poll every 60 seconds

/**
 * Initialize PocketBase client for the worker
 * Authenticates as superuser using admin credentials
 */
async function createWorkerPocketBase(): Promise<TypedPocketBase> {
  const pb = new PocketBase(POCKETBASE_URL) as TypedPocketBase;

  // Disable autoCancellation for server-side usage
  pb.autoCancellation(false);

  // Get admin credentials from environment
  const adminEmail = env.POCKETBASE_ADMIN_EMAIL;
  const adminPassword = env.POCKETBASE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD environment variables are required'
    );
  }

  // Authenticate as superuser
  // Note: _superusers is a system collection, not in TypedPocketBase interface
  await (pb as PocketBase)
    .collection('_superusers')
    .authWithPassword(adminEmail, adminPassword, {
      autoRefreshThreshold: 30 * 60, // Auto-refresh 30 minutes before expiry
    });

  console.log('[Worker] Connected to PocketBase at:', POCKETBASE_URL);
  console.log('[Worker] Authenticated as superuser:', adminEmail);

  return pb;
}

/**
 * Worker registry - maps task types to worker instances
 */
class WorkerRegistry {
  private workers: Map<TaskType, BaseWorker>;

  constructor(pb: TypedPocketBase) {
    this.workers = new Map();

    // Register workers for each task type
    this.workers.set(TaskType.PROCESS_UPLOAD, new TranscodeWorker(pb));
    this.workers.set(TaskType.DETECT_LABELS, new IntelligenceWorker(pb));
    this.workers.set(TaskType.RENDER_TIMELINE, new RenderTimelineWorker(pb));
  }

  /**
   * Get the appropriate worker for a task type
   */
  getWorker(taskType: TaskType): BaseWorker | undefined {
    return this.workers.get(taskType);
  }

  /**
   * Check if a task type has a registered worker
   */
  hasWorker(taskType: TaskType): boolean {
    return this.workers.has(taskType);
  }
}

/**
 * Process a single task based on its type
 * @param registry Worker registry
 * @param task The task to process
 */
async function processTask(
  registry: WorkerRegistry,
  task: Task
): Promise<void> {
  const worker = registry.getWorker(task.type as TaskType);

  if (!worker) {
    if (
      task.type === TaskType.DERIVE_CLIPS ||
      task.type === TaskType.RECOMMEND_CLIPS
    ) {
      console.log(`[Worker] Task type ${task.type} not yet implemented`);
    } else {
      console.error(`[Worker] Unknown task type: ${task.type}`);
    }
    return;
  }

  // Execute the task using the appropriate worker
  await worker.execute(task);
}

/**
 * Main worker loop
 * Polls for queued tasks and processes them
 */
async function runWorker(): Promise<void> {
  console.log('[Worker] Starting task worker...');
  console.log(`[Worker] PocketBase URL: ${POCKETBASE_URL}`);
  console.log(`[Worker] Poll interval: ${POLL_INTERVAL_MS}ms`);

  const pb = await createWorkerPocketBase();
  const taskMutator = new TaskMutator(pb);
  const registry = new WorkerRegistry(pb);

  console.log('[Worker] Registered workers for task types:');
  const registeredTypes = [
    TaskType.PROCESS_UPLOAD,
    TaskType.DETECT_LABELS,
    TaskType.RENDER_TIMELINE,
  ];
  for (const taskType of registeredTypes) {
    console.log(`  - ${taskType}`);
  }

  // Main loop
  while (true) {
    try {
      // Get queued tasks
      const queuedTasks = await taskMutator.getQueuedTasks(
        undefined,
        1,
        10 // Process up to 10 tasks per iteration
      );

      if (queuedTasks.items.length > 0) {
        console.log(
          `[Worker] Found ${queuedTasks.items.length} queued task(s)`
        );

        // Process tasks sequentially
        for (const task of queuedTasks.items) {
          await processTask(registry, task);
        }
      } else {
        // console.log('[Worker] No queued tasks found');
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    } catch (error) {
      console.error('[Worker] Error in main loop:', error);
      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

// Start the worker if this file is run directly
if (import.meta.url.endsWith(process.argv[1])) {
  runWorker().catch((error) => {
    console.error('[Worker] Fatal error:', error);
    process.exit(1);
  });
}

// Export for testing
export { runWorker, processTask };
