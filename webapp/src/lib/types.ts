// Local TypeScript types for webapp
// These types use the webapp's PocketBase version to avoid type mismatches

import PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';
import type {
  Media,
  MediaClip,
  Task,
  Todo,
  Upload,
  User,
  Workspace,
  WorkspaceMember,
} from '@project/shared';

// Typed PocketBase interface using local PocketBase types
export interface TypedPocketBase extends PocketBase {
  collection(idOrName: 'Users'): RecordService<User>;
  collection(idOrName: 'Tasks'): RecordService<Task>;
  collection(idOrName: 'MediaClips'): RecordService<MediaClip>;
  collection(idOrName: 'Uploads'): RecordService<Upload>;
  collection(idOrName: 'Files'): RecordService<File>;
  collection(idOrName: 'Media'): RecordService<Media>;
  collection(idOrName: 'Workspaces'): RecordService<Workspace>;
  collection(idOrName: 'WorkspaceMembers'): RecordService<WorkspaceMember>;
  collection(idOrName: 'Todos'): RecordService<Todo>;
  // Add more collections as needed
}
