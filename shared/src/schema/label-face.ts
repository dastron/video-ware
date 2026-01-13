import {
  defineCollection,
  RelationField,
  TextField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema for LabelFace
export const LabelFaceSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    LabelEntityRef: RelationField({ collection: 'LabelEntity' }).optional(),
    trackId: TextField({ min: 1 }),
    faceId: TextField().optional(),

    // Likelihoods (e.g., VERY_UNLIKELY, UNLIKELY, POSSIBLE, LIKELY, VERY_LIKELY)
    joyLikelihood: TextField().optional(),
    sorrowLikelihood: TextField().optional(),
    angerLikelihood: TextField().optional(),
    surpriseLikelihood: TextField().optional(),
    underExposedLikelihood: TextField().optional(),
    blurredLikelihood: TextField().optional(),
    headwearLikelihood: TextField().optional(),

    startTime: NumberField(),
    endTime: NumberField(),
    duration: NumberField(),
    avgConfidence: NumberField(),

    metadata: JSONField().optional(),
    faceHash: TextField({ min: 1 }), // Unique constraint for deduplication
  })
  .extend(baseSchema);

// Define input schema for creating label faces
export const LabelFaceInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  LabelEntityRef: z.string().optional(),
  trackId: z.string().min(1, 'Track ID is required'),
  faceId: z.string().optional(),

  joyLikelihood: z.string().optional(),
  sorrowLikelihood: z.string().optional(),
  angerLikelihood: z.string().optional(),
  surpriseLikelihood: z.string().optional(),
  underExposedLikelihood: z.string().optional(),
  blurredLikelihood: z.string().optional(),
  headwearLikelihood: z.string().optional(),

  startTime: z.number().min(0),
  endTime: z.number().min(0),
  duration: z.number().min(0),
  avgConfidence: z.number().min(0).max(1),

  metadata: z.record(z.unknown()).optional(),
  faceHash: z.string().min(1, 'Face hash is required'),
});

// Define the collection
export const LabelFaceCollection = defineCollection({
  collectionName: 'LabelFaces',
  schema: LabelFaceSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE UNIQUE INDEX idx_label_face_hash ON LabelFace (faceHash)',
    'CREATE INDEX idx_label_face_workspace ON LabelFace (WorkspaceRef)',
    'CREATE INDEX idx_label_face_media ON LabelFace (MediaRef)',
    'CREATE INDEX idx_label_face_track ON LabelFace (trackId)',
  ],
});

export default LabelFaceCollection;

// Export TypeScript types
export type LabelFace = z.infer<typeof LabelFaceSchema>;
export type LabelFaceInput = z.infer<typeof LabelFaceInputSchema>;
export type LabelFaceUpdate = Partial<LabelFaceInput>;
