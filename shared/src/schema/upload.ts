import {
  defineCollection,
  TextField,
  NumberField,
  SelectField,
  FileField,
  RelationField,
  baseSchema,
} from 'pocketbase-zod-schema/schema';
import { z } from 'zod';
import { UploadStatus } from '../enums';

// Define the Zod schema
export const UploadSchema = z
  .object({
    name: TextField().min(1, 'Name is required').max(255, 'Name too long'),
    size: NumberField({ required: true }).min(0, 'Size must be greater than 0'),
    status: SelectField([
      UploadStatus.QUEUED,
      UploadStatus.UPLOADING,
      UploadStatus.UPLOADED,
      UploadStatus.PROCESSING,
      UploadStatus.READY,
      UploadStatus.FAILED,
    ]),
    originalFile: FileField({ maxSize: 700000000 }).optional(),
    WorkspaceRef: RelationField({ collection: 'Workspaces' }),
    UserRef: RelationField({ collection: 'Users' }).optional(),
    errorMessage: TextField().optional(),
  })
  .extend(baseSchema);

// Define input schema for creating uploads
export const UploadInputSchema = z.object({
  name: TextField({ min: 1, max: 255 }),
  size: NumberField({ min: 0 }),
  status: z
    .enum([
      UploadStatus.QUEUED,
      UploadStatus.UPLOADING,
      UploadStatus.UPLOADED,
      UploadStatus.PROCESSING,
      UploadStatus.READY,
      UploadStatus.FAILED,
    ])
    .default(UploadStatus.UPLOADING),
  WorkspaceRef: z.string().min(1, 'Workspace is required'),
  UserRef: z.string().optional(),
  errorMessage: TextField().optional(),
});

// Define the collection with workspace-scoped permissions
export const UploadCollection = defineCollection({
  collectionName: 'Uploads',
  schema: UploadSchema,
  permissions: {
    // Authenticated users can list uploads
    listRule: '@request.auth.id != ""',
    // Authenticated users can view uploads
    viewRule: '@request.auth.id != ""',
    // Authenticated users can create uploads
    createRule: '@request.auth.id != ""',
    // Authenticated users can update uploads
    updateRule: '@request.auth.id != ""',
    // Authenticated users can delete uploads
    deleteRule: '@request.auth.id != ""',
  },
});

export default UploadCollection;

// Export TypeScript types
export type Upload = z.infer<typeof UploadSchema>;
export type UploadInput = z.infer<typeof UploadInputSchema>;
export type UploadUpdate = Partial<UploadInput>;
