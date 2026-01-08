/**
 * Normalizer Output Types
 *
 * Output types for all normalizers that define the database entities to be created.
 */

import type { LabelType, ProcessingProvider } from '@project/shared';

/**
 * LabelEntity data ready for database insertion
 */
export interface LabelEntityData {
  WorkspaceRef: string;
  labelType: LabelType;
  canonicalName: string;
  provider: ProcessingProvider;
  processor: string;
  metadata?: Record<string, unknown>;
  entityHash: string;
}

/**
 * Keyframe data for tracks
 */
export interface KeyframeData {
  t: number; // time offset in seconds
  bbox: {
    left: number; // 0-1 normalized
    top: number; // 0-1 normalized
    right: number; // 0-1 normalized
    bottom: number; // 0-1 normalized
  };
  confidence: number; // 0-1
  attributes?: Record<string, unknown>; // Optional attributes
  landmarks?: Array<{
    type: string;
    position: { x: number; y: number; z: number };
    confidence: number;
  }>;
}

/**
 * LabelTrack data ready for database insertion
 */
export interface LabelTrackData {
  WorkspaceRef: string;
  MediaRef: string;
  TaskRef?: string;
  LabelEntityRef?: string; // Optional - will be set by step processor
  trackId: string;
  start: number; // seconds (float)
  end: number; // seconds (float)
  duration: number; // seconds (float)
  confidence: number; // 0-1
  provider: ProcessingProvider;
  processor: string;
  version: number;
  trackData: Record<string, unknown>; // Aggregated properties
  keyframes: KeyframeData[]; // Array of keyframes
  trackHash: string;
}

/**
 * LabelClip data ready for database insertion
 */
export interface LabelClipData {
  WorkspaceRef: string;
  MediaRef: string;
  TaskRef?: string;
  LabelEntityRef?: string; // Optional - will be set by step processor
  LabelTrackRef?: string;
  labelHash: string;
  labelType: LabelType;
  type: string; // Deprecated, use LabelEntityRef instead
  start: number; // seconds (float)
  end: number; // seconds (float)
  duration: number; // seconds (float)
  confidence: number; // 0-1
  version: number;
  processor: string;
  provider: ProcessingProvider;
  labelData: Record<string, unknown>; // Compact label data
}

/**
 * LabelMedia update data (partial update)
 */
export interface LabelMediaData {
  MediaRef: string;
  version?: number;
  processors?: string[]; // Array of completed processors

  // Label Detection results
  labelDetectionProcessedAt?: string;
  labelDetectionProcessor?: string;
  segmentLabelCount?: number;
  shotLabelCount?: number;
  shotCount?: number;

  // Object Tracking results
  objectTrackingProcessedAt?: string;
  objectTrackingProcessor?: string;
  objectCount?: number;
  objectTrackCount?: number;

  // Face Detection results
  faceDetectionProcessedAt?: string;
  faceDetectionProcessor?: string;
  faceCount?: number;
  faceTrackCount?: number;

  // Person Detection results
  personDetectionProcessedAt?: string;
  personDetectionProcessor?: string;
  personCount?: number;
  personTrackCount?: number;

  // Speech Transcription results
  speechTranscriptionProcessedAt?: string;
  speechTranscriptionProcessor?: string;
  transcript?: string;
  transcriptLength?: number;
  wordCount?: number;
}

/**
 * Normalizer output containing all entities to be created/updated
 */
export interface NormalizerOutput {
  labelEntities: LabelEntityData[];
  labelTracks: LabelTrackData[];
  labelClips: LabelClipData[];
  labelMediaUpdate: Partial<LabelMediaData>;
}
