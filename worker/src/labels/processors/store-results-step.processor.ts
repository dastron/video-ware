import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import type { StepJobData } from '../../queue/types/job.types';
import type {
  StoreResultsStepInput,
  StoreResultsStepOutput,
} from '../types/step-inputs';
import { ProcessingProvider } from '@project/shared';

/**
 * Processor for STORE_RESULTS step in detect_labels flow
 * Upserts label_clips to PocketBase and updates Media record with version and processor
 * Implements idempotent upsert to avoid duplicates on retry
 */
@Injectable()
export class StoreResultsStepProcessor extends BaseStepProcessor<
  StoreResultsStepInput,
  StoreResultsStepOutput
> {
  protected readonly logger = new Logger(StoreResultsStepProcessor.name);

  constructor(private readonly pocketbaseService: PocketBaseService) {
    super();
  }

  /**
   * Process storing results to PocketBase
   * Upserts label_clips and updates Media record
   */
  async process(
    input: StoreResultsStepInput,
    job: Job<StepJobData>,
  ): Promise<StoreResultsStepOutput> {
    this.logger.log(
      `Storing results for media ${input.mediaId}, version ${input.version}`,
    );

    await this.updateProgress(job, 10);

    try {
      const labelClipIds: string[] = [];
      let shotCount = 0;
      let objectCount = 0;
      let personCount = 0;
      let speechCount = 0;

      // Upsert label clips
      if (input.labelClips.length > 0) {
        this.logger.log(
          `Upserting ${input.labelClips.length} label clips for media ${input.mediaId}`,
        );

        for (let i = 0; i < input.labelClips.length; i++) {
          const labelClip = input.labelClips[i];

          try {
            // Check if label clip already exists for this (mediaId, version, provider, labelType, start, end)
            // This ensures idempotency - if we retry, we won't create duplicates
            const existingFilter = [
              `MediaRef = "${input.mediaId}"`,
              `version = ${input.version}`,
              `provider = "${input.provider}"`,
              `labelType = "${labelClip.labelType}"`,
              `start = ${labelClip.start}`,
              `end = ${labelClip.end}`,
            ].join(' && ');

            const existing =
              await this.pocketbaseService.labelClipMutator.getList(
                1,
                1,
                existingFilter,
              );

            let recordId: string;

            if (existing.items.length > 0) {
              // Update existing record
              const existingRecord = existing.items[0];
              this.logger.debug(
                `Updating existing label clip ${existingRecord.id}`,
              );

              const updated =
                await this.pocketbaseService.labelClipMutator.update(
                  existingRecord.id,
                  {
                    WorkspaceRef: input.workspaceRef,
                    MediaRef: input.mediaId,
                    TaskRef: input.taskRef,
                    labelType: labelClip.labelType,
                    start: labelClip.start,
                    end: labelClip.end,
                    duration: labelClip.duration,
                    confidence: labelClip.confidence,
                    version: input.version,
                    processor: input.processor,
                    provider: input.provider,
                    labelData: labelClip.labelData,
                  },
                );

              recordId = updated.id;
            } else {
              // Create new record
              const created =
                await this.pocketbaseService.labelClipMutator.create({
                  WorkspaceRef: input.workspaceRef,
                  MediaRef: input.mediaId,
                  TaskRef: input.taskRef,
                  labelType: labelClip.labelType,
                  start: labelClip.start,
                  end: labelClip.end,
                  duration: labelClip.duration,
                  confidence: labelClip.confidence,
                  version: input.version,
                  processor: input.processor,
                  provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
                  labelData: labelClip.labelData as unknown as {},
                });

              recordId = created.id;
            }

            labelClipIds.push(recordId);

            // Count by type
            switch (labelClip.labelType) {
              case 'shot':
                shotCount++;
                break;
              case 'object':
                objectCount++;
                break;
              case 'person':
                personCount++;
                break;
              case 'speech':
                speechCount++;
                break;
            }
          } catch (error) {
            const errorMessage =
              error instanceof Error ? error.message : String(error);
            this.logger.error(
              `Failed to upsert label clip ${i}: ${errorMessage}`,
            );
            // Continue with other clips even if one fails
          }

          // Update progress periodically
          if (i % 10 === 0) {
            const progress =
              10 + Math.floor((i / input.labelClips.length) * 70);
            await this.updateProgress(job, progress);
          }
        }

        this.logger.log(
          `Upserted ${labelClipIds.length} label clips for media ${input.mediaId}`,
        );
      }

      await this.updateProgress(job, 80);

      // Update Media record with version and processor
      this.logger.log(
        `Updating Media ${input.mediaId} with version ${input.version} and processor ${input.processor}`,
      );

      await this.pocketbaseService.mediaMutator.update(input.mediaId, {
        version: input.version,
        processor: input.processor,
      });

      await this.updateProgress(job, 90);

      this.logger.log(
        `Store results completed for media ${input.mediaId}: ${labelClipIds.length} label clips stored`,
      );

      await this.updateProgress(job, 100);

      return {
        labelClipIds,
        summary: {
          shotCount,
          objectCount,
          personCount,
          speechCount,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Store results failed for media ${input.mediaId}: ${errorMessage}`,
      );
      throw new Error(`Failed to store results: ${errorMessage}`);
    }
  }
}
