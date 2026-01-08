import {
  defineCollection,
  RelationField,
  NumberField,
  JSONField,
  TextField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define the Zod schema
export const MediaLabelSchema = z
  .object({
    MediaRef: RelationField({ collection: 'Media' }),
    labelData: JSONField().optional(), // { codec, fps, width, height, ... }
    version: NumberField().default(1).optional(),
    // Intelligence fields
    labels: JSONField().optional(), // Array of detected labels
    objects: JSONField().optional(), // Array of detected objects
    sceneChanges: JSONField().optional(), // Array of scene change timestamps
    transcription: JSONField().optional(), // Speech-to-text result
    intelligenceProcessedAt: TextField().optional(), // ISO timestamp
  })
  .extend(baseSchema);

// Define input schema for creating media labels
export const MediaLabelInputSchema = z.object({
  MediaRef: z.string().min(1, 'Media reference is required'),
  labelData: JSONField().optional(),
  version: NumberField().default(1).optional(),
  // Intelligence fields
  labels: JSONField().optional(),
  objects: JSONField().optional(),
  sceneChanges: JSONField().optional(),
  transcription: JSONField().optional(),
  intelligenceProcessedAt: z.string().optional(),
});

// Define the collection with permissions
export const MediaLabelCollection = defineCollection({
  collectionName: 'MediaLabels',
  schema: MediaLabelSchema,
  permissions: {
    // Authenticated users can list media labels
    listRule: '@request.auth.id != ""',
    // Authenticated users can view media labels
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create media labels
    createRule: '@request.auth.id != ""',
    // Authenticated users can update media labels
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete media labels
    deleteRule: '@request.auth.id != ""',
  },
});

export default MediaLabelCollection;

// Export TypeScript types
export type MediaLabel = z.infer<typeof MediaLabelSchema>;
export type MediaLabelInput = z.infer<typeof MediaLabelInputSchema>;
export type MediaLabelUpdate = Partial<MediaLabelInput>;
