import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { MediaClipInputSchema } from '../schema';
import type { MediaClip, MediaClipInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

/**
 * Options for filtering media clips by workspace
 */
export interface GetByWorkspaceOptions {
  /** Filter by clip type (e.g., 'USER', 'RANGE', 'SHOT') */
  type?: string;
  /** Search query to filter by clip label or media name */
  searchQuery?: string;
}

export class MediaClipMutator extends BaseMutator<MediaClip, MediaClipInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<MediaClip> {
    return this.pb.collection('MediaClips');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef', 'MediaRef', 'MediaRef.UploadRef'],
      filter: [],
      sort: ['start'], // Sort by start time by default
    };
  }

  protected async validateInput(
    input: MediaClipInput
  ): Promise<MediaClipInput> {
    return MediaClipInputSchema.parse(input);
  }

  /**
   * Get media clips by media
   * @param mediaId The media ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of media clips for the media
   */
  async getByMedia(
    mediaId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<MediaClip>> {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }

  /**
   * Get media clips by workspace with optional filtering
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @param options Optional filtering options (type, searchQuery)
   * @returns List of media clips for the workspace with expanded MediaRef
   */
  async getByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50,
    options?: GetByWorkspaceOptions
  ): Promise<ListResult<MediaClip>> {
    const filters: string[] = [`WorkspaceRef = "${workspaceId}"`];

    // Add type filter if provided
    if (options?.type) {
      filters.push(`type = "${options.type}"`);
    }

    // Add search query filter if provided
    // Search in clip type and media name (via relation)
    if (options?.searchQuery) {
      const searchTerm = options.searchQuery.trim();
      if (searchTerm) {
        // Search in type field or in the related media's upload filename
        filters.push(
          `(type ~ "${searchTerm}" || MediaRef.UploadRef.filename ~ "${searchTerm}")`
        );
      }
    }

    return this.getList(
      page,
      perPage,
      filters,
      '-created', // Sort by most recent first
      ['MediaRef', 'MediaRef.UploadRef', 'MediaRef.thumbnailFileRef']
    );
  }
}
