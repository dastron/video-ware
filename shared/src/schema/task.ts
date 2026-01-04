import {
  defineCollection,
  TextField,
  NumberField,
  SelectField,
  RelationField,
  JSONField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { TaskStatus, TaskType, ProcessingProvider } from '../enums';

// Define the Zod schema
export const TaskSchema = z
  .object({
    sourceType: TextField(),
    sourceId: TextField(),
    type: TextField(),
    status: SelectField([
      TaskStatus.QUEUED,
      TaskStatus.RUNNING,
      TaskStatus.SUCCESS,
      TaskStatus.FAILED,
      TaskStatus.CANCELED,
    ]),
    progress: NumberField({ min: 0, max: 100 }).default(1),
    attempts: NumberField({ min: 0 }).default(1),
    payload: JSONField(),
    result: JSONField().optional(),
    errorLog: TextField().optional(),
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    MediaRef: RelationField({ collection: 'Media' }).optional(),
    UserRef: RelationField({ collection: 'Users' }).optional(),
    provider: SelectField([
      ProcessingProvider.FFMPEG,
      ProcessingProvider.GOOGLE_TRANSCODER,
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      ProcessingProvider.GOOGLE_SPEECH,
    ]).optional(),
    version: TextField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating tasks
export const TaskInputSchema = z.object({
  sourceType: TextField(),
  sourceId: TextField(),
  type: z.enum([
    TaskType.PROCESS_UPLOAD,
    TaskType.DERIVE_CLIPS,
    TaskType.DETECT_LABELS,
    TaskType.RECOMMEND_CLIPS,
    TaskType.RENDER_TIMELINE,
  ]),
  status: z
    .enum([
      TaskStatus.QUEUED,
      TaskStatus.RUNNING,
      TaskStatus.SUCCESS,
      TaskStatus.FAILED,
      TaskStatus.CANCELED,
    ])
    .default(TaskStatus.QUEUED),
  progress: NumberField({ min: 0, max: 100 }).default(1),
  attempts: NumberField({ min: 0 }).default(1),
  payload: JSONField(),
  result: JSONField().optional(),
  errorLog: TextField().optional(),
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  UploadRef: z.string().optional(),
  MediaRef: z.string().optional(),
  UserRef: z.string().optional(),
  provider: z
    .enum([
      ProcessingProvider.FFMPEG,
      ProcessingProvider.GOOGLE_TRANSCODER,
      ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE,
      ProcessingProvider.GOOGLE_SPEECH,
    ])
    .optional(),
  version: TextField().optional(),
});

// Define the collection with workspace-scoped permissions
export const TaskCollection = defineCollection({
  collectionName: 'Tasks',
  schema: TaskSchema,
  permissions: {
    // Authenticated users can list tasks
    listRule: '@request.auth.id != ""',
    // Authenticated users can view tasks
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create tasks
    createRule: '@request.auth.id != ""',
    // Authenticated users can update tasks
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete tasks
    deleteRule: '@request.auth.id != ""',
  },
});

export default TaskCollection;

// Export TypeScript types
export type Task = z.infer<typeof TaskSchema>;
export type TaskInput = z.infer<typeof TaskInputSchema>;
export type TaskUpdate = Partial<TaskInput>;
