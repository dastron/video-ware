import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { LabelMediaInputSchema } from '../schema';
import type { LabelMedia, LabelMediaInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';

export class LabelMediaMutator extends BaseMutator<
  LabelMedia,
  LabelMediaInput
> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<LabelMedia> {
    return this.pb.collection('LabelMedia');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['MediaRef'],
      filter: [],
      sort: ['-created'],
    };
  }

  protected async validateInput(
    input: LabelMediaInput
  ): Promise<LabelMediaInput> {
    return LabelMediaInputSchema.parse(input);
  }

  /**
   * Get media labels by media
   * @param mediaId The media ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of media labels for the media
   */
  async getByMedia(
    mediaId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<LabelMedia>> {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }

  /**
   * Get the latest media label for a media item
   * @param mediaId The media ID
   * @returns The latest media label record or null if not found
   */
  async getLatestByMedia(mediaId: string): Promise<LabelMedia | null> {
    return this.getFirstByFilter(`MediaRef = "${mediaId}"`, '-created');
  }
}
