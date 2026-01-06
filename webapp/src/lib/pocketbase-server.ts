/**
 * Server-side PocketBase client
 */
import 'server-only';

import PocketBase from 'pocketbase';
import type { TypedPocketBase } from '@project/shared/types';
import { env } from '@project/shared';

/**
 * Create a new PocketBase client for server-side usage.
 *
 * Use this in API routes or Server Actions to create a fresh instance
 * per request, avoiding auth state sharing between requests.
 *
 * @example
 * ```ts
 * // app/api/example/route.ts
 * import { createServerPocketBaseClient } from '@/lib/pocketbase-server';
 *
 * export async function GET() {
 *   const pb = createServerPocketBaseClient();
 *   // Use pb for this request only
 * }
 * ```
 */
export function createServerPocketBaseClient(): TypedPocketBase {
  const pb = new PocketBase(env.POCKETBASE_URL) as TypedPocketBase;
  pb.autoCancellation(false);
  return pb;
}
