// Shared TypeScript types

import PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';
import type { User } from '../schema/user';
import type { Task } from '../schema/task';
import type { MediaClip } from '../schema/media-clip';
import type { Upload } from '../schema/upload';
import type { File } from '../schema/file';
import type { Media } from '../schema/media';
import type { Workspace } from '../schema/workspace';
import type { WorkspaceMember } from '../schema/workspace-member';
import type { Todo } from '../schema/todo';
import type { Timeline } from '../schema/timeline';
import type { TimelineClip } from '../schema/timeline-clip';
import type { TimelineRender } from '../schema/timeline-render';
import type { WatchedFile } from '../schema/watched-file';
import { MediaLabel } from '../schema/media-label';

export * from './video-ware.js';
export * from './task-contracts.js';
export * from './processor.js';

// Typed PocketBase interface
export interface TypedPocketBase extends PocketBase {
  collection(idOrName: 'Files'): RecordService<File>;
  collection(idOrName: 'Media'): RecordService<Media>;
  collection(idOrName: 'MediaClips'): RecordService<MediaClip>;
  collection(idOrName: 'MediaLabels'): RecordService<MediaLabel>;
  collection(idOrName: 'Tasks'): RecordService<Task>;
  collection(idOrName: 'TimelineClips'): RecordService<TimelineClip>;
  collection(idOrName: 'TimelineRenders'): RecordService<TimelineRender>;
  collection(idOrName: 'Timelines'): RecordService<Timeline>;
  collection(idOrName: 'Todos'): RecordService<Todo>;
  collection(idOrName: 'Uploads'): RecordService<Upload>;
  collection(idOrName: 'Users'): RecordService<User>;
  collection(idOrName: 'WatchedFiles'): RecordService<WatchedFile>;
  collection(idOrName: 'WorkspaceMembers'): RecordService<WorkspaceMember>;
  collection(idOrName: 'Workspaces'): RecordService<Workspace>;
}

// PocketBase response types
export interface PocketBaseResponse<T = Record<string, unknown>> {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: T[];
}

// API response types
export interface ApiResponse<T = Record<string, unknown>> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Common utility types
export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;
export type RequiredFields<T, K extends keyof T> = T & Required<Pick<T, K>>;
