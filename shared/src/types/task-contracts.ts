import type {
  ProcessingProvider,
  RecommendationStrategy,
  RecommendationTargetMode,
  LabelType,
} from '../enums.js';

// ============================================================================
// Task Payload and Result Contracts
// ============================================================================

/**
 * Configuration for sprite sheet generation
 */
export interface SpriteConfig {
  /** Frames per second to sample (e.g., 1 for one frame per second) */
  fps: number;
  /** Number of columns in the sprite sheet */
  cols: number;
  /** Number of rows in the sprite sheet */
  rows: number;
  /** Width of each tile in pixels */
  tileWidth: number;
  /** Height of each tile in pixels */
  tileHeight: number;
}

/**
 * Configuration for thumbnail generation
 */
export interface ThumbnailConfig {
  /** Timestamp in seconds or 'midpoint' for middle of video */
  timestamp: number | 'midpoint';
  /** Width of thumbnail in pixels */
  width: number;
  /** Height of thumbnail in pixels */
  height: number;
}

/**
 * Configuration for video transcoding (optional proxy generation)
 */
export interface TranscodeConfig {
  /** Whether transcoding is enabled */
  enabled: boolean;
  /** Video codec to use */
  codec: 'h264' | 'h265' | 'vp9';
  /** Target resolution */
  resolution: '720p' | '1080p' | 'original';
  /** Target bitrate in bits per second (optional) */
  bitrate?: number;
}

/**
 * Payload for process_upload task
 * Contains all configuration needed to process an uploaded media file
 */
export interface ProcessUploadPayload {
  /** ID of the Upload record being processed */
  uploadId: string;
  /** Processing provider to use (FFmpeg, Google Cloud, etc.) */
  provider?: ProcessingProvider;
  /** Configuration for sprite sheet generation */
  sprite?: SpriteConfig;
  /** Configuration for thumbnail generation */
  thumbnail?: ThumbnailConfig;
  /** Optional configuration for transcoding/proxy generation */
  transcode?: TranscodeConfig;
}

/**
 * Output from media probing (ffprobe or equivalent)
 */
/**
 * Output from media probing (ffprobe or equivalent)
 */
export interface ProbeOutput {
  /** Duration in seconds */
  duration: number;
  /** Video width in pixels */
  width: number;
  /** Video height in pixels */
  height: number;
  /** Video codec (e.g., 'h264', 'vp9') */
  codec: string;
  /** Frames per second */
  fps: number;
  /** Bitrate in bits per second (optional) */
  bitrate?: number;
  /** Container format name */
  format?: string;
  /** File size in bytes */
  size?: number;
  /** Media date from metadata or file system (optional) */
  mediaDate?: Date;
  /** Video stream details */
  video?: {
    codec: string;
    profile?: string;
    width: number;
    height: number;
    aspectRatio?: string;
    pixFmt?: string;
    level?: string;
    colorSpace?: string;
  };
  /** Audio stream details (if present) */
  audio?: {
    codec: string;
    channels: number;
    sampleRate: number;
    bitrate?: number;
  };
}

/**
 * Configuration for label/object detection
 */
export interface DetectLabelsConfig {
  /** Confidence threshold for detection (0.0 to 1.0) */
  confidenceThreshold?: number;
  /** Whether to detect objects (bounding boxes) */
  detectObjects?: boolean;
  /** Whether to detect labels (shot/segment level) */
  detectLabels?: boolean;
}

/**
 * Payload for detect_labels task
 */
export interface DetectLabelsPayload {
  /** ID of the Media record to analyze */
  mediaId: string;
  /** Reference to the file to analyze */
  fileRef: string;
  /** Processing provider to use */
  provider: ProcessingProvider;
  /** Configuration for detection */
  config: DetectLabelsConfig;
}

/**
 * Result from detect_labels task
 */
export interface DetectLabelsResult {
  /** ID of the JSON file containing detailed labels (if saved to GCS/S3) */
  labelsFileId?: string;
  /** Summary of detected labels/objects */
  summary: {
    labelCount: number;
    objectCount: number;
  };
  /** Version identifier of the processor */
  processorVersion: string;
}

/**
 * Result from process_upload task
 * Contains references to all generated assets and metadata
 */
export interface ProcessUploadResult {
  /** ID of the created Media record */
  mediaId: string;
  /** ID of the thumbnail File record */
  thumbnailFileId?: string;
  /** ID of the sprite sheet File record */
  spriteFileId?: string;
  /** ID of the proxy/transcoded File record (if transcoding was enabled) */
  proxyFileId?: string;
  /** Version identifier of the processor that executed the task (e.g., "ffmpeg:7.0.1") */
  processorVersion?: string;
  /** Metadata extracted from the media file */
  probeOutput?: ProbeOutput;
}

/**
 * Configuration for timeline rendering output
 */
export interface RenderTimelineConfig {
  /** Output codec */
  codec: string;
  /** Output container format */
  format: string;
  /** Output resolution (e.g., '1920x1080') */
  resolution: string;
}

/**
 * Payload for render_timeline task
 */
export interface RenderTimelinePayload {
  /** ID of the Timeline record */
  timelineId: string;
  /** Version of the timeline */
  version: number;
  /** The edit list defining the timeline composition */
  // We use any here to avoid circular dependency with video-ware.ts, or we can redefine the shape
  // Given the user payload:
  // { endTimeOffset: { nanos, seconds }, inputs: string[], key: string, startTimeOffset: { nanos, seconds } }[]
  editList: Array<{
    key: string;
    inputs: string[];
    startTimeOffset: { seconds: number; nanos: number };
    endTimeOffset: { seconds: number; nanos: number };
  }>;
  /** Output settings */
  outputSettings: RenderTimelineConfig;
  /** Processing provider */
  provider?: ProcessingProvider;
}

/**
 * Result from render_timeline task
 */
export interface RenderTimelineResult {
  /** ID of the created Media record for the rendered timeline */
  mediaId: string;
  /** ID of the generated File record */
  fileId: string;
  /** Version of the processor used */
  processorVersion: string;
}

// ============================================================================
// Recommendation Task Payloads and Results
// ============================================================================

/**
 * Payload for generate_timeline_recommendations task
 */
export interface GenerateTimelineRecommendationsPayload {
  /** ID of the Workspace */
  workspaceId: string;
  /** ID of the Timeline record */
  timelineId: string;
  /** Optional ID of the seed clip to use for recommendations */
  seedClipId?: string;
  /** Target mode: append or replace existing recommendations */
  targetMode: RecommendationTargetMode;
  /** Array of recommendation strategies to use */
  strategies: RecommendationStrategy[];
  /** Optional weights for each strategy */
  strategyWeights?: Record<RecommendationStrategy, number>;
  /** Optional search parameters to filter recommendations */
  searchParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
    timeWindow?: number; // seconds for temporal_nearby
  };
  /** Maximum number of results to generate (default: 20) */
  maxResults?: number;
}

/**
 * Result from generate_timeline_recommendations task
 */
export interface GenerateTimelineRecommendationsResult {
  /** Number of recommendations generated */
  generated: number;
  /** Number of recommendations pruned (old ones removed) */
  pruned: number;
  /** Query hash for deduplication */
  queryHash: string;
}

/**
 * Payload for generate_media_recommendations task
 */
export interface GenerateMediaRecommendationsPayload {
  /** ID of the Workspace */
  workspaceId: string;
  /** ID of the Media record */
  mediaId: string;
  /** Array of recommendation strategies to use */
  strategies: RecommendationStrategy[];
  /** Optional weights for each strategy */
  strategyWeights?: Record<RecommendationStrategy, number>;
  /** Optional filter parameters */
  filterParams?: {
    labelTypes?: LabelType[];
    minConfidence?: number;
    durationRange?: { min: number; max: number };
  };
  /** Maximum number of results to generate (default: 20) */
  maxResults?: number;
}

/**
 * Result from generate_media_recommendations task
 */
export interface GenerateMediaRecommendationsResult {
  /** Number of recommendations generated */
  generated: number;
  /** Number of recommendations pruned (old ones removed) */
  pruned: number;
  /** Query hash for deduplication */
  queryHash: string;
}

/**
 * Payload for full_ingest task (combined transcode + labels)
 */
export interface FullIngestPayload {
  /** ID of the Upload record */
  uploadId: string;
  /** Configuration for transcode/proxy */
  transcode?: TranscodeConfig;
  /** Configuration for sprite sheet */
  sprite?: SpriteConfig;
  /** Configuration for thumbnail */
  thumbnail?: ThumbnailConfig;
  /** Configuration for label detection */
  labels?: DetectLabelsConfig;
  /** Processing provider */
  provider?: ProcessingProvider;
}
