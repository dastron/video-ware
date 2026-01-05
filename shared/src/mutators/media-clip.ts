import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { MediaClipInputSchema } from '../schema';
import type { MediaClip, MediaClipInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class MediaClipMutator extends BaseMutator<MediaClip, MediaClipInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<MediaClip> {
    return this.pb.collection('MediaClips');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef', 'MediaRef'],
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
}
