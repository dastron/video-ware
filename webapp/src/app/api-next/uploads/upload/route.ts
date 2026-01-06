import 'server-only';

import PocketBase from 'pocketbase';
import { NextResponse } from 'next/server';

import {
  createServerPocketBaseClient,
  authenticateAsUser,
} from '@/lib/pocketbase-server';
import {
  createStorageBackend,
  generateStoragePath,
} from '@project/shared/storage';
import { loadStorageConfig } from '@project/shared/config';
import {
  UploadStatus,
  ProcessingProvider,
  StorageBackendType,
  type ProcessUploadPayload,
} from '@project/shared';
import { UploadMutator, TaskMutator } from '@project/shared/mutator';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streaming upload handler (recommended for large files).
 *
 * Uses a raw request body (ReadableStream) to avoid buffering multipart form data in memory.
 *
 * Required headers:
 * - x-upload-id
 * - x-workspace-id
 * - x-user-id
 * - x-file-name
 *
 * Optional:
 * - content-length
 * - content-type
 */
export async function PUT(req: Request) {
  let pb: PocketBase | null = null;
  let uploadMutator: UploadMutator | null = null;
  let uploadId: string | null = null;

  try {
    const uploadIdHeader = req.headers.get('x-upload-id');
    const workspaceIdHeader = req.headers.get('x-workspace-id');
    const userIdHeader = req.headers.get('x-user-id');
    const fileNameHeader = req.headers.get('x-file-name');

    uploadId = String(uploadIdHeader || '').trim();
    const workspaceId = String(workspaceIdHeader || '').trim();
    const userId = String(userIdHeader || '').trim();
    const fileName = String(fileNameHeader || '').trim();

    if (!uploadId || !workspaceId || !userId || !fileName) {
      return NextResponse.json(
        {
          error:
            'Missing required headers: x-upload-id, x-workspace-id, x-user-id, x-file-name',
        },
        { status: 400 }
      );
    }

    if (!req.body) {
      return NextResponse.json(
        { error: 'Missing request body' },
        { status: 400 }
      );
    }

    const contentLengthHeader = req.headers.get('content-length');
    const declaredSize = contentLengthHeader
      ? Number(contentLengthHeader)
      : undefined;

    // Server-side PocketBase client (authenticate as the requesting user)
    pb = createServerPocketBaseClient();
    try {
      await authenticateAsUser(pb, req);
    } catch (authError) {
      const message =
        authError instanceof Error
          ? authError.message
          : 'Authentication failed';
      return NextResponse.json({ error: message }, { status: 401 });
    }

    uploadMutator = new UploadMutator(pb);
    const taskMutator = new TaskMutator(pb);

    const upload = await uploadMutator.getById(uploadId);
    if (!upload) {
      return NextResponse.json(
        { error: `Upload not found: ${uploadId}` },
        { status: 404 }
      );
    }

    if (
      upload.status !== UploadStatus.QUEUED &&
      upload.status !== UploadStatus.UPLOADING
    ) {
      return NextResponse.json(
        {
          error: `Upload is not in a valid state for upload. Current status: ${upload.status}`,
        },
        { status: 400 }
      );
    }

    if (upload.WorkspaceRef !== workspaceId) {
      return NextResponse.json(
        { error: 'Workspace mismatch' },
        { status: 403 }
      );
    }

    try {
      await uploadMutator.updateStatus(uploadId, UploadStatus.UPLOADING);
    } catch (statusError) {
      console.error(
        'Failed to update upload status to UPLOADING:',
        statusError
      );
    }

    // Initialize storage backend from env (local or s3)
    const storageConfig = loadStorageConfig();
    const storage = await createStorageBackend(storageConfig);

    const extension = fileName.split('.').pop() || 'bin';
    const storagePath = generateStoragePath(workspaceId, uploadId, extension);

    // Stream upload directly to storage
    await storage.upload(req.body, storagePath);

    const storageMetadata: Record<string, unknown> = {
      type: storageConfig.type,
    };
    if (storageConfig.type === StorageBackendType.S3 && storageConfig.s3) {
      storageMetadata.bucket = storageConfig.s3.bucket;
      storageMetadata.region = storageConfig.s3.region;
      storageMetadata.endpoint = storageConfig.s3.endpoint;
    }

    const bytesUploaded =
      typeof declaredSize === 'number' && Number.isFinite(declaredSize)
        ? declaredSize
        : upload.size || 0;

    const updatedUpload = await uploadMutator.update(uploadId, {
      status: UploadStatus.UPLOADED,
      storageBackend: storageConfig.type,
      externalPath: storagePath,
      storageConfig: storageMetadata,
      bytesUploaded,
      name: fileName,
    });

    // Best-effort enqueue processing task
    try {
      const payload: ProcessUploadPayload = {
        uploadId,
        originalFileRef: uploadId, // resolved by worker
        provider: ProcessingProvider.FFMPEG,
        sprite: {
          fps: 1,
          cols: 10,
          rows: 10,
          tileWidth: 320,
          tileHeight: 180,
        },
        thumbnail: {
          timestamp: 'midpoint',
          width: 640,
          height: 360,
        },
        transcode: {
          enabled: true,
          codec: 'h265',
          resolution: '720p',
        },
      };

      await taskMutator.createProcessUploadTask(
        workspaceId,
        userId,
        uploadId,
        payload
      );
    } catch (taskError) {
      console.error('Failed to enqueue processing task:', taskError);
    }

    return NextResponse.json({ upload: updatedUpload });
  } catch (error) {
    if (uploadMutator && uploadId) {
      try {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        await uploadMutator.updateStatus(
          uploadId,
          UploadStatus.FAILED,
          `Upload failed: ${errorMessage}`
        );
      } catch {
        // ignore
      }
    }

    console.error('Upload route error:', error);
    const message =
      error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let pb: PocketBase | null = null;
  let uploadMutator: UploadMutator | null = null;
  let uploadId: string | null = null;

  try {
    // NOTE: For large files, prefer PUT (streaming) to avoid buffering the entire request.
    const form = await req.formData();

    uploadId = String(form.get('uploadId') || '').trim();
    const workspaceId = String(form.get('workspaceId') || '').trim();
    const userId = String(form.get('userId') || '').trim();
    const file = form.get('file');

    // Validate required fields
    if (!uploadId || !workspaceId || !userId) {
      return NextResponse.json(
        { error: 'Missing required fields: uploadId, workspaceId, or userId' },
        { status: 400 }
      );
    }

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: 'Missing or invalid file' },
        { status: 400 }
      );
    }

    // Validate file size (basic check - should match client validation)
    if (file.size === 0) {
      return NextResponse.json({ error: 'File is empty' }, { status: 400 });
    }

    // Server-side PocketBase client (authenticate as the requesting user)
    pb = createServerPocketBaseClient();
    try {
      await authenticateAsUser(pb, req);
    } catch (authError) {
      const message =
        authError instanceof Error
          ? authError.message
          : 'Authentication failed';
      return NextResponse.json({ error: message }, { status: 401 });
    }

    uploadMutator = new UploadMutator(pb);
    const taskMutator = new TaskMutator(pb);

    // Ensure upload exists and is in a valid state
    const upload = await uploadMutator.getById(uploadId);
    if (!upload) {
      return NextResponse.json(
        { error: `Upload not found: ${uploadId}` },
        { status: 404 }
      );
    }

    // Validate upload is in a state that allows uploading
    if (
      upload.status !== UploadStatus.QUEUED &&
      upload.status !== UploadStatus.UPLOADING
    ) {
      return NextResponse.json(
        {
          error: `Upload is not in a valid state for upload. Current status: ${upload.status}`,
        },
        { status: 400 }
      );
    }

    // Validate workspace matches
    if (upload.WorkspaceRef !== workspaceId) {
      return NextResponse.json(
        { error: 'Workspace mismatch' },
        { status: 403 }
      );
    }

    // Best-effort: move to uploading before storage op
    try {
      await uploadMutator.updateStatus(uploadId, UploadStatus.UPLOADING);
    } catch (statusError) {
      console.error(
        'Failed to update upload status to UPLOADING:',
        statusError
      );
      // Continue anyway - this is best-effort
    }

    // Initialize storage backend from env (local or s3)
    let storageConfig;
    let storage;
    try {
      storageConfig = loadStorageConfig();
      storage = await createStorageBackend(storageConfig);
    } catch (storageInitError) {
      const errorMessage =
        storageInitError instanceof Error
          ? storageInitError.message
          : 'Failed to initialize storage backend';

      // Mark upload as failed
      if (uploadMutator && uploadId) {
        try {
          await uploadMutator.updateStatus(
            uploadId,
            UploadStatus.FAILED,
            `Storage initialization failed: ${errorMessage}`
          );
        } catch {
          // Ignore errors when updating status
        }
      }

      return NextResponse.json(
        { error: `Storage initialization failed: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Generate storage key/path
    const extension = file.name.split('.').pop() || 'bin';
    const storagePath = generateStoragePath(workspaceId, uploadId, extension);

    // Upload file to storage
    try {
      await storage.upload(file, storagePath);
    } catch (uploadError) {
      const errorMessage =
        uploadError instanceof Error
          ? uploadError.message
          : 'Failed to upload file to storage';

      // Mark upload as failed
      if (uploadMutator && uploadId) {
        try {
          await uploadMutator.updateStatus(
            uploadId,
            UploadStatus.FAILED,
            `Storage upload failed: ${errorMessage}`
          );
        } catch {
          // Ignore errors when updating status
        }
      }

      return NextResponse.json(
        { error: `File upload failed: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Persist storage metadata onto Upload record
    const storageMetadata: Record<string, unknown> = {
      type: storageConfig.type,
    };
    if (storageConfig.type === StorageBackendType.S3 && storageConfig.s3) {
      storageMetadata.bucket = storageConfig.s3.bucket;
      storageMetadata.region = storageConfig.s3.region;
      storageMetadata.endpoint = storageConfig.s3.endpoint;
    }

    let updatedUpload;
    try {
      updatedUpload = await uploadMutator.update(uploadId, {
        status: UploadStatus.UPLOADED,
        storageBackend: storageConfig.type,
        externalPath: storagePath,
        storageConfig: storageMetadata,
        bytesUploaded: file.size,
      });
    } catch (updateError) {
      const errorMessage =
        updateError instanceof Error
          ? updateError.message
          : 'Failed to update upload record';

      // Try to mark as failed
      try {
        await uploadMutator.updateStatus(
          uploadId,
          UploadStatus.FAILED,
          `Failed to update upload record: ${errorMessage}`
        );
      } catch {
        // Ignore errors when updating status
      }

      return NextResponse.json(
        { error: `Failed to update upload record: ${errorMessage}` },
        { status: 500 }
      );
    }

    // Enqueue processing task (same defaults as the client UploadService)
    // This is best-effort - if it fails, the upload is still successful
    try {
      const payload: ProcessUploadPayload = {
        uploadId,
        originalFileRef: uploadId, // resolved by worker
        provider: ProcessingProvider.FFMPEG,
        sprite: {
          fps: 1,
          cols: 10,
          rows: 10,
          tileWidth: 320,
          tileHeight: 180,
        },
        thumbnail: {
          timestamp: 'midpoint',
          width: 640,
          height: 360,
        },
        transcode: {
          enabled: true,
          codec: 'h265',
          resolution: '720p',
        },
      };

      await taskMutator.createProcessUploadTask(
        workspaceId,
        userId,
        uploadId,
        payload
      );
    } catch (taskError) {
      // Log but don't fail the upload - processing can be retried
      console.error('Failed to enqueue processing task:', taskError);
    }

    return NextResponse.json({ upload: updatedUpload });
  } catch (error) {
    // Generic error handler - mark upload as failed if we have the ID
    if (uploadMutator && uploadId) {
      try {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error occurred';
        await uploadMutator.updateStatus(
          uploadId,
          UploadStatus.FAILED,
          `Upload failed: ${errorMessage}`
        );
      } catch {
        // Ignore errors when updating status
      }
    }

    const message =
      error instanceof Error ? error.message : 'Internal server error';
    console.error('Upload route error:', error);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
