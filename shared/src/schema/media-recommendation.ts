import {
  defineCollection,
  RelationField,
  NumberField,
  JSONField,
  TextField,
  SelectField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { LabelType, RecommendationStrategy } from '../enums';

/**
 * MediaRecommendation Schema
 *
 * Stores media-level recommendations for discovering segments within a media entity
 * based on label analysis. Each recommendation points to a specific time range
 * within a media file and includes scoring, explanation, and strategy metadata.
 */
export const MediaRecommendationSchema = z
  .object({
    // Scoping
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),

    // Segment targeting
    start: NumberField({ min: 0 }), // seconds (float)
    end: NumberField({ min: 0 }), // seconds (float)

    // Optional link to existing clip
    MediaClipRef: RelationField({ collection: 'MediaClips' }).optional(),

    // Scoring
    score: NumberField({ min: 0, max: 1 }), // 0-1 relevance score
    rank: NumberField({ min: 0 }), // Pre-computed ordering (0-based)

    // Explanation
    reason: TextField({ min: 1, max: 500 }), // Human-readable explanation
    reasonData: JSONField(), // Structured explanation data

    // Strategy and source
    strategy: SelectField([
      RecommendationStrategy.SAME_ENTITY,
      RecommendationStrategy.ADJACENT_SHOT,
      RecommendationStrategy.TEMPORAL_NEARBY,
      RecommendationStrategy.CONFIDENCE_DURATION,
    ]),
    labelType: SelectField(
      [
        LabelType.OBJECT,
        LabelType.SHOT,
        LabelType.PERSON,
        LabelType.FACE,
        LabelType.SPEECH,
      ],
      { maxSelect: 1 }
    ),

    // Deduplication
    queryHash: TextField({ min: 1 }), // Deterministic hash for upsert behavior

    // Versioning
    version: NumberField().default(1),
    processor: TextField().optional(), // e.g., "recommendation-engine:1.0.0"
  })
  .extend(baseSchema);

/**
 * Input schema for creating media recommendations
 */
export const MediaRecommendationInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  start: z.number().min(0, 'Start time must be non-negative'),
  end: z.number().min(0, 'End time must be non-negative'),
  MediaClipRef: z.string().optional(),
  score: z.number().min(0).max(1, 'Score must be between 0 and 1'),
  rank: z.number().int().min(0, 'Rank must be a non-negative integer'),
  reason: z.string().min(1).max(500, 'Reason must be 1-500 characters'),
  reasonData: z.record(z.unknown()),
  strategy: z.enum([
    RecommendationStrategy.SAME_ENTITY,
    RecommendationStrategy.ADJACENT_SHOT,
    RecommendationStrategy.TEMPORAL_NEARBY,
    RecommendationStrategy.CONFIDENCE_DURATION,
  ]),
  labelType: z.enum([
    LabelType.OBJECT,
    LabelType.SHOT,
    LabelType.PERSON,
    LabelType.FACE,
    LabelType.SPEECH,
  ]),
  queryHash: z.string().min(1, 'Query hash is required'),
  version: z.number().default(1),
  processor: z.string().optional(),
});

/**
 * MediaRecommendations Collection Definition
 *
 * Indexes:
 * - Unique index on (queryHash, start, end) for upsert behavior
 * - Index on (WorkspaceRef, MediaRef, queryHash) for context lookups
 * - Index on (queryHash, rank) for ordered retrieval
 * - Index on (MediaRef, labelType) for filtering
 */
export const MediaRecommendationCollection = defineCollection({
  collectionName: 'MediaRecommendations',
  schema: MediaRecommendationSchema,
  permissions: {
    // Authenticated users can list media recommendations
    listRule: '@request.auth.id != ""',
    // Authenticated users can view media recommendations
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create media recommendations
    createRule: '@request.auth.id != ""',
    // Authenticated users can update media recommendations
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete media recommendations
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    // Unique index for upsert behavior (queryHash + segment)
    'CREATE UNIQUE INDEX idx_media_rec_hash_segment ON MediaRecommendations (queryHash, start, end)',
    // Index for context lookups
    'CREATE INDEX idx_media_rec_context ON MediaRecommendations (WorkspaceRef, MediaRef, queryHash)',
    // Index for ordered retrieval
    'CREATE INDEX idx_media_rec_rank ON MediaRecommendations (queryHash, rank)',
    // Index for filtering by label type
    'CREATE INDEX idx_media_rec_label_type ON MediaRecommendations (MediaRef, labelType)',
  ],
});

export default MediaRecommendationCollection;

// Export TypeScript types
export type MediaRecommendation = z.infer<typeof MediaRecommendationSchema>;
export type MediaRecommendationInput = z.infer<
  typeof MediaRecommendationInputSchema
>;
export type MediaRecommendationUpdate = Partial<MediaRecommendationInput>;

/**
 * ReasonData structure for MediaRecommendations
 * This provides type safety for the reasonData JSON field
 */
export interface MediaReasonData {
  // For same_entity strategy
  entityId?: string;
  entityName?: string;
  matchedLabels?: string[];

  // For adjacent_shot strategy
  shotIndex?: number;
  direction?: 'previous' | 'next';

  // For temporal_nearby strategy
  timeDelta?: number;

  // For confidence_duration strategy
  confidence?: number;
  duration?: number;

  // For score combiner (when multiple strategies contribute)
  combinedStrategies?: RecommendationStrategy[];
  individualScores?: Record<string, number>;

  // Common
  labelClipIds?: string[];
}
