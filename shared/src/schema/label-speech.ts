import {
  defineCollection,
  RelationField,
  TextField,
  NumberField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Define word timing schema
const WordTimingSchema = z.object({
  word: z.string(),
  startTime: z.number(),
  endTime: z.number(),
  confidence: z.number(),
  speakerTag: z.number().optional(),
});

// Define the Zod schema for LabelSpeech
export const LabelSpeechSchema = z
  .object({
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }),

    transcript: TextField({ min: 1 }),
    startTime: NumberField(),
    endTime: NumberField(),
    duration: NumberField(),
    confidence: NumberField(),

    speakerTag: NumberField().optional(),
    languageCode: TextField().optional(),

    words: JSONField(), // Array of words with timing

    metadata: JSONField().optional(),
    speechHash: TextField({ min: 1 }), // Unique constraint for deduplication
  })
  .extend(baseSchema);

// Define input schema for creating label speech
export const LabelSpeechInputSchema = z.object({
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  MediaRef: z.string().min(1, 'Media is required'),

  transcript: z.string().min(1, 'Transcript is required'),
  startTime: z.number().min(0),
  endTime: z.number().min(0),
  duration: z.number().min(0),
  confidence: z.number().min(0).max(1),

  speakerTag: z.number().optional(),
  languageCode: z.string().optional(),

  words: z.array(WordTimingSchema),

  metadata: z.record(z.unknown()).optional(),
  speechHash: z.string().min(1, 'Speech hash is required'),
});

// Define the collection
export const LabelSpeechCollection = defineCollection({
  collectionName: 'LabelSpeech',
  schema: LabelSpeechSchema,
  permissions: {
    listRule: '@request.auth.id != ""',
    viewRule: '@request.auth.id != ""',
    createRule: '@request.auth.id != ""',
    updateRule: '@request.auth.id != ""',
    deleteRule: '@request.auth.id != ""',
  },
  indexes: [
    'CREATE UNIQUE INDEX idx_label_speech_hash ON LabelSpeech (speechHash)',
    'CREATE INDEX idx_label_speech_workspace ON LabelSpeech (WorkspaceRef)',
    'CREATE INDEX idx_label_speech_media ON LabelSpeech (MediaRef)',
  ],
});

export default LabelSpeechCollection;

// Export TypeScript types
export type LabelSpeech = z.infer<typeof LabelSpeechSchema>;
export type LabelSpeechInput = z.infer<typeof LabelSpeechInputSchema>;
export type LabelSpeechUpdate = Partial<LabelSpeechInput>;
