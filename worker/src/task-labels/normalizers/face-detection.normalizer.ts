import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LabelType, ProcessingProvider } from '@project/shared';
import type {
  FaceDetectionResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelFaceData,
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
 * - LabelFace: Specific face instance data
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
      processor: _processor,
      processorVersion,
    } = input;

    this.logger.debug(
      `Normalizing face detection response for media ${mediaId}: ${response.faces.length} faces`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelFaces: LabelFaceData[] = [];
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
      if (!face.frames || face.frames.length === 0) {
        this.logger.debug(`Skipping face with no frames for media ${mediaId}`);
        continue;
      }

      let trackId = face.trackId;

      // Handle empty trackId by generating a deterministic one based on first frame
      if (!trackId || trackId.trim().length === 0) {
        const firstFrame = face.frames[0];
        trackId = this.generateDeterministicTrackId(
          mediaId,
          firstFrame.timeOffset,
          firstFrame.boundingBox
        );
        this.logger.debug(
          `Generated deterministic trackId ${trackId} for face`
        );
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
        trackId,
        version,
        processorVersion
      );

      // Create LabelFace
      const faceHash = this.generateFaceHash(
        mediaId,
        trackId,
        version,
        processorVersion
      );
      labelFaces.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        trackId: trackId,
        faceId: undefined, // Not provided in raw data usually
        startTime: start,
        endTime: end,
        duration,
        avgConfidence,
        headwearLikelihood: attributesSummary.headwear as string,
        // Other likelihoods not extracted in this pass but could be if available in raw data
        faceHash,
      });

      // Create LabelTrack with keyframes and attributes
      labelTracks.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        trackId: trackId,
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
            trackId: trackId,
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

    // Validate and filter out invalid tracks and clips
    const validTracks = labelTracks.filter((track) =>
      this.isValidLabelTrack(track)
    );
    const validClips = labelClips.filter((clip) => this.isValidLabelClip(clip));

    if (validTracks.length < labelTracks.length) {
      this.logger.warn(
        `Filtered out ${labelTracks.length - validTracks.length} invalid label tracks`
      );
    }

    if (validClips.length < labelClips.length) {
      this.logger.warn(
        `Filtered out ${labelClips.length - validClips.length} invalid label clips`
      );
    }

    // Update counts based on valid data
    labelMediaUpdate.faceCount = validClips.length;
    labelMediaUpdate.faceTrackCount = validTracks.length;

    this.logger.debug(
      `Normalized ${labelEntities.length} entities, ${validTracks.length} tracks, ${validClips.length} clips`
    );

    return {
      labelEntities,
      labelFaces,
      labelTracks: validTracks,
      labelClips: validClips,
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
   * Generate face hash for deduplication
   */
  private generateFaceHash(
    mediaId: string,
    trackId: string,
    version: number,
    processor: string
  ): string {
    const hashInput = `${mediaId}:${trackId}:${version}:${processor}:face`;
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

  /**
   * Generate deterministic track ID
   */
  private generateDeterministicTrackId(
    mediaId: string,
    startTime: number,
    bbox: { left?: number; top?: number; right?: number; bottom?: number }
  ): string {
    const hashInput = `${mediaId}:${startTime}:${bbox.left}:${bbox.top}:${bbox.right}:${bbox.bottom}`;
    return createHash('sha256')
      .update(hashInput)
      .digest('hex')
      .substring(0, 16);
  }

  /**
   * Check if a label track is valid before insertion
   *
   * @param track The track to validate
   * @returns True if the track is valid
   */
  private isValidLabelTrack(track: LabelTrackData): boolean {
    // Check required fields
    if (!track.trackHash || track.trackHash.trim().length === 0) {
      return false;
    }
    if (!track.WorkspaceRef || track.WorkspaceRef.trim().length === 0) {
      return false;
    }
    if (!track.MediaRef || track.MediaRef.trim().length === 0) {
      return false;
    }
    if (!track.trackId || track.trackId.trim().length === 0) {
      return false;
    }

    // Check time values
    if (
      typeof track.start !== 'number' ||
      track.start < 0 ||
      !Number.isFinite(track.start)
    ) {
      return false;
    }
    if (
      typeof track.end !== 'number' ||
      track.end < 0 ||
      !Number.isFinite(track.end)
    ) {
      return false;
    }

    // End must be greater than start
    if (track.end <= track.start) {
      return false;
    }

    // Check duration (should be positive and match end - start)
    if (
      typeof track.duration !== 'number' ||
      track.duration < 0 ||
      !Number.isFinite(track.duration)
    ) {
      return false;
    }

    // Check confidence (must be between 0 and 1)
    if (
      typeof track.confidence !== 'number' ||
      track.confidence < 0 ||
      track.confidence > 1 ||
      !Number.isFinite(track.confidence)
    ) {
      return false;
    }

    // Check keyframes (must be an array)
    if (!Array.isArray(track.keyframes)) {
      return false;
    }

    // Validate each keyframe
    for (const keyframe of track.keyframes) {
      if (typeof keyframe !== 'object' || keyframe === null) {
        return false;
      }
      const kf = keyframe as {
        t?: number;
        bbox?: { left?: number; top?: number; right?: number; bottom?: number };
        confidence?: number;
      };
      if (typeof kf.t !== 'number' || kf.t < 0 || !Number.isFinite(kf.t)) {
        return false;
      }
      if (!kf.bbox || typeof kf.bbox !== 'object') {
        return false;
      }
      if (
        typeof kf.confidence !== 'number' ||
        kf.confidence < 0 ||
        kf.confidence > 1 ||
        !Number.isFinite(kf.confidence)
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if a label clip is valid before insertion
   *
   * @param clip The clip to validate
   * @returns True if the clip is valid
   */
  private isValidLabelClip(clip: LabelClipData): boolean {
    // Check required fields
    if (!clip.labelHash || clip.labelHash.trim().length === 0) {
      return false;
    }
    if (!clip.WorkspaceRef || clip.WorkspaceRef.trim().length === 0) {
      return false;
    }
    if (!clip.MediaRef || clip.MediaRef.trim().length === 0) {
      return false;
    }

    // Check time values
    if (
      typeof clip.start !== 'number' ||
      clip.start < 0 ||
      !Number.isFinite(clip.start)
    ) {
      return false;
    }
    if (
      typeof clip.end !== 'number' ||
      clip.end < 0 ||
      !Number.isFinite(clip.end)
    ) {
      return false;
    }

    // End must be greater than start
    if (clip.end <= clip.start) {
      return false;
    }

    // Check duration (should be positive and match end - start)
    // Must be at least MIN_CLIP_DURATION seconds
    if (
      typeof clip.duration !== 'number' ||
      clip.duration < this.MIN_CLIP_DURATION ||
      !Number.isFinite(clip.duration)
    ) {
      return false;
    }

    // Check confidence (must be between 0 and 1, and at least MIN_CLIP_CONFIDENCE)
    if (
      typeof clip.confidence !== 'number' ||
      clip.confidence < this.MIN_CLIP_CONFIDENCE ||
      clip.confidence > 1 ||
      !Number.isFinite(clip.confidence)
    ) {
      return false;
    }

    // Check that trackId is not empty (if present in labelData)
    if (clip.labelData && typeof clip.labelData === 'object') {
      const labelData = clip.labelData as Record<string, unknown>;
      const trackId = labelData.trackId;
      if (
        trackId !== undefined &&
        (!trackId || String(trackId).trim().length === 0)
      ) {
        return false;
      }
    }

    return true;
  }
}
