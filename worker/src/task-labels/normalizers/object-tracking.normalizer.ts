import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LabelType, ProcessingProvider } from '@project/shared';
import type {
  ObjectTrackingResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelTrackData,
  LabelClipData,
  LabelMediaData,
  KeyframeData,
} from '../types';

/**
 * Object Tracking Normalizer
 *
 * Transforms GCVI Object Tracking API responses into database entities:
 * - LabelEntity: Unique object types (e.g., "Car", "Person", "Dog")
 * - LabelTrack: Tracked objects with keyframe data (bounding boxes over time)
 * - LabelClip: Significant object appearances (filtered by duration/confidence)
 * - LabelMedia: Aggregated object counts
 *
 * This normalizer handles:
 * - Object detection and tracking
 * - Keyframe extraction with bounding boxes
 * - Track-level confidence aggregation
 */
@Injectable()
export class ObjectTrackingNormalizer {
  private readonly logger = new Logger(ObjectTrackingNormalizer.name);

  // Configuration for clip filtering
  private readonly MIN_CLIP_DURATION = 0.5; // seconds
  private readonly MIN_CLIP_CONFIDENCE = 0.3;

  /**
   * Normalize object tracking response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<ObjectTrackingResponse>
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
      `Normalizing object tracking response for media ${mediaId}: ${response.objects.length} objects`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelTracks: LabelTrackData[] = [];
    const labelClips: LabelClipData[] = [];
    const seenLabels = new Set<string>();

    // Process each tracked object
    for (const obj of response.objects) {
      // Create LabelEntity for this object type if not seen before
      const entityHash = this.generateEntityHash(
        workspaceRef,
        LabelType.OBJECT,
        obj.entity,
        ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
      );

      if (!seenLabels.has(entityHash)) {
        labelEntities.push({
          WorkspaceRef: workspaceRef,
          labelType: LabelType.OBJECT,
          canonicalName: obj.entity,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          processor: processorVersion,
          entityHash,
          metadata: {
            trackingConfidence: obj.confidence,
          },
        });
        seenLabels.add(entityHash);
      }

      // Extract keyframes from frames
      const keyframes: KeyframeData[] = obj.frames.map((frame) => ({
        t: frame.timeOffset,
        bbox: {
          left: frame.boundingBox.left,
          top: frame.boundingBox.top,
          right: frame.boundingBox.right,
          bottom: frame.boundingBox.bottom,
        },
        confidence: frame.confidence,
      }));

      // Calculate track start, end, and duration
      const start = obj.frames[0]?.timeOffset ?? 0;
      const end = obj.frames[obj.frames.length - 1]?.timeOffset ?? 0;
      const duration = end - start;

      // Calculate average confidence
      const avgConfidence =
        obj.frames.reduce((sum, frame) => sum + frame.confidence, 0) /
        obj.frames.length;

      // Generate track hash
      const trackHash = this.generateTrackHash(
        mediaId,
        obj.trackId,
        version,
        processorVersion
      );

      // Create LabelTrack with keyframes
      labelTracks.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        trackId: obj.trackId,
        start,
        end,
        duration,
        confidence: avgConfidence,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        version,
        trackData: {
          entity: obj.entity,
          frameCount: obj.frames.length,
          maxConfidence: Math.max(...obj.frames.map((f) => f.confidence)),
          minConfidence: Math.min(...obj.frames.map((f) => f.confidence)),
        },
        keyframes,
        trackHash,
        // LabelEntityRef will be set by step processor
      });

      // Create LabelClip if track meets minimum criteria
      if (
        duration >= this.MIN_CLIP_DURATION &&
        avgConfidence >= this.MIN_CLIP_CONFIDENCE
      ) {
        const clipHash = this.generateClipHash(
          mediaId,
          start,
          end,
          LabelType.OBJECT
        );

        labelClips.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          TaskRef: taskRef,
          labelHash: clipHash,
          labelType: LabelType.OBJECT,
          type: obj.entity, // Deprecated field
          start,
          end,
          duration,
          confidence: avgConfidence,
          version,
          processor: processorVersion,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          labelData: {
            entity: obj.entity,
            trackId: obj.trackId,
            frameCount: obj.frames.length,
          },
          // LabelEntityRef and LabelTrackRef will be set by step processor
        });
      }
    }

    // Create LabelMedia update with aggregated counts
    const labelMediaUpdate: Partial<LabelMediaData> = {
      objectTrackingProcessedAt: new Date().toISOString(),
      objectTrackingProcessor: processorVersion,
      objectCount: labelClips.length, // Count of significant object appearances
      objectTrackCount: labelTracks.length, // Total number of tracks
      // Add processor to processors array
      processors: ['object_tracking'],
    };

    this.logger.debug(
      `Normalized ${labelEntities.length} entities, ${labelTracks.length} tracks, ${labelClips.length} clips`
    );

    return {
      labelEntities,
      labelTracks,
      labelClips,
      labelMediaUpdate,
    };
  }

  /**
   * Generate entity hash for deduplication
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
   * Generate track hash for deduplication
   */
  private generateTrackHash(
    mediaId: string,
    trackId: string,
    version: number,
    processor: string
  ): string {
    const hashInput = `${mediaId}:${trackId}:${version}:${processor}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generate clip hash for deduplication
   *
   * Hash format: mediaId:start:end:labelType
   * This ensures unique clips based on media, time range, and label type
   *
   * @param mediaId Media ID
   * @param start Start time
   * @param end End time
   * @param labelType Label type
   * @returns SHA-256 hash
   */
  private generateClipHash(
    mediaId: string,
    start: number,
    end: number,
    labelType: LabelType
  ): string {
    const hashInput = `${mediaId}:${start.toFixed(3)}:${end.toFixed(3)}:${labelType}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }
}
