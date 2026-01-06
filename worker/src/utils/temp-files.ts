import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

/**
 * Temporary file management utility
 * Provides safe creation and cleanup of temporary directories for file processing
 */

/**
 * Create a temporary directory for a specific upload
 * @param uploadId - Upload ID to create temp directory for
 * @returns Path to the temporary directory
 */
export function createTempDir(uploadId: string): string {
  const tempPath = join(tmpdir(), 'video-editor-worker', uploadId);

  // Create directory if it doesn't exist
  if (!existsSync(tempPath)) {
    mkdirSync(tempPath, { recursive: true });
  }

  return tempPath;
}

/**
 * Clean up temporary directory for an upload
 * @param uploadId - Upload ID to clean up temp directory for
 */
export function cleanupTempDir(uploadId: string): void {
  const tempPath = join(tmpdir(), 'video-editor-worker', uploadId);

  if (existsSync(tempPath)) {
    try {
      rmSync(tempPath, { recursive: true, force: true });
      console.log(`[TempFiles] Cleaned up temp directory: ${tempPath}`);
    } catch (error) {
      console.error(
        `[TempFiles] Failed to clean up temp directory: ${tempPath}`,
        error
      );
      // Don't throw - cleanup failures shouldn't break the workflow
    }
  }
}

/**
 * Get a temporary file path within an upload's temp directory
 * @param uploadId - Upload ID
 * @param filename - Filename for the temp file
 * @returns Full path to the temporary file
 */
export function getTempFilePath(uploadId: string, filename: string): string {
  const tempDir = createTempDir(uploadId);
  return join(tempDir, filename);
}

/**
 * Clean up all temporary directories (useful for startup cleanup)
 */
export function cleanupAllTempDirs(): void {
  const baseTempPath = join(tmpdir(), 'video-editor-worker');

  if (existsSync(baseTempPath)) {
    try {
      rmSync(baseTempPath, { recursive: true, force: true });
      console.log(
        `[TempFiles] Cleaned up all temp directories: ${baseTempPath}`
      );
    } catch (error) {
      console.error(
        `[TempFiles] Failed to clean up all temp directories`,
        error
      );
    }
  }
}
