import type { TypedPocketBase } from '@project/shared/types';
import {
  MediaMutator,
  FileMutator,
  MediaClipMutator,
  TaskMutator,
  UploadMutator,
} from '@project/shared/mutator';
import type {
  Media,
  File as FileRecord,
  MediaClip,
  Task,
  LabelsFlowConfig,
  DetectLabelsPayload,
} from '@project/shared';
import { ProcessingProvider } from '@project/shared';

/**
 * Media with preview assets
 */
export interface MediaWithPreviews extends Media {
  thumbnailUrl?: string;
  spriteUrl?: string;
  thumbnailFileRecord?: FileRecord;
  spriteFileRecord?: FileRecord;
  clips?: MediaClip[];
}

/**
 * Media service that provides high-level media operations
 * Handles media retrieval with preview assets and metadata
 */
export class MediaService {
  private mediaMutator: MediaMutator;
  private fileMutator: FileMutator;
  private mediaClipMutator: MediaClipMutator;
  private taskMutator: TaskMutator;
  private uploadMutator: UploadMutator;

  constructor(pb: TypedPocketBase) {
    this.mediaMutator = new MediaMutator(pb);
    this.fileMutator = new FileMutator(pb);
    this.mediaClipMutator = new MediaClipMutator(pb);
    this.taskMutator = new TaskMutator(pb);
    this.uploadMutator = new UploadMutator(pb);
  }

  /**
   * Get media with preview assets (thumbnail and sprite URLs)
   * @param mediaId The media ID
   * @returns Media with preview URLs or null if not found
   */
  async getMediaWithPreviews(
    mediaId: string
  ): Promise<MediaWithPreviews | null> {
    const media = await this.mediaMutator.getById(mediaId);
    if (!media) {
      return null;
    }

    return this.enrichMediaWithPreviews(media);
  }

  /**
   * Get all media for a workspace with preview assets
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of media with preview URLs
   */
  async getMediaByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<MediaWithPreviews[]> {
    const result = await this.mediaMutator.getByWorkspace(
      workspaceId,
      page,
      perPage
    );

    // Enrich each media item with preview URLs
    const enrichedMedia = await Promise.all(
      result.items.map((media) => this.enrichMediaWithPreviews(media))
    );

    return enrichedMedia;
  }

  /**
   * Get media by upload ID
   * @param uploadId The upload ID
   * @returns Media with preview URLs or null if not found
   */
  async getMediaByUpload(uploadId: string): Promise<MediaWithPreviews | null> {
    const media = await this.mediaMutator.getByUpload(uploadId);
    if (!media) {
      return null;
    }

    return this.enrichMediaWithPreviews(media);
  }

  /**
   * Get clips for a media item
   * @param mediaId The media ID
   * @returns List of media clips
   */
  async getMediaClips(mediaId: string): Promise<MediaClip[]> {
    const result = await this.mediaClipMutator.getByMedia(mediaId);
    return result.items;
  }

  /**
   * Enrich media with preview URLs and clips
   * @param media The media record
   * @returns Media with preview URLs and clips
   */
  private async enrichMediaWithPreviews(
    media: Media
  ): Promise<MediaWithPreviews> {
    const enriched: MediaWithPreviews = { ...media };

    // Get thumbnail URL from expand if available
    const thumbnailFile = (media.expand as any)?.thumbnailFileRef;
    if (thumbnailFile) {
      enriched.thumbnailUrl = this.fileMutator.getFileUrl(thumbnailFile);
      enriched.thumbnailFileRecord = thumbnailFile;
    }

    // Get sprite URL from expand if available
    const spriteFile = (media.expand as any)?.spriteFileRef;
    if (spriteFile) {
      enriched.spriteUrl = this.fileMutator.getFileUrl(spriteFile);
      enriched.spriteFileRecord = spriteFile;
    }

    return enriched;
  }

  /**
   * Get media metadata
   * @param mediaId The media ID
   * @returns Media metadata or null if not found
   */
  async getMediaMetadata(mediaId: string): Promise<Media | null> {
    return this.mediaMutator.getById(mediaId);
  }

  /**
   * Check if media has preview assets available
   * @param media The media record
   * @returns True if both thumbnail and sprite are available
   */
  hasPreviewAssets(media: Media): boolean {
    return !!(media.thumbnailFileRef && media.spriteFileRef);
  }

  /**
   * Get file URL for a file record
   * @param file The file record
   * @param filename The filename field (default: 'blob')
   * @returns The file URL
   */
  getFileUrl(file: FileRecord, filename = 'blob'): string {
    return this.fileMutator.getFileUrl(file, filename);
  }

  /**
   * Create a label detection task for a media item
   * @param mediaId The media ID
   * @param config Optional custom configuration for label detection
   * @param userId Optional user ID
   * @returns The created task
   */
  async createTaskForLabel(
    mediaId: string,
    userId?: string,
    config?: LabelsFlowConfig
  ): Promise<Task> {
    const media = await this.mediaMutator.getById(mediaId);
    if (!media) {
      throw new Error(`Media not found: ${mediaId}`);
    }

    // Get upload to get UserRef and externalPath
    const upload = await this.uploadMutator.getById(media.UploadRef);
    if (!upload) {
      throw new Error(`Upload not found for media ${mediaId}`);
    }

    const currentUserId = userId || upload.UserRef;
    if (!currentUserId) {
      throw new Error('User context required for task creation');
    }

    // Default configuration if none provided
    const defaultConfig: LabelsFlowConfig = {
      confidenceThreshold: 0.5,
      detectObjects: true,
      detectLabels: true,
      detectFaces: true,
      detectPersons: true,
      detectSpeech: true,
    };

    const payload: DetectLabelsPayload = {
      mediaId,
      fileRef: upload.externalPath || '',
      provider: ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      config: { ...defaultConfig, ...config },
    };

    return this.taskMutator.createDetectLabelsTask(
      media.WorkspaceRef,
      currentUserId,
      mediaId,
      payload
    );
  }
}

/**
 * Create a MediaService instance from a PocketBase client
 */
export function createMediaService(pb: TypedPocketBase): MediaService {
  return new MediaService(pb);
}
