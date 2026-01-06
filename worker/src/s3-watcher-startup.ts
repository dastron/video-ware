/**
 * S3 Watcher Startup - Initialize and start the S3 directory watcher
 *
 * This module handles the initialization of the S3 watcher service,
 * checking environment configuration and starting the watcher if enabled.
 */

import PocketBase from 'pocketbase';
import { loadWatcherConfig } from '@project/shared/config';
import { loadStorageConfig } from '@project/shared/config';
import { env } from '@project/shared/env';

import { type TypedPocketBase } from '@project/shared';
import { createStorageBackend } from '@project/shared/storage';
import { S3WatcherService } from './services/s3-watcher.js';

/**
 * Initialize PocketBase client for the watcher
 * Authenticates as superuser using admin credentials
 */
async function createWatcherPocketBase(): Promise<TypedPocketBase> {
  const pb = new PocketBase(env.POCKETBASE_URL) as TypedPocketBase;

  // Disable autoCancellation for server-side usage
  pb.autoCancellation(false);

  // Get admin credentials from environment
  const adminEmail = env.POCKETBASE_ADMIN_EMAIL;
  const adminPassword = env.POCKETBASE_ADMIN_PASSWORD;

  if (!adminEmail || !adminPassword) {
    throw new Error(
      'POCKETBASE_ADMIN_EMAIL and POCKETBASE_ADMIN_PASSWORD environment variables are required'
    );
  }

  // Authenticate as superuser
  await (pb as PocketBase)
    .collection('_superusers')
    .authWithPassword(adminEmail, adminPassword, {
      autoRefreshThreshold: 30 * 60, // Auto-refresh 30 minutes before expiry
    });

  return pb;
}

/**
 * Start the S3 watcher service if enabled
 */
export async function startS3Watcher(): Promise<void> {
  try {
    // Check if S3 watcher is enabled
    const watcherConfig = loadWatcherConfig();

    if (!watcherConfig || !watcherConfig.enabled) {
      console.log(
        '[S3Watcher] S3 watcher is disabled (ENABLE_S3_WATCHER != true)'
      );
      return;
    }

    console.log('[S3Watcher] S3 watcher is enabled, initializing...');

    // Load storage configuration
    const storageConfig = loadStorageConfig();

    // Validate that storage backend is S3
    if (storageConfig.type !== 's3') {
      console.warn(
        '[S3Watcher] S3 watcher enabled but storage backend is not S3. Watcher will not start.'
      );
      return;
    }

    // Create storage backend
    const storageBackend = await createStorageBackend(storageConfig);

    // Create PocketBase client
    const pb = await createWatcherPocketBase();

    // Create and start watcher service
    const watcher = new S3WatcherService(pb, watcherConfig, storageBackend);
    await watcher.start();

    console.log('[S3Watcher] S3 watcher started successfully');
  } catch (error) {
    console.error('[S3Watcher] Failed to start S3 watcher:', error);
    throw error;
  }
}
