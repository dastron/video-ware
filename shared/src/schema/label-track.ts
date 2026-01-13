import {
  defineCollection,
  RelationField,
  SelectField,
  TextField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { ProcessingProvider } from '../enums';

// Define the Zod schema for LabelTrack
export const LabelTrackSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    TaskRef: RelationField({ collection: 'Tasks' }).optional(),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }),
    LabelFaceRef: RelationField({ collection: 'LabelFaces' }).optional(),
    trackId: TextField(), // Stable within processing run
    start: NumberField({ min: 0 }), // seconds (float)
    end: NumberField({ min: 0 }), // seconds (float)
    duration: NumberField({ min: 0 }), // seconds (float)
    confidence: NumberField({ min: 0, max: 1 }), // average or max
    provider: SelectField([ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE]),
    processor: TextField(), // e.g., "object-tracking:1.0.0"
    version: NumberField().default(1).optional(),
    trackData: JSONField(), // Aggregated properties (class, attributes)
    keyframes: JSONField(), // Array: [{t, bbox, confidence, ...}]
    trackHash: TextField({ min: 1 }), // Unique constraint
  })
  .extend(baseSchema);

// Define input schema for creating label tracks
export const LabelTrackInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  TaskRef: z.string().optional(),
  LabelEntityRef: z.string().min(1, 'Label entity is required'),
  LabelFaceRef: z.string().optional(),
  trackId: z.string().min(1, 'Track ID is required'),
  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),
  confidence: z.number().min(0).max(1),
  provider: z.enum([ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE]),
  processor: z.string().min(1, 'Processor is required'),
  version: z.number().default(1).optional(),
  trackData: z.record(z.unknown()), // JSON object
  keyframes: z.array(z.unknown()), // Array of keyframe objects
  trackHash: z.string().min(1, 'Track hash is required'),
});

// Define the collection with workspace-scoped permissions
export const LabelTrackCollection = defineCollection({
  collectionName: 'LabelTrack',
  schema: LabelTrackSchema,
  permissions: {
    // Authenticated users can list label tracks
    listRule: '@request.auth.id != ""',
    // Authenticated users can view label tracks
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create label tracks
    createRule: '@request.auth.id != ""',
    // Authenticated users can update label tracks
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete label tracks
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    // Unique constraint on trackHash for deduplication
    'CREATE UNIQUE INDEX idx_label_track_hash ON LabelTrack (trackHash)',
    // Index for media + entity queries
    'CREATE INDEX idx_label_track_media_entity ON LabelTrack (MediaRef, LabelEntityRef)',
    // Index for workspace + media queries
    'CREATE INDEX idx_label_track_workspace_media ON LabelTrack (WorkspaceRef, MediaRef)',
  ],
});

export default LabelTrackCollection;

// Export TypeScript types
export type LabelTrack = z.infer<typeof LabelTrackSchema>;
export type LabelTrackInput = z.infer<typeof LabelTrackInputSchema>;
export type LabelTrackUpdate = Partial<LabelTrackInput>;
