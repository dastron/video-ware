import {
  defineCollection,
  RelationField,
  SelectField,
  NumberField,
  JSONField,
  TextField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { LabelType, ProcessingProvider } from '../enums';

// Define the Zod schema
export const LabelClipSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),
    TaskRef: RelationField({ collection: 'Tasks' }).optional(),
    labelType: SelectField([
      LabelType.OBJECT,
      LabelType.SHOT,
      LabelType.PERSON,
      LabelType.SPEECH,
    ]),
    type: TextField(),
    start: NumberField({ min: 0 }), // seconds (float)
    end: NumberField({ min: 0 }), // seconds (float)
    duration: NumberField({ min: 0 }), // seconds (float)
    confidence: NumberField({ min: 0, max: 1 }),
    version: NumberField().default(1).optional(),
    processor: TextField(), // e.g., "label-normalizer:1.0.0"
    provider: SelectField([
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      ProcessingProvider.GOOGLE_SPEECH,
    ]),
    labelData: JSONField(), // Normalized label data (compact)
  })
  .extend(baseSchema);

// Define input schema for creating label clips
export const LabelClipInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),
  TaskRef: z.string().optional(),
  labelType: z.enum([
    LabelType.OBJECT,
    LabelType.SHOT,
    LabelType.PERSON,
    LabelType.SPEECH,
  ]),
  start: z.number().min(0),
  end: z.number().min(0),
  duration: z.number().min(0),
  confidence: z.number().min(0).max(1),
  version: z.number().default(1).optional(),
  processor: z.string(),
  provider: z.enum([
    ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
    ProcessingProvider.GOOGLE_SPEECH,
  ]),
  labelData: z.record(z.unknown()), // JSON object
});

// Define the collection with workspace-scoped permissions
export const LabelClipCollection = defineCollection({
  collectionName: 'LabelClips',
  schema: LabelClipSchema,
  permissions: {
    // Authenticated users can list label clips
    listRule: '@request.auth.id != ""',
    // Authenticated users can view label clips
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create label clips
    createRule: '@request.auth.id != ""',
    // Authenticated users can update label clips
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete label clips
    deleteRule: '@request.auth.id != ""',
  },
});

export default LabelClipCollection;

// Export TypeScript types
export type LabelClip = z.infer<typeof LabelClipSchema>;
export type LabelClipInput = z.infer<typeof LabelClipInputSchema>;
export type LabelClipUpdate = Partial<LabelClipInput>;
