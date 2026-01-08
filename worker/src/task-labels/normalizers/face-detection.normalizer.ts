import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LabelType, ProcessingProvider } from '@project/shared';
import type {
  FaceDetectionResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelTrackData,
  LabelClipData,
  LabelMediaData,
  KeyframeData,
} from '../types';

/**
 * Face Detection Normalizer
 *
 * Transforms GCVI Face Detection API responses into database entities:
 * - LabelEntity: Single "Face" entity (or per-person if identity available)
 * - LabelTrack: Tracked faces with keyframe data (bounding boxes and attributes)
 * - LabelClip: Significant face appearances
 * - LabelMedia: Aggregated face counts
 *
 * This normalizer handles:
 * - Face detection and tracking
 * - Keyframe extraction with bounding boxes
 * - Face attributes (headwear, glasses, looking at camera)
 */
@Injectable()
export class FaceDetectionNormalizer {
  private readonly logger = new Logger(FaceDetectionNormalizer.name);

  // Configuration for clip filtering
  private readonly MIN_CLIP_DURATION = 0.5; // seconds
  private readonly MIN_CLIP_CONFIDENCE = 0.5;

  /**
   * Normalize face detection response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<FaceDetectionResponse>
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
      `Normalizing face detection response for media ${mediaId}: ${response.faces.length} faces`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelTracks: LabelTrackData[] = [];
    const labelClips: LabelClipData[] = [];
    const seenLabels = new Set<string>();

    // Create single "Face" entity (we don't have identity information)
    const entityHash = this.generateEntityHash(
      workspaceRef,
      LabelType.PERSON,
      'Face',
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE
    );

    if (!seenLabels.has(entityHash)) {
      labelEntities.push({
        WorkspaceRef: workspaceRef,
        labelType: LabelType.PERSON,
        canonicalName: 'Face',
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        entityHash,
        metadata: {
          type: 'face_detection',
        },
      });
      seenLabels.add(entityHash);
    }

    // Process each tracked face
    for (const face of response.faces) {
      // Skip faces with invalid trackId or no frames
      if (!face.trackId || face.trackId.trim().length === 0) {
        this.logger.debug(
          `Skipping face with empty trackId for media ${mediaId}`
        );
        continue;
      }

      if (!face.frames || face.frames.length === 0) {
        this.logger.debug(
          `Skipping face with no frames (trackId: ${face.trackId}) for media ${mediaId}`
        );
        continue;
      }

      // Extract keyframes from frames with attributes
      const keyframes: KeyframeData[] = face.frames.map((frame) => ({
        t: frame.timeOffset,
        bbox: {
          left: frame.boundingBox.left,
          top: frame.boundingBox.top,
          right: frame.boundingBox.right,
          bottom: frame.boundingBox.bottom,
        },
        confidence: frame.confidence,
        attributes: frame.attributes
          ? {
              headwear: frame.attributes.headwear,
              glasses: frame.attributes.glasses,
              lookingAtCamera: frame.attributes.lookingAtCamera,
            }
          : undefined,
      }));

      // Calculate track start, end, and duration
      const start = face.frames[0]?.timeOffset ?? 0;
      const end = face.frames[face.frames.length - 1]?.timeOffset ?? 0;
      const duration = end - start;

      // Calculate average confidence
      const avgConfidence =
        face.frames.reduce((sum, frame) => sum + frame.confidence, 0) /
        face.frames.length;

      // Aggregate attributes across frames
      const attributesSummary = this.aggregateAttributes(face.frames);

      // Generate track hash
      const trackHash = this.generateTrackHash(
        mediaId,
        face.trackId,
        version,
        processorVersion
      );

      // Create LabelTrack with keyframes and attributes
      labelTracks.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        trackId: face.trackId,
        start,
        end,
        duration,
        confidence: avgConfidence,
        provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
        processor: processorVersion,
        version,
        trackData: {
          entity: 'Face',
          frameCount: face.frames.length,
          maxConfidence: Math.max(...face.frames.map((f) => f.confidence)),
          minConfidence: Math.min(...face.frames.map((f) => f.confidence)),
          attributes: attributesSummary,
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
          LabelType.PERSON
        );

        labelClips.push({
          WorkspaceRef: workspaceRef,
          MediaRef: mediaId,
          TaskRef: taskRef,
          labelHash: clipHash,
          labelType: LabelType.PERSON,
          type: 'Face', // Deprecated field
          start,
          end,
          duration,
          confidence: avgConfidence,
          version,
          processor: processorVersion,
          provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
          labelData: {
            entity: 'Face',
            trackId: face.trackId,
            frameCount: face.frames.length,
            attributes: attributesSummary,
          },
          // LabelEntityRef and LabelTrackRef will be set by step processor
        });
      }
    }

    // Create LabelMedia update with aggregated counts
    const labelMediaUpdate: Partial<LabelMediaData> = {
      faceDetectionProcessedAt: new Date().toISOString(),
      faceDetectionProcessor: processorVersion,
      faceCount: labelClips.length, // Count of significant face appearances
      faceTrackCount: labelTracks.length, // Total number of face tracks
      // Add processor to processors array
      processors: ['face_detection'],
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
   * Aggregate face attributes across all frames
   *
   * Returns the most common attribute values
   */
  private aggregateAttributes(
    frames: Array<{
      attributes?: {
        headwear?: string;
        glasses?: string;
        lookingAtCamera?: boolean;
      };
    }>
  ): Record<string, unknown> {
    const headwearCounts = new Map<string, number>();
    const glassesCounts = new Map<string, number>();
    let lookingAtCameraCount = 0;
    let totalFrames = 0;

    for (const frame of frames) {
      if (frame.attributes) {
        totalFrames++;

        if (frame.attributes.headwear) {
          headwearCounts.set(
            frame.attributes.headwear,
            (headwearCounts.get(frame.attributes.headwear) ?? 0) + 1
          );
        }

        if (frame.attributes.glasses) {
          glassesCounts.set(
            frame.attributes.glasses,
            (glassesCounts.get(frame.attributes.glasses) ?? 0) + 1
          );
        }

        if (frame.attributes.lookingAtCamera) {
          lookingAtCameraCount++;
        }
      }
    }

    // Find most common values
    const mostCommonHeadwear = this.getMostCommon(headwearCounts);
    const mostCommonGlasses = this.getMostCommon(glassesCounts);
    const lookingAtCameraPercentage =
      totalFrames > 0 ? lookingAtCameraCount / totalFrames : 0;

    return {
      headwear: mostCommonHeadwear,
      glasses: mostCommonGlasses,
      lookingAtCameraPercentage,
    };
  }

  /**
   * Get the most common value from a count map
   */
  private getMostCommon(counts: Map<string, number>): string | undefined {
    let maxCount = 0;
    let mostCommon: string | undefined;

    for (const [value, count] of counts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        mostCommon = value;
      }
    }

    return mostCommon;
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
