import {
  defineCollection,
  TextField,
  NumberField,
  RelationField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';

// Zod schema for EditListEntry validation (types are in types/video-ware.ts)
export const TimeOffsetSchema = z.object({
  seconds: z.number().int().min(0),
  nanos: z.number().int().min(0).max(999999999),
});

export const EditListEntrySchema = z.object({
  key: z.string(),
  inputs: z.array(z.string()),
  startTimeOffset: TimeOffsetSchema,
  endTimeOffset: TimeOffsetSchema,
});

// Define the Zod schema
export const TimelineSchema = z
  .object({
    name: TextField().min(1).max(200),
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    duration: NumberField({ min: 0 }).default(0), // computed total duration in seconds
    version: NumberField({ min: 1 }).default(1),
    editList: JSONField().optional(), // EditList snapshot for rendering
    UserRef: RelationField({ collection: 'Users' }).optional(),
  })
  .extend(baseSchema);

// Define input schema for creating timelines
export const TimelineInputSchema = z.object({
  name: z.string().min(1).max(200),
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  duration: z.number().min(0).default(0),
  version: z.number().min(1).default(1),
  editList: z.array(EditListEntrySchema).optional(),
  UserRef: z.string().optional(),
});

// Define the collection with workspace-scoped permissions
export const TimelineCollection = defineCollection({
  collectionName: 'Timelines',
  schema: TimelineSchema,
  permissions: {
    // Authenticated users can list timelines
    listRule: '@request.auth.id != ""',
    // Authenticated users can view timelines
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create timelines
    createRule: '@request.auth.id != ""',
    // Authenticated users can update timelines
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete timelines
    deleteRule: '@request.auth.id != ""',
  },
});

export default TimelineCollection;

// Export TypeScript types
export type Timeline = z.infer<typeof TimelineSchema>;
export type TimelineInput = z.infer<typeof TimelineInputSchema>;
export type TimelineUpdate = Partial<TimelineInput>;
