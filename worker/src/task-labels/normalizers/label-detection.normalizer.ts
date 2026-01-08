import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LabelType, ProcessingProvider } from '@project/shared';
import type {
  LabelDetectionResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelClipData,
  LabelMediaData,
} from '../types';

/**
 * Label Detection Normalizer
 *
 * Transforms GCVI Label Detection API responses into database entities:
 * - LabelEntity: Unique labels (segment labels and shot labels)
 * - LabelClip: Time-bounded label occurrences and shots
 * - LabelMedia: Aggregated label counts and shot counts
 *
 * This normalizer handles:
 * - Segment labels (video-level labels)
 * - Shot labels (shot-level labels)
 * - Shot boundaries (scene changes)
 */
@Injectable()
export class LabelDetectionNormalizer {
  private readonly logger = new Logger(LabelDetectionNormalizer.name);

  /**
   * Normalize label detection response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<LabelDetectionResponse>
  ): Promise<NormalizerOutput> {
    const {
      response,
      mediaId,
      workspaceRef,
      taskRef,
      version,
      processor,
      processorVersion,
    } = input;

    this.logger.debug(
      `Normalizing label detection response for media ${mediaId}`
    );

    // Collect unique labels for LabelEntity creation
    const labelEntities: LabelEntityData[] = [];
    const labelClips: LabelClipData[] = [];
    const seenLabels = new Set<string>();

    // Process segment labels
    for (const segmentLabel of response.segmentLabels) {
      // Create LabelEntity for this label if not seen before
      const entityHash = this.generateEntityHash(
        workspaceRef,
        LabelType.OBJECT,
        segmentLabel.entity,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      );

      if (!seenLabels.has(entityHash)) {
        labelEntities.push({
          WorkspaceRef: workspaceRef,
          labelType: LabelType.OBJECT,
          canonicalName: segmentLabel.entity,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: processorVersion,
          entityHash,
          metadata: {
            confidence: segmentLabel.confidence,
          },
        });
        seenLabels.add(entityHash);
      }

      // Create LabelClip for each segment
      for (const segment of segmentLabel.segments) {
        const clipHash = this.generateClipHash(
          mediaId,
          LabelType.OBJECT,
          segmentLabel.entity,
          segment.startTime,
          segment.endTime,
          version
        );

        labelClips.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          TaskRef: taskRef,
          labelHash: clipHash,
          labelType: LabelType.OBJECT,
          type: segmentLabel.entity, // Deprecated field, kept for backward compatibility
          start: segment.startTime,
          end: segment.endTime,
          duration: segment.endTime - segment.startTime,
          confidence: segment.confidence ?? segmentLabel.confidence,
          version,
          processor: processorVersion,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          labelData: {
            entity: segmentLabel.entity,
            segmentType: 'segment',
          },
          // LabelEntityRef will be set by step processor after entity creation
          // LabelTrackRef is null for segment labels (no spatial tracking)
        });
      }
    }

    // Process shot labels
    for (const shotLabel of response.shotLabels) {
      // Create LabelEntity for this label if not seen before
      const entityHash = this.generateEntityHash(
        workspaceRef,
        LabelType.OBJECT,
        shotLabel.entity,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      );

      if (!seenLabels.has(entityHash)) {
        labelEntities.push({
          WorkspaceRef: workspaceRef,
          labelType: LabelType.OBJECT,
          canonicalName: shotLabel.entity,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: processorVersion,
          entityHash,
          metadata: {
            confidence: shotLabel.confidence,
          },
        });
        seenLabels.add(entityHash);
      }

      // Create LabelClip for each shot segment
      for (const segment of shotLabel.segments) {
        const clipHash = this.generateClipHash(
          mediaId,
          LabelType.OBJECT,
          shotLabel.entity,
          segment.startTime,
          segment.endTime,
          version
        );

        labelClips.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          TaskRef: taskRef,
          labelHash: clipHash,
          labelType: LabelType.OBJECT,
          type: shotLabel.entity, // Deprecated field
          start: segment.startTime,
          end: segment.endTime,
          duration: segment.endTime - segment.startTime,
          confidence: segment.confidence ?? shotLabel.confidence,
          version,
          processor: processorVersion,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          labelData: {
            entity: shotLabel.entity,
            segmentType: 'shot',
          },
          // LabelEntityRef will be set by step processor
          // LabelTrackRef is null for shot labels
        });
      }
    }

    // Process shots (scene changes)
    for (const shot of response.shots) {
      // Create LabelEntity for "Shot" if not seen before
      const entityHash = this.generateEntityHash(
        workspaceRef,
        LabelType.SHOT,
        'Shot',
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      );

      if (!seenLabels.has(entityHash)) {
        labelEntities.push({
          WorkspaceRef: workspaceRef,
          labelType: LabelType.SHOT,
          canonicalName: 'Shot',
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: processorVersion,
          entityHash,
          metadata: {},
        });
        seenLabels.add(entityHash);
      }

      // Create LabelClip for each shot boundary
      const clipHash = this.generateClipHash(
        mediaId,
        LabelType.SHOT,
        'Shot',
        shot.startTime,
        shot.endTime,
        version
      );

      labelClips.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        labelHash: clipHash,
        labelType: LabelType.SHOT,
        type: 'Shot', // Deprecated field
        start: shot.startTime,
        end: shot.endTime,
        duration: shot.endTime - shot.startTime,
        confidence: 1.0, // Shots don't have confidence scores
        version,
        processor: processorVersion,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        labelData: {
          entity: 'Shot',
          segmentType: 'shot_boundary',
        },
        // LabelEntityRef will be set by step processor
        // LabelTrackRef is null for shots
      });
    }

    // Create LabelMedia update with aggregated counts
    const labelMediaUpdate: Partial<LabelMediaData> = {
      labelDetectionProcessedAt: new Date().toISOString(),
      labelDetectionProcessor: processorVersion,
      segmentLabelCount: response.segmentLabels.reduce(
        (sum, label) => sum + label.segments.length,
        0
      ),
      shotLabelCount: response.shotLabels.reduce(
        (sum, label) => sum + label.segments.length,
        0
      ),
      shotCount: response.shots.length,
      // Add processor to processors array
      processors: ['label_detection'],
    };

    this.logger.debug(
      `Normalized ${labelEntities.length} entities, ${labelClips.length} clips, ${response.shots.length} shots`
    );

    return {
      labelEntities,
      labelTracks: [], // No tracks for label detection
      labelClips,
      labelMediaUpdate,
    };
  }

  /**
   * Generate entity hash for deduplication
   *
   * @param workspaceRef Workspace reference
   * @param labelType Label type
   * @param canonicalName Canonical name
   * @param provider Processing provider
   * @returns SHA-256 hash
   */
  private generateEntityHash(
    workspaceRef: string,
    labelType: LabelType,
    canonicalName: string,
    provider: ProcessingProvider
  ): string {
    const normalizedName = canonicalName.trim().toLowerCase();
    const hashInput = `${workspaceRef}:${labelType}:${normalizedName}:${provider}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generate clip hash for deduplication
   *
   * @param mediaId Media ID
   * @param labelType Label type
   * @param label Label name
   * @param start Start time
   * @param end End time
   * @param version Version
   * @returns SHA-256 hash
   */
  private generateClipHash(
    mediaId: string,
    labelType: LabelType,
    label: string,
    start: number,
    end: number,
    version: number
  ): string {
    const normalizedLabel = label.trim().toLowerCase();
    const hashInput = `${mediaId}:${labelType}:${normalizedLabel}:${start.toFixed(3)}:${end.toFixed(3)}:${version}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }
}
