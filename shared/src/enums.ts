// Shared enums for the project

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  MODERATOR = 'moderator',
}

export enum PostStatus {
  DRAFT = 'draft',
  PUBLISHED = 'published',
  ARCHIVED = 'archived',
}

export enum CollectionName {
  USERS = 'users',
  POSTS = 'posts',
  COMMENTS = 'comments',
}

// PocketBase collection names (type-safe)
export const COLLECTIONS = {
  USERS: 'users',
  POSTS: 'posts',
  COMMENTS: 'comments',
} as const;

export type CollectionNameType = (typeof COLLECTIONS)[keyof typeof COLLECTIONS];

export enum UploadStatus {
  QUEUED = 'queued',
  UPLOADING = 'uploading',
  UPLOADED = 'uploaded',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

export enum StorageBackendType {
  LOCAL = 'local',
  S3 = 's3',
}

export enum WatchedFileStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export enum FileStatus {
  PENDING = 'pending',
  AVAILABLE = 'available',
  FAILED = 'failed',
  DELETED = 'deleted',
}

export enum FileType {
  ORIGINAL = 'original',
  PROXY = 'proxy',
  THUMBNAIL = 'thumbnail',
  SPRITE = 'sprite',
  LABELS_JSON = 'labels_json',
  RENDER = 'render',
}

export enum FileSource {
  S3 = 's3',
  POCKETBASE = 'pocketbase',
  GCS = 'gcs',
}

export enum MediaType {
  VIDEO = 'video',
  AUDIO = 'audio',
  IMAGE = 'image',
}

export enum ClipType {
  USER = 'user',
  FULL = 'full',
  RANGE = 'range',
  SHOT = 'shot',
  OBJECT = 'object',
  PERSON = 'person',
  SPEECH = 'speech',
  RECOMMENDATION = 'recommendation',
}

export enum LabelType {
  OBJECT = 'object',
  SHOT = 'shot',
  PERSON = 'person',
  SPEECH = 'speech',
}

export enum RecommendationStrategy {
  SAME_ENTITY = 'same_entity',
  ADJACENT_SHOT = 'adjacent_shot',
  TEMPORAL_NEARBY = 'temporal_nearby',
  CONFIDENCE_DURATION = 'confidence_duration',
}

export enum RecommendationTargetMode {
  APPEND = 'append',
  REPLACE = 'replace',
}

export enum TaskStatus {
  QUEUED = 'queued',
  RUNNING = 'running',
  SUCCESS = 'success',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

export enum TaskType {
  PROCESS_UPLOAD = 'process_upload',
  DERIVE_CLIPS = 'derive_clips',
  DETECT_LABELS = 'detect_labels',
  RECOMMEND_CLIPS = 'recommend_clips',
  RENDER_TIMELINE = 'render_timeline',
}

export enum ProcessingProvider {
  FFMPEG = 'ffmpeg',
  GOOGLE_TRANSCODER = 'google_transcoder',
  GOOGLE_VIDEO_INTELLIGENCE = 'google_video_intelligence',
  GOOGLE_SPEECH = 'google_speech',
}

export enum WorkspaceRole {
  OWNER = 'owner',
  ADMIN = 'admin',
  MEMBER = 'member',
  VIEWER = 'viewer',
}

export const VIDEO_COLLECTIONS = {
  WORKSPACES: 'workspaces',
  WORKSPACE_MEMBERS: 'workspace_members',
  UPLOADS: 'uploads',
  FILES: 'files',
  MEDIA: 'media',
  MEDIA_CLIPS: 'media_clips',
  MEDIA_LABELS: 'media_labels',
  TASKS: 'tasks',
  TIMELINES: 'timelines',
  CLIP_RECOMMENDATIONS: 'clip_recommendations',
} as const;

export type VideoCollectionName =
  (typeof VIDEO_COLLECTIONS)[keyof typeof VIDEO_COLLECTIONS];
