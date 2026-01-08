# Queue Service Migration to BullMQ Best Practices

## Overview

This document describes the migration of the queue service to leverage BullMQ's built-in features more directly, eliminating custom deduplication logic and simplifying job management.

## Key Changes

### 1. QueueService Simplification

**Before:**
- Custom `hasJob()`, `getJobState()`, `removeJob()` methods
- Manual job state checking before enqueueing
- Complex deduplication logic outside of BullMQ

**After:**
- Direct use of BullMQ's `jobId` for deduplication
- Simplified to just `addXJob()` methods and `getQueueMetrics()`
- BullMQ handles all job state management

### 2. Job Configuration Improvements

Each job is now configured with proper BullMQ options:

```typescript
{
  jobId: task.id,              // BullMQ uses this for deduplication
  priority: task.priority || 0, // Priority-based processing
  removeOnComplete: true,       // Auto-cleanup successful jobs
  removeOnFail: false,          // Keep failed jobs for debugging
}
```

### 3. TaskEnqueuerService Streamlining

**Before:**
```typescript
// Check job state
const state = await this.queueService.getTranscodeJobState(task.id);
if (state && state !== 'failed' && state !== 'completed') {
  await this.markTaskClaimed(task.id);
  return;
}
// Remove old jobs
if (state === 'failed' || state === 'completed') {
  await this.queueService.removeTranscodeJob(task.id);
}
// Add job
await this.queueService.addTranscodeJob(task);
```

**After:**
```typescript
// Just add the job - BullMQ handles deduplication
await this.queueService.addTranscodeJob(task);
```

### 4. Error Handling

BullMQ throws an error when trying to add a job with a duplicate `jobId`. We treat this as benign:

```typescript
catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  
  // BullMQ throws if a job with the same jobId already exists
  if (message.toLowerCase().includes('job') && 
      message.toLowerCase().includes('already') || 
      message.toLowerCase().includes('exists')) {
    this.logger.debug(`Task ${task.id} already enqueued`);
    await this.markTaskClaimed(task.id);
    return;
  }
  
  // Handle unexpected errors
  this.logger.error(`Failed to enqueue task ${task.id}: ${message}`);
}
```

## Benefits

### 1. **Simpler Code**
- Removed ~50 lines of custom deduplication logic
- Clearer separation of concerns
- Easier to understand and maintain

### 2. **Better Bull Board Integration**
- Jobs properly tracked with unique IDs
- Failed jobs retained for debugging (`removeOnFail: false`)
- Successful jobs auto-cleaned (`removeOnComplete: true`)
- Priority visible in the UI

### 3. **More Reliable**
- BullMQ's battle-tested deduplication
- Atomic job creation in Redis
- No race conditions between checking and adding jobs

### 4. **Less Redis Traffic**
- 3 Redis calls reduced to 1 per job
- No more state checking before adding
- No more manual job removal

## Testing

The test suite has been updated to reflect the new simplified interface:

- **Property 1: Task Queue Routing** - Validates jobs are routed to correct queues
- **Property 2: BullMQ Job Configuration** - Validates all BullMQ options are set correctly

Both properties use property-based testing with fast-check for 100 random test cases each.

## Bull Board

With this migration, Bull Board now provides:

- **Job Tracking**: All jobs visible with their status (waiting, active, completed, failed)
- **Job Details**: View task payload, progress, and error messages
- **Job Management**: Retry failed jobs, remove jobs, view job logs
- **Queue Metrics**: Real-time stats for all three queues (transcode, intelligence, render)

## Migration Checklist

- [x] Simplify QueueService to remove custom dedup methods
- [x] Update TaskEnqueuerService to use BullMQ jobId deduplication
- [x] Update tests to match new interface
- [x] Fix linter errors
- [ ] Monitor Bull Board after deployment
- [ ] Verify failed jobs are retained for debugging
- [ ] Verify successful jobs are auto-cleaned

## Rollback Plan

If issues arise, the previous implementation can be restored from git history. The main risk is:

- **Duplicate Jobs**: If BullMQ's jobId deduplication doesn't work as expected, we may see duplicate jobs. Monitor Bull Board for duplicate task IDs.

To mitigate: The enqueuer marks tasks as RUNNING in PocketBase after successful enqueue, preventing re-polling.

