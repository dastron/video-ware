import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { createHash } from 'crypto';
import { BaseStepProcessor } from '../../queue/processors/base-step.processor';
import { LabelNormalizerService } from '../services/label-normalizer.service';
import { LabelCacheService } from '../services/label-cache.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { ProcessingProvider } from '@project/shared';
import type { StepJobData } from '../../queue/types/job.types';
import type { VideoIntelligenceResponse } from '../executors/interfaces';

/**
 * Step input/output types
 */
export interface ProcessVideoIntelligenceLabelsStepInput {
  type: 'process_video_intelligence_labels';
  mediaId: string;
  workspaceRef: string;
  taskRef: string;
  version: number;
  processor: string;
}

export interface ProcessVideoIntelligenceLabelsStepOutput {
  labelClipsCreated: number;
  summary: {
    shotCount: number;
    objectCount: number;
    personCount: number;
  };
}

/**
 * Processor for PROCESS_VIDEO_INTELLIGENCE_LABELS step
 * Reads video intelligence cache, normalizes to label_clips, and writes to PocketBase
 */
@Injectable()
export class ProcessVideoIntelligenceLabelsStepProcessor extends BaseStepProcessor<
  ProcessVideoIntelligenceLabelsStepInput,
  ProcessVideoIntelligenceLabelsStepOutput
> {
  protected readonly logger = new Logger(
    ProcessVideoIntelligenceLabelsStepProcessor.name
  );

  constructor(
    private readonly labelNormalizerService: LabelNormalizerService,
    private readonly labelCacheService: LabelCacheService,
    private readonly pocketbaseService: PocketBaseService
  ) {
    super();
  }

  /**
   * Process video intelligence labels
   * Reads from cache, normalizes, and writes to database
   */
  async process(
    input: ProcessVideoIntelligenceLabelsStepInput,
    job: Job<StepJobData>
  ): Promise<ProcessVideoIntelligenceLabelsStepOutput> {
    this.logger.log(
      `Processing video intelligence labels for media ${input.mediaId}, version ${input.version}`
    );

    try {
      // Read video intelligence results from cache
      const cache = await this.labelCacheService.getCachedLabels(
        input.mediaId,
        input.version,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      );

      if (!cache) {
        throw new Error(
          `No video intelligence cache found for media ${input.mediaId}, version ${input.version}`
        );
      }

      // Normalize to label clips
      this.logger.log(
        `Normalizing video intelligence results for media ${input.mediaId}`
      );

      const normalizedResult =
        await this.labelNormalizerService.normalizeVideoIntelligence({
          response: cache.response as VideoIntelligenceResponse,
          mediaId: input.mediaId,
          version: input.version,
          rawJsonPath: `labels/${input.mediaId}/v${input.version}/google_video_intelligence.json`,
          processor: cache.metadata.processor,
        });

      this.logger.log(
        `Normalized ${normalizedResult.labelClips.length} video intelligence labels`
      );

      // Filter label clips based on quality criteria
      const filteredClips = this.filterLabelClips(
        normalizedResult.labelClips,
        input.mediaId,
        input.workspaceRef
      );

      this.logger.log(
        `Filtered to ${filteredClips.length} label clips (removed ${normalizedResult.labelClips.length - filteredClips.length} low-quality clips)`
      );

      // Write to database
      const labelClipIds: string[] = [];
      let skippedCount = 0;

      for (const labelClip of filteredClips) {
        try {
          // Generate deterministic hash for this label clip
          const labelHash = this.generateLabelHash(
            input.mediaId,
            input.workspaceRef,
            labelClip.labelType,
            labelClip.start,
            labelClip.end
          );

          // Check if label clip already exists using labelHash (unique index)
          const existingFilter = `labelHash = "${labelHash}"`;

          const existing =
            await this.pocketbaseService.labelClipMutator.getList(
              1,
              1,
              existingFilter
            );

          let recordId: string;

          if (existing.items.length > 0) {
            const existingRecord = existing.items[0];

            // Check if data has changed before updating
            if (this.hasLabelClipChanged(existingRecord, labelClip, input)) {
              this.logger.debug(
                `Updating existing label clip ${existingRecord.id}`
              );

              const updated =
                await this.pocketbaseService.labelClipMutator.update(
                  existingRecord.id,
                  {
                    WorkspaceRef: input.workspaceRef,
                    MediaRef: input.mediaId,
                    TaskRef: input.taskRef,
                    labelType: labelClip.labelType,
                    type:
                      labelClip.labelData.entityDescription ||
                      labelClip.labelType,
                    labelHash,
                    start: labelClip.start,
                    end: labelClip.end,
                    duration: labelClip.duration,
                    confidence: labelClip.confidence,
                    version: input.version,
                    processor: input.processor,
                    provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
                    labelData: labelClip.labelData,
                  }
                );

              recordId = updated.id;
            } else {
              // No changes, skip update
              this.logger.debug(
                `Skipping unchanged label clip ${existingRecord.id}`
              );
              recordId = existingRecord.id;
              skippedCount++;
            }
          } else {
            // Create new record
            const created =
              await this.pocketbaseService.labelClipMutator.create({
                WorkspaceRef: input.workspaceRef,
                MediaRef: input.mediaId,
                TaskRef: input.taskRef,
                labelType: labelClip.labelType,
                type:
                  labelClip.labelData.entityDescription || labelClip.labelType,
                labelHash,
                start: labelClip.start,
                end: labelClip.end,
                duration: labelClip.duration,
                confidence: labelClip.confidence,
                version: input.version,
                processor: input.processor,
                provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
                labelData: labelClip.labelData as any,
              });

            recordId = created.id;
          }

          labelClipIds.push(recordId);
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          this.logger.error(`Failed to upsert label clip: ${errorMessage}`);
          // Continue with other clips
        }
      }

      this.logger.log(
        `Stored ${labelClipIds.length} video intelligence label clips for media ${input.mediaId} (${skippedCount} unchanged)`
      );

      return {
        labelClipsCreated: labelClipIds.length,
        summary: normalizedResult.summary,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to process video intelligence labels for media ${input.mediaId}: ${errorMessage}`
      );
      throw new Error(
        `Video intelligence label processing failed: ${errorMessage}`
      );
    }
  }

  /**
   * Filter label clips based on quality criteria
   * Removes duplicates, short clips, and low-confidence clips
   */
  private filterLabelClips(
    clips: any[],
    mediaId: string,
    workspaceRef: string
  ): any[] {
    const MIN_DURATION = 5; // seconds
    const MIN_CONFIDENCE = 0.7; // 70%

    // Track seen hashes to remove duplicates
    const seenHashes = new Set<string>();
    const filtered: any[] = [];

    let removedDuplicates = 0;
    let removedShort = 0;
    let removedLowConfidence = 0;

    for (const clip of clips) {
      // Generate hash for this clip
      const hash = this.generateLabelHash(
        mediaId,
        workspaceRef,
        clip.labelType,
        clip.start,
        clip.end
      );

      // Check for duplicates
      if (seenHashes.has(hash)) {
        removedDuplicates++;
        continue;
      }

      // Check minimum duration
      if (clip.duration < MIN_DURATION) {
        removedShort++;
        continue;
      }

      // Check minimum confidence
      if (clip.confidence < MIN_CONFIDENCE) {
        removedLowConfidence++;
        continue;
      }

      // Passed all filters
      seenHashes.add(hash);
      filtered.push(clip);
    }

    if (removedDuplicates > 0 || removedShort > 0 || removedLowConfidence > 0) {
      this.logger.log(
        `Filtering removed: ${removedDuplicates} duplicates, ${removedShort} short clips (<${MIN_DURATION}s), ${removedLowConfidence} low confidence (<${MIN_CONFIDENCE * 100}%)`
      );
    }

    return filtered;
  }

  /**
   * Generate deterministic hash for label clip identification
   * Based on: mediaRef, workspaceRef, labelType, and whole second start/end times
   */
  private generateLabelHash(
    mediaId: string,
    workspaceRef: string,
    labelType: string,
    start: number,
    end: number
  ): string {
    // Round to whole seconds for consistency
    const startSecond = Math.floor(start);
    const endSecond = Math.floor(end);

    // Create deterministic string
    const hashInput = `${workspaceRef}:${mediaId}:${labelType}:${startSecond}:${endSecond}`;

    // Generate SHA-256 hash
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Check if a label clip has changed compared to existing record
   * Compares only the most important fields to avoid unnecessary database writes
   */
  private hasLabelClipChanged(
    existing: any,
    newClip: any,
    input: ProcessVideoIntelligenceLabelsStepInput
  ): boolean {
    // Only compare the fields that would actually change
    const typeValue = newClip.labelData.entityDescription || newClip.labelType;

    // Compare core fields with loose equality to handle type coercion
    if (existing.type !== typeValue) {
      this.logger.debug(`Type changed: "${existing.type}" -> "${typeValue}"`);
      return true;
    }

    if (existing.confidence !== newClip.confidence) {
      this.logger.debug(
        `Confidence changed: ${existing.confidence} -> ${newClip.confidence}`
      );
      return true;
    }

    if (existing.processor !== input.processor) {
      this.logger.debug(
        `Processor changed: "${existing.processor}" -> "${input.processor}"`
      );
      return true;
    }

    // If we get here, nothing important has changed
    return false;
  }
}
