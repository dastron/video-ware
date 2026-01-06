import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { MediaInputSchema } from '../schema';
import type { Media, MediaInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class MediaMutator extends BaseMutator<Media, MediaInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<Media> {
    return this.pb.collection('Media');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: [
        'WorkspaceRef',
        'UploadRef',
        'thumbnailFileRef',
        'spriteFileRef',
        'proxyFileRef',
      ],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(input: MediaInput): Promise<MediaInput> {
    return MediaInputSchema.parse(input);
  }

  /**
   * Get media by workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of media for the workspace
   */
  async getByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<Media>> {
    return this.getList(page, perPage, `WorkspaceRef = "${workspaceId}"`);
  }

  /**
   * Get media by upload
   * @param uploadId The upload ID
   * @returns The media record or null if not found
   */
  async getByUpload(uploadId: string): Promise<Media | null> {
    return this.getFirstByFilter(`UploadRef = "${uploadId}"`);
  }
}
