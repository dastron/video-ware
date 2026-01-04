// Local TypeScript types for webapp
// These types use the webapp's PocketBase version to avoid type mismatches

import PocketBase from 'pocketbase';
import type { RecordService } from 'pocketbase';
import type { User, Todo } from '@project/shared';

// Typed PocketBase interface using local PocketBase types
export interface TypedPocketBase extends PocketBase {
  collection(idOrName: 'Users' | 'users'): RecordService<User>;
  collection(idOrName: 'Todos' | 'todos'): RecordService<Todo>;
  // Add more collections as needed
}
