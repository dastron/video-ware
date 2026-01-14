import { RecordService } from 'pocketbase';
import type { ListResult } from 'pocketbase';
import { createHash } from 'crypto';
import { LabelClipInputSchema } from '../schema';
import type {
  LabelClip,
  LabelClipInput,
  LabelShot,
  LabelPerson,
  LabelObject,
  LabelFace,
  MediaRecommendation,
} from '../schema';
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

  /**
   * Generate a deterministic hash for a label clip
   */
  generateLabelHash(
    mediaId: string,
    start: number,
    end: number,
    labelType: LabelType
  ): string {
    const hashInput = `${mediaId}:${start.toFixed(1)}:${end.toFixed(1)}:${labelType}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Find a label clip by its hash
   */
  async getByHash(labelHash: string): Promise<LabelClip | null> {
    return this.getFirstByFilter(`labelHash = "${labelHash}"`);
  }

  /**
   * Type guards for label sources
   */
  private hasProperty<T extends string>(
    obj: unknown,
    prop: T
  ): obj is { [K in T]: unknown } {
    return typeof obj === 'object' && obj !== null && prop in obj;
  }

  isLabelShot(source: unknown): source is LabelShot {
    return (
      this.hasProperty(source, 'entity') &&
      !this.hasProperty(source, 'personId') &&
      !this.hasProperty(source, 'faceId')
    );
  }

  isLabelPerson(source: unknown): source is LabelPerson {
    return this.hasProperty(source, 'personId');
  }

  isLabelFace(source: unknown): source is LabelFace {
    return (
      this.hasProperty(source, 'faceId') ||
      this.hasProperty(source, 'avgConfidence')
    );
  }

  isLabelObject(source: unknown): source is LabelObject {
    return (
      this.hasProperty(source, 'entity') &&
      this.hasProperty(source, 'originalTrackId')
    );
  }

  isMediaRecommendation(source: unknown): source is MediaRecommendation {
    return (
      this.hasProperty(source, 'strategy') &&
      this.hasProperty(source, 'reason') &&
      this.hasProperty(source, 'score')
    );
  }

  /**
   * Actualize a label (Shot, Person, Object, or Face) into a LabelClip
   */
  async createFromSource(
    source:
      | LabelShot
      | LabelPerson
      | LabelObject
      | LabelFace
      | MediaRecommendation,
    labelType: LabelType
  ): Promise<LabelClip> {
    const labelHash = this.generateLabelHash(
      source.MediaRef,
      source.start,
      source.end,
      labelType
    );

    // Prepare label data based on source type
    let labelData: Record<string, unknown> = {};

    if (this.hasProperty(source, 'metadata')) {
      labelData = { ...(source.metadata as Record<string, unknown>) };
    }

    if (this.isLabelShot(source)) {
      labelData.entity = source.entity;
    } else if (this.isLabelPerson(source)) {
      labelData.personId = source.personId;
      labelData.upperBodyColor = source.upperBodyColor;
      labelData.lowerBodyColor = source.lowerBodyColor;
    } else if (this.isLabelFace(source)) {
      labelData.faceId = source.faceId;
    } else if (this.isLabelObject(source)) {
      labelData.entity = source.entity;
    } else if (this.isMediaRecommendation(source)) {
      labelData.reason = source.reason;
      labelData.reasonData = source.reasonData;
      labelData.strategy = source.strategy;
    }

    // Safely extract confidence and version
    let confidence = 0;
    if (this.isLabelFace(source)) {
      confidence = source.avgConfidence;
    } else if (this.isMediaRecommendation(source)) {
      confidence = source.score;
    } else if (
      'confidence' in source &&
      typeof source.confidence === 'number'
    ) {
      confidence = source.confidence;
    }

    const version =
      'version' in source && typeof source.version === 'number'
        ? source.version
        : 1;

    const input: LabelClipInput = {
      WorkspaceRef: source.WorkspaceRef,
      MediaRef: source.MediaRef,
      labelId: (source as any).id,
      labelHash,
      labelType,
      start: source.start,
      end: source.end,
      duration:
        'duration' in source && typeof source.duration === 'number'
          ? source.duration
          : source.end - source.start,
      confidence: confidence,
      version: version || 1,
      processor: 'manual',
      provider: 'manual',
      labelData,
    };

    return this.create(input);
  }
}
