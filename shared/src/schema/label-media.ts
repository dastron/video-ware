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
export const LabelMediaSchema = z
  .object({
    MediaRef: RelationField({ collection: 'Media' }),
    version: NumberField().default(1).optional(),

    // Processor tracking
    processors: JSONField().optional(), // Array of completed processors

    // Label Detection results
    labelDetectionProcessedAt: TextField().optional(),
    labelDetectionProcessor: TextField().optional(),
    segmentLabelCount: NumberField().optional(),
    shotLabelCount: NumberField().optional(),
    shotCount: NumberField().optional(),

    // Object Tracking results
    objectTrackingProcessedAt: TextField().optional(),
    objectTrackingProcessor: TextField().optional(),
    objectCount: NumberField().optional(),
    objectTrackCount: NumberField().optional(),

    // Face Detection results
    faceDetectionProcessedAt: TextField().optional(),
    faceDetectionProcessor: TextField().optional(),
    faceCount: NumberField().optional(),
    faceTrackCount: NumberField().optional(),

    // Person Detection results
    personDetectionProcessedAt: TextField().optional(),
    personDetectionProcessor: TextField().optional(),
    personCount: NumberField().optional(),
    personTrackCount: NumberField().optional(),

    // Speech Transcription results
    speechTranscriptionProcessedAt: TextField().optional(),
    speechTranscriptionProcessor: TextField().optional(),
    transcript: TextField().optional(),
    transcriptLength: NumberField().optional(),
    wordCount: NumberField().optional(),

    // Legacy fields (deprecated)
    labelData: JSONField().optional(),
    labels: JSONField().optional(),
    objects: JSONField().optional(),
    sceneChanges: JSONField().optional(),
    transcription: JSONField().optional(),
    intelligenceProcessedAt: TextField().optional(),
    processor: TextField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating media labels
export const LabelMediaInputSchema = z.object({
  MediaRef: z.string().min(1, 'Media reference is required'),
  version: z.number().default(1).optional(),

  // Processor tracking
  processors: z.array(z.string()).optional(),

  // Label Detection results
  labelDetectionProcessedAt: z.string().optional(),
  labelDetectionProcessor: z.string().optional(),
  segmentLabelCount: z.number().optional(),
  shotLabelCount: z.number().optional(),
  shotCount: z.number().optional(),

  // Object Tracking results
  objectTrackingProcessedAt: z.string().optional(),
  objectTrackingProcessor: z.string().optional(),
  objectCount: z.number().optional(),
  objectTrackCount: z.number().optional(),

  // Face Detection results
  faceDetectionProcessedAt: z.string().optional(),
  faceDetectionProcessor: z.string().optional(),
  faceCount: z.number().optional(),
  faceTrackCount: z.number().optional(),

  // Person Detection results
  personDetectionProcessedAt: z.string().optional(),
  personDetectionProcessor: z.string().optional(),
  personCount: z.number().optional(),
  personTrackCount: z.number().optional(),

  // Speech Transcription results
  speechTranscriptionProcessedAt: z.string().optional(),
  speechTranscriptionProcessor: z.string().optional(),
  transcript: z.string().optional(),
  transcriptLength: z.number().optional(),
  wordCount: z.number().optional(),

  // Legacy fields (deprecated)
  labelData: z.record(z.unknown()).optional(),
  labels: z.array(z.unknown()).optional(),
  objects: z.array(z.unknown()).optional(),
  sceneChanges: z.array(z.unknown()).optional(),
  transcription: z.record(z.unknown()).optional(),
  intelligenceProcessedAt: z.string().optional(),
  processor: z.string().optional(),
});

// Define the collection with permissions
export const LabelMediaCollection = defineCollection({
  collectionName: 'LabelMedia',
  schema: LabelMediaSchema,
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

export default LabelMediaCollection;

// Export TypeScript types
export type LabelMedia = z.infer<typeof LabelMediaSchema>;
export type LabelMediaInput = z.infer<typeof LabelMediaInputSchema>;
export type LabelMediaUpdate = Partial<LabelMediaInput>;
