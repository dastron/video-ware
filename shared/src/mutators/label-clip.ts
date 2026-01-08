import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { LabelClipInputSchema } from '../schema';
import type { LabelClip, LabelClipInput } from '../schema';
import type { TypedPocketBase } from '../types';
import { BaseMutator, type MutatorOptions } from './base';
import { LabelType } from '../enums';

/**
 * Options for searching label clips
 */
export interface LabelClipSearchOptions {
  /** Filter by label type (e.g., 'object', 'shot', 'person', 'speech') */
  labelType?: LabelType;
  /** Text search query to match entity_description or labelData content */
  searchQuery?: string;
  /** Minimum confidence threshold (0-1) */
  confidenceThreshold?: number;
  /** Minimum start time (seconds) */
  minTime?: number;
  /** Maximum end time (seconds) */
  maxTime?: number;
  /** Filter by media reference */
  mediaRef?: string;
  /** Filter by workspace reference */
  workspaceRef?: string;
}

export class LabelClipMutator extends BaseMutator<LabelClip, LabelClipInput> {
  constructor(pb: TypedPocketBase, options?: Partial<MutatorOptions>) {
    super(pb, options);
  }

  protected getCollection(): RecordService<LabelClip> {
    return this.pb.collection('LabelClips');
  }

  protected setDefaults(): MutatorOptions {
    return {
      expand: ['WorkspaceRef', 'MediaRef', 'TaskRef'],
      filter: [],
      sort: ['start'], // Sort by start time by default
    };
  }

  protected async validateInput(
    input: LabelClipInput
  ): Promise<LabelClipInput> {
    return LabelClipInputSchema.parse(input);
  }

  /**
   * Build filter string from search options
   * @param options Search options
   * @returns Filter string for PocketBase query
   */
  private buildSearchFilter(options: LabelClipSearchOptions): string[] {
    const filters: string[] = [];

    // Filter by label type
    if (options.labelType) {
      filters.push(`labelType = "${options.labelType}"`);
    }

    // Filter by text search (entity description or labelData content)
    if (options.searchQuery) {
      const searchTerm = options.searchQuery.trim();
      if (searchTerm) {
        // Search in labelData JSON field (PocketBase supports JSON field search)
        filters.push(`labelData ~ "${searchTerm}"`);
      }
    }

    // Filter by confidence threshold
    if (options.confidenceThreshold !== undefined) {
      filters.push(`confidence >= ${options.confidenceThreshold}`);
    }

    // Filter by time window
    if (options.minTime !== undefined) {
      filters.push(`start >= ${options.minTime}`);
    }
    if (options.maxTime !== undefined) {
      filters.push(`end <= ${options.maxTime}`);
    }

    // Filter by media reference
    if (options.mediaRef) {
      filters.push(`MediaRef = "${options.mediaRef}"`);
    }

    // Filter by workspace reference
    if (options.workspaceRef) {
      filters.push(`WorkspaceRef = "${options.workspaceRef}"`);
    }

    return filters;
  }

  /**
   * Search label clips with filtering and pagination
   * @param options Search options
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of label clips matching the search criteria
   */
  async search(
    options: LabelClipSearchOptions,
    page = 1,
    perPage = 50
  ): Promise<ListResult<LabelClip>> {
    const filters = this.buildSearchFilter(options);
    return this.getList(
      page,
      perPage,
      filters,
      'start', // Sort by start time ascending
      ['MediaRef', 'WorkspaceRef', 'TaskRef']
    );
  }

  /**
   * Get label clips by media
   * @param mediaId The media ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 100)
   * @returns List of label clips for the media
   */
  async getByMedia(
    mediaId: string,
    page = 1,
    perPage = 100
  ): Promise<ListResult<LabelClip>> {
    return this.getList(page, perPage, `MediaRef = "${mediaId}"`);
  }

  /**
   * Get label clips by workspace
   * @param workspaceId The workspace ID
   * @param page Page number (default: 1)
   * @param perPage Items per page (default: 50)
   * @returns List of label clips for the workspace
   */
  async getByWorkspace(
    workspaceId: string,
    page = 1,
    perPage = 50
  ): Promise<ListResult<LabelClip>> {
    return this.getList(
      page,
      perPage,
      `WorkspaceRef = "${workspaceId}"`,
      '-created', // Sort by most recent first
      ['MediaRef', 'WorkspaceRef']
    );
  }
}
