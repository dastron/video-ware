'use client';

import React, { useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { useWorkspace } from '@/hooks/use-workspace';
import { useUpload } from '@/hooks/use-upload';
import { useUploadQueue } from '@/hooks/use-upload-queue';
import { UploadProvider } from '@/contexts/upload-context';
import { UploadList } from '@/components/upload';
import { UploadDropzone } from '@/components/uploads/upload-dropzone';
import { UploadPanel } from '@/components/uploads/upload-panel';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, Upload as UploadIcon } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

function UploadsPageContent() {
  const { uploads, uploadProgress, isLoading, retryUpload, cancelUpload } =
    useUpload();
  const { currentWorkspace } = useWorkspace();
  const { actions } = useUploadQueue();

  // Handle files selected from dropzone
  const handleFilesSelected = useCallback(
    (files: File[]) => {
      if (currentWorkspace) {
        actions.addFiles(files, currentWorkspace.id);
      }
    },
    [currentWorkspace, actions]
  );

  if (!currentWorkspace) {
    return null;
  }

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      {/* Page Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-foreground mb-2">Uploads</h1>
        <p className="text-lg text-muted-foreground">
          Upload and manage your media files in {currentWorkspace.name}
        </p>
      </div>

      {/* Upload Section Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Left Column: File Uploader */}
        <div>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UploadIcon className="h-5 w-5" />
                Upload Files
              </CardTitle>
              <CardDescription>
                Drag and drop or browse to upload files
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UploadDropzone
                onFilesSelected={handleFilesSelected}
                accept={[
                  'video/mp4',
                  'video/webm',
                  'video/quicktime',
                  'video/x-msvideo',
                  'video/x-matroska',
                ]}
                maxSize={24 * 1024 * 1024 * 1024} // 24GB (chunked upload)
              />
            </CardContent>
          </Card>

          {/* Upload Info */}
          <Card className="mt-6">
            <CardHeader>
              <CardTitle className="text-sm">Upload Guidelines</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>
                <strong>Supported formats:</strong> MP4, WebM, QuickTime, AVI,
                MKV
              </p>
              <p>
                <strong>Maximum size:</strong> 24GB per file
              </p>
              <p>
                <strong>Multiple files:</strong> Upload multiple files
                simultaneously (max 3 concurrent)
              </p>
              <p>
                <strong>Processing:</strong> Files are automatically processed
                to generate thumbnails and previews
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Upload Queue and Completed Uploads */}
        <div className="space-y-6">
          {/* Upload Queue Panel */}
          <UploadPanel />

          {/* Completed Uploads */}
          <UploadList
            uploads={uploads}
            uploadProgress={uploadProgress}
            isLoading={isLoading}
            onRetry={retryUpload}
            onCancel={cancelUpload}
            title="Completed Uploads"
            description="Track the status of your uploaded files"
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="mt-8">
        <Card>
          <CardHeader>
            <CardTitle>What&apos;s Next?</CardTitle>
            <CardDescription>
              After your files are processed, you can view them in the media
              gallery
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/media">
              <Button>View Media Gallery</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function UploadsPage() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { currentWorkspace, isLoading: workspaceLoading } = useWorkspace();

  // Show loading state
  if (authLoading || workspaceLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Authentication Required</AlertTitle>
          <AlertDescription>
            Please{' '}
            <Link href="/login" className="underline">
              log in
            </Link>{' '}
            to access uploads.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  // Show workspace selection prompt if no workspace selected
  if (!currentWorkspace) {
    return (
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Workspace Required</AlertTitle>
          <AlertDescription>
            Please select a workspace from the navigation bar to upload files.
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <UploadProvider workspaceId={currentWorkspace.id}>
      <UploadsPageContent />
    </UploadProvider>
  );
}
