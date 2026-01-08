import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fc from 'fast-check';

import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';

import { TranscodeService } from '../transcode.service';
import { PocketBaseService } from '../../shared/services/pocketbase.service';
import { StorageService } from '../../shared/services/storage.service';
import { FFmpegStrategy } from '../strategies/ffmpeg.strategy';
import { GoogleTranscoderStrategy } from '../strategies/google-transcoder.strategy';

import type { Task, ProcessUploadPayload } from '@project/shared';
import {
  TaskType,
  TaskStatus,
  ProcessingProvider,
  FileType,
} from '@project/shared';

// Mock NestJS Logger to suppress console output during tests
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual('@nestjs/common');
  const { MockLogger } = await import('@/__mocks__/logger');
  return {
    ...actual,
    Logger: MockLogger,
  };
});

vi.mock('fs', () => ({
  promises: {
    stat: vi.fn(),
    unlink: vi.fn(),
  },
  existsSync: vi.fn(),
}));

describe('TranscodeService', () => {
  let service: TranscodeService;
  let configService: Pick<ConfigService, 'get'>;
  let pocketbaseService: Pick<
    PocketBaseService,
    | 'uploadMutator'
    | 'mediaMutator'
    | 'fileMutator'
    | 'createFileWithUpload'
    | 'createMedia'
  >;
  let storageService: Pick<
    StorageService,
    'resolveFilePath' | 'uploadFromPath' | 'generateDerivedPath' | 'cleanupTemp'
  >;
  let ffmpegStrategy: Pick<FFmpegStrategy, 'process'>;
  let googleTranscoderStrategy: Pick<GoogleTranscoderStrategy, 'process'>;

  beforeEach(async () => {
    // Create mock services
    configService = {
      get: vi.fn(),
    } as unknown as Pick<ConfigService, 'get'>;

    pocketbaseService = {
      uploadMutator: {
        getById: vi.fn(),
      },
      mediaMutator: {
        getByUpload: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      fileMutator: {
        getByUpload: vi.fn(),
      },
      createFileWithUpload: vi.fn(),
      createMedia: vi.fn(),
    } as unknown as Pick<
      PocketBaseService,
      | 'uploadMutator'
      | 'mediaMutator'
      | 'fileMutator'
      | 'createFileWithUpload'
      | 'createMedia'
    >;

    storageService = {
      resolveFilePath: vi.fn(),
      uploadFromPath: vi.fn(),
      generateDerivedPath: vi.fn(),
      cleanupTemp: vi.fn(),
    } as unknown as Pick<
      StorageService,
      'resolveFilePath' | 'uploadFromPath' | 'generateDerivedPath' | 'cleanupTemp'
    >;

    ffmpegStrategy = {
      process: vi.fn(),
    } as unknown as Pick<FFmpegStrategy, 'process'>;

    googleTranscoderStrategy = {
      process: vi.fn(),
    } as unknown as Pick<GoogleTranscoderStrategy, 'process'>;

    // Directly instantiate the service with mocked dependencies
    service = new TranscodeService(
      configService as unknown as ConfigService,
      pocketbaseService as unknown as PocketBaseService,
      storageService as unknown as StorageService,
      ffmpegStrategy as unknown as FFmpegStrategy,
      googleTranscoderStrategy as unknown as GoogleTranscoderStrategy,
    );

    // Reset mocks
    vi.clearAllMocks();

    // Default fs behavior for getFileSize + cleanup
    (fs.existsSync as any).mockReturnValue(true);
    (fs.promises.stat as any).mockResolvedValue({ size: 1024 });
    (fs.promises.unlink as any).mockResolvedValue(undefined);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
    expect(pocketbaseService).toBeDefined();
    expect(pocketbaseService.uploadMutator).toBeDefined();
  });

  describe('processTask', () => {
    it('should skip processing if media already exists (idempotency)', async () => {
      // Arrange
      const task: Task = {
        id: 'task-1',
        type: TaskType.PROCESS_UPLOAD,
        sourceType: 'upload',
        sourceId: 'upload-1',
        status: TaskStatus.QUEUED,
        progress: 0,
        attempts: 1,
        priority: 0,
        payload: {
          uploadId: 'upload-1',
          transcode: { enabled: true },
        } as ProcessUploadPayload,
        WorkspaceRef: 'workspace-1',
        UserRef: 'user-1',
        created: '2023-01-01T00:00:00Z',
        updated: '2023-01-01T00:00:00Z',
        collectionId: 'tasks',
        collectionName: 'Tasks',
        expand: {},
      };

      const upload = {
        id: 'upload-1',
        name: 'test.mp4',
        WorkspaceRef: 'workspace-1',
        externalPath: 'uploads/test.mp4',
        storageBackend: 'local',
      };

      const existingMedia = {
        id: 'media-1',
        thumbnailFileRef: 'file-1',
        spriteFileRef: 'file-2',
        proxyFileRef: 'file-3',
        version: 1,
        mediaData: { probeOutput: {} },
      };

      vi.mocked(pocketbaseService.uploadMutator.getById as any).mockResolvedValue(upload);
      vi.mocked(pocketbaseService.mediaMutator.getByUpload as any).mockResolvedValue(existingMedia);

      const progressCallback = vi.fn();

      // Act
      const result = await service.processTask(task, progressCallback);

      // Assert
      expect(result).toEqual({
        mediaId: existingMedia.id,
        thumbnailFileId: existingMedia.thumbnailFileRef,
        spriteFileId: existingMedia.spriteFileRef,
        proxyFileId: existingMedia.proxyFileRef,
        processorVersion: undefined,
      });

      // Verify no processing was done
      expect(ffmpegStrategy.process).not.toHaveBeenCalled();
      expect(googleTranscoderStrategy.process).not.toHaveBeenCalled();
    });

    it('should select FFmpeg strategy by default', async () => {
      // Arrange
      const task: Task = {
        id: 'task-1',
        type: TaskType.PROCESS_UPLOAD,
        sourceType: 'upload',
        sourceId: 'upload-1',
        status: TaskStatus.QUEUED,
        progress: 0,
        attempts: 1,
        priority: 0,
        payload: {
          uploadId: 'upload-1',
        } as ProcessUploadPayload,
        WorkspaceRef: 'workspace-1',
        UserRef: 'user-1',
        created: '2023-01-01T00:00:00Z',
        updated: '2023-01-01T00:00:00Z',
        collectionId: 'tasks',
        collectionName: 'Tasks',
        expand: {},
      };

      const upload = {
        id: 'upload-1',
        name: 'test.mp4',
        WorkspaceRef: 'workspace-1',
        externalPath: 'uploads/test.mp4',
        storageBackend: 'local',
      };

      const strategyResult = {
        thumbnailPath: '/tmp/thumb.jpg',
        spritePath: '/tmp/sprite.jpg',
        probeOutput: {
          duration: 60,
          width: 1920,
          height: 1080,
          codec: 'h264',
          fps: 30,
        },
      };

      vi.mocked(pocketbaseService.uploadMutator.getById as any).mockResolvedValue(upload);
      vi.mocked(pocketbaseService.mediaMutator.getByUpload as any).mockResolvedValue(null);
      vi.mocked(pocketbaseService.fileMutator.getByUpload as any).mockResolvedValue({ items: [] });
      vi.mocked(storageService.resolveFilePath as any).mockResolvedValue('/tmp/input.mp4');
      vi.mocked(ffmpegStrategy.process as any).mockResolvedValue(strategyResult);
      vi.mocked(configService.get as any).mockReturnValue(false); // Google Transcoder disabled

      // Mock file operations
      (pocketbaseService.createFileWithUpload as any) = vi.fn()
        .mockResolvedValueOnce({ id: 'file-1' })
        .mockResolvedValueOnce({ id: 'file-2' });
      vi.mocked(pocketbaseService.createMedia as any).mockResolvedValue({ 
        id: 'media-1',
        thumbnailFileRef: 'file-1',
        spriteFileRef: 'file-2',
      });

      const progressCallback = vi.fn();

      // Act
      await service.processTask(task, progressCallback);

      // Assert
      expect(ffmpegStrategy.process).toHaveBeenCalledWith(
        '/tmp/input.mp4',
        task.payload,
        expect.any(Function)
      );
      expect(googleTranscoderStrategy.process).not.toHaveBeenCalled();
    });

    it('should select Google Transcoder strategy when specified and enabled', async () => {
      // Arrange
      const task: Task = {
        id: 'task-1',
        type: TaskType.PROCESS_UPLOAD,
        sourceType: 'upload',
        sourceId: 'upload-1',
        status: TaskStatus.QUEUED,
        progress: 0,
        attempts: 1,
        priority: 0,
        payload: {
          uploadId: 'upload-1',
          provider: ProcessingProvider.GOOGLE_TRANSCODER,
        } as ProcessUploadPayload,
        WorkspaceRef: 'workspace-1',
        UserRef: 'user-1',
        created: '2023-01-01T00:00:00Z',
        updated: '2023-01-01T00:00:00Z',
        collectionId: 'tasks',
        collectionName: 'Tasks',
        expand: {},
      };

      const upload = {
        id: 'upload-1',
        name: 'test.mp4',
        WorkspaceRef: 'workspace-1',
        externalPath: 'uploads/test.mp4',
        storageBackend: 'local',
      };

      const strategyResult = {
        thumbnailPath: '/tmp/thumb.jpg',
        spritePath: '/tmp/sprite.jpg',
        probeOutput: {
          duration: 60,
          width: 1920,
          height: 1080,
          codec: 'h264',
          fps: 30,
        },
      };

      vi.mocked(pocketbaseService.uploadMutator.getById as any).mockResolvedValue(upload);
      vi.mocked(pocketbaseService.mediaMutator.getByUpload as any).mockResolvedValue(null);
      vi.mocked(pocketbaseService.fileMutator.getByUpload as any).mockResolvedValue({ items: [] });
      vi.mocked(storageService.resolveFilePath as any).mockResolvedValue('/tmp/input.mp4');
      vi.mocked(googleTranscoderStrategy.process as any).mockResolvedValue(strategyResult);
      vi.mocked(configService.get as any).mockImplementation((key: string) => {
        if (key === 'processors.enableGoogleTranscoder') return true;
        return false;
      });

      // Mock file operations
      (pocketbaseService.createFileWithUpload as any) = vi.fn()
        .mockResolvedValueOnce({ id: 'file-1' })
        .mockResolvedValueOnce({ id: 'file-2' });
      vi.mocked(pocketbaseService.createMedia as any).mockResolvedValue({ 
        id: 'media-1',
        thumbnailFileRef: 'file-1',
        spriteFileRef: 'file-2',
      });

      const progressCallback = vi.fn();

      // Act
      await service.processTask(task, progressCallback);

      // Assert
      expect(googleTranscoderStrategy.process).toHaveBeenCalledWith(
        '/tmp/input.mp4',
        task.payload,
        expect.any(Function)
      );
      expect(ffmpegStrategy.process).not.toHaveBeenCalled();
    });

    it('should handle errors and throw them', async () => {
      // Arrange
      const task: Task = {
        id: 'task-1',
        type: TaskType.PROCESS_UPLOAD,
        sourceType: 'upload',
        sourceId: 'upload-1',
        status: TaskStatus.QUEUED,
        progress: 0,
        attempts: 1,
        priority: 0,
        payload: {
          uploadId: 'upload-1',
        } as ProcessUploadPayload,
        WorkspaceRef: 'workspace-1',
        UserRef: 'user-1',
        created: '2023-01-01T00:00:00Z',
        updated: '2023-01-01T00:00:00Z',
        collectionId: 'tasks',
        collectionName: 'Tasks',
        expand: {},
      };

      vi.mocked(pocketbaseService.uploadMutator.getById as any).mockRejectedValue(new Error('Upload not found'));

      const progressCallback = vi.fn();

      // Act & Assert
      await expect(service.processTask(task, progressCallback)).rejects.toThrow('Upload not found');
    });

    it('should handle missing upload', async () => {
      // Arrange
      const task: Task = {
        id: 'task-1',
        type: TaskType.PROCESS_UPLOAD,
        sourceType: 'upload',
        sourceId: 'upload-1',
        status: TaskStatus.QUEUED,
        progress: 0,
        attempts: 1,
        priority: 0,
        payload: {
          uploadId: 'upload-1',
        } as ProcessUploadPayload,
        WorkspaceRef: 'workspace-1',
        UserRef: 'user-1',
        created: '2023-01-01T00:00:00Z',
        updated: '2023-01-01T00:00:00Z',
        collectionId: 'tasks',
        collectionName: 'Tasks',
        expand: {},
      };

      vi.mocked(pocketbaseService.uploadMutator.getById as any).mockResolvedValue(null);

      const progressCallback = vi.fn();

      // Act & Assert
      await expect(service.processTask(task, progressCallback)).rejects.toThrow('Upload upload-1 not found');
    });
  });

  describe('Property 7: Transcode Output Generation', () => {
    /**
     * Property: For any transcode task with valid input, the system should generate 
     * all required outputs: thumbnail, sprite sheet, and (if enabled) proxy video.
     *
     * Validates: Requirements 9.2
     */
    it('should generate all required outputs for any valid transcode configuration', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            uploadId: fc.string({ minLength: 1 }),
            provider: fc.option(
              fc.constantFrom(
                ProcessingProvider.FFMPEG,
                ProcessingProvider.GOOGLE_TRANSCODER,
              ),
            ),
            sprite: fc.option(fc.record({
              fps: fc.integer({ min: 1, max: 10 }),
              cols: fc.integer({ min: 1, max: 10 }),
              rows: fc.integer({ min: 1, max: 10 }),
              tileWidth: fc.integer({ min: 64, max: 512 }),
              tileHeight: fc.integer({ min: 64, max: 512 }),
            })),
            thumbnail: fc.option(fc.record({
              timestamp: fc.oneof(fc.integer({ min: 0, max: 3600 }), fc.constant('midpoint')),
              width: fc.integer({ min: 64, max: 1920 }),
              height: fc.integer({ min: 64, max: 1080 }),
            })),
            transcode: fc.option(fc.record({
              enabled: fc.boolean(),
              codec: fc.constantFrom('h264', 'h265', 'vp9'),
              resolution: fc.constantFrom('720p', '1080p', 'original'),
              bitrate: fc.option(fc.integer({ min: 500000, max: 10000000 })),
            })),
          }),
          async (payload) => {
            // Reset mocks for each property test iteration
            vi.clearAllMocks();

            const task: Task = {
              id: `task-${payload.uploadId}`,
              type: TaskType.PROCESS_UPLOAD,
              sourceType: 'upload',
              sourceId: payload.uploadId,
              status: TaskStatus.QUEUED,
              progress: 0,
              attempts: 1,
              priority: 0,
              payload,
              WorkspaceRef: 'workspace-1',
              UserRef: 'user-1',
              created: '2023-01-01T00:00:00Z',
              updated: '2023-01-01T00:00:00Z',
              collectionId: 'tasks',
              collectionName: 'Tasks',
              expand: {},
            };

            const upload = {
              id: payload.uploadId,
              name: 'test.mp4',
              WorkspaceRef: 'workspace-1',
              externalPath: `uploads/${payload.uploadId}.mp4`,
              storageBackend: 'local',
            };

            const strategyResult = {
              thumbnailPath: `/tmp/thumb-${payload.uploadId}.jpg`,
              spritePath: `/tmp/sprite-${payload.uploadId}.jpg`,
              proxyPath: payload.transcode?.enabled ? `/tmp/proxy-${payload.uploadId}.mp4` : undefined,
              probeOutput: {
                duration: 60,
                width: 1920,
                height: 1080,
                codec: 'h264',
                fps: 30,
              },
            };

            // Mock service responses
            vi.mocked(pocketbaseService.uploadMutator.getById as any).mockResolvedValue(upload);
            vi.mocked(pocketbaseService.mediaMutator.getByUpload as any).mockResolvedValue(null); // No existing media
            vi.mocked(pocketbaseService.fileMutator.getByUpload as any).mockResolvedValue({ items: [] });
            vi.mocked(storageService.resolveFilePath as any).mockResolvedValue(`/tmp/input-${payload.uploadId}.mp4`);
            
            // Mock strategy selection
            const isGoogleTranscoder = payload.provider === ProcessingProvider.GOOGLE_TRANSCODER;
            vi.mocked(configService.get as any).mockImplementation((key: string) => {
              if (key === 'processors.enableGoogleTranscoder') return isGoogleTranscoder;
              return false;
            });

            if (isGoogleTranscoder) {
              vi.mocked(googleTranscoderStrategy.process as any).mockResolvedValue(strategyResult);
            } else {
              vi.mocked(ffmpegStrategy.process as any).mockResolvedValue(strategyResult);
            }

            // Mock file operations
            let fileCreateCallCount = 0;
            vi.mocked(pocketbaseService.createFileWithUpload as any).mockImplementation(() => {
              fileCreateCallCount++;
              return Promise.resolve({ id: `file-${fileCreateCallCount}` });
            });

            vi.mocked(pocketbaseService.createMedia as any).mockResolvedValue({ 
              id: `media-${payload.uploadId}`,
              thumbnailFileRef: 'file-1',
              spriteFileRef: 'file-2',
              proxyFileRef: payload.transcode?.enabled ? 'file-3' : undefined,
            });

            const progressCallback = vi.fn();

            // Act
            const result = await service.processTask(task, progressCallback);

            // Assert - Verify all required outputs are generated
            expect(result).toBeDefined();
            expect(result.mediaId).toBe(`media-${payload.uploadId}`);
            
            // Thumbnail should always be generated
            expect(result.thumbnailFileId).toBe('file-1');
            expect(pocketbaseService.createFileWithUpload).toHaveBeenCalledWith(
              expect.objectContaining({
                fileName: `thumbnail_${payload.uploadId}.jpg`,
                fileType: FileType.THUMBNAIL,
                fileSource: expect.any(String),
                storageKey: `uploads/thumb-${payload.uploadId}.jpg`,
                workspaceRef: expect.any(String),
                uploadRef: payload.uploadId,
                mimeType: 'image/jpeg',
              })
            );

            // Sprite should always be generated
            expect(result.spriteFileId).toBe('file-2');
            expect(pocketbaseService.createFileWithUpload).toHaveBeenCalledWith(
              expect.objectContaining({
                fileName: `sprite_${payload.uploadId}.jpg`,
                fileType: FileType.SPRITE,
                fileSource: expect.any(String),
                storageKey: `uploads/sprite-${payload.uploadId}.jpg`,
                workspaceRef: expect.any(String),
                uploadRef: payload.uploadId,
                mimeType: 'image/jpeg',
              })
            );

            // Proxy should be generated if transcoding is enabled
            if (payload.transcode?.enabled) {
              expect(result.proxyFileId).toBe('file-3');
              expect(pocketbaseService.createFileWithUpload).toHaveBeenCalledWith(
                expect.objectContaining({
                  fileName: `proxy_${payload.uploadId}.mp4`,
                  fileType: FileType.PROXY,
                  fileSource: expect.any(String),
                  storageKey: `uploads/proxy-${payload.uploadId}.mp4`,
                  workspaceRef: expect.any(String),
                  uploadRef: payload.uploadId,
                  mimeType: 'video/mp4',
                })
              );
            } else {
              expect(result.proxyFileId).toBeUndefined();
            }

            // Verify strategy was called with correct parameters
            if (isGoogleTranscoder) {
              expect(googleTranscoderStrategy.process).toHaveBeenCalledWith(
                `/tmp/input-${payload.uploadId}.mp4`,
                payload,
                expect.any(Function)
              );
              expect(ffmpegStrategy.process).not.toHaveBeenCalled();
            } else {
              expect(ffmpegStrategy.process).toHaveBeenCalledWith(
                `/tmp/input-${payload.uploadId}.mp4`,
                payload,
                expect.any(Function)
              );
              expect(googleTranscoderStrategy.process).not.toHaveBeenCalled();
            }

            // Verify files were created
            const expectedFiles = 2 + (payload.transcode?.enabled ? 1 : 0);
            expect(pocketbaseService.createFileWithUpload).toHaveBeenCalledTimes(expectedFiles);
          }
        ),
        { numRuns: 50 }
      );
    });
  });

  describe('Property 8: Task Progress Updates', () => {
    /**
     * Property: For any task being processed, the progress value should 
     * monotonically increase from 0 to 100 as processing advances.
     *
     * Validates: Requirements 9.4
     */
    it('should update progress monotonically from 0 to 100', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            uploadId: fc.string({ minLength: 1 }),
            provider: fc.option(
              fc.constantFrom(
                ProcessingProvider.FFMPEG,
                ProcessingProvider.GOOGLE_TRANSCODER,
              ),
            ),
            transcode: fc.option(fc.record({
              enabled: fc.boolean(),
              codec: fc.constantFrom('h264', 'h265', 'vp9'),
              resolution: fc.constantFrom('720p', '1080p', 'original'),
            })),
          }),
          async (payload) => {
            // Reset mocks for each property test iteration
            vi.clearAllMocks();

            const task: Task = {
              id: `task-${payload.uploadId}`,
              type: TaskType.PROCESS_UPLOAD,
              sourceType: 'upload',
              sourceId: payload.uploadId,
              status: TaskStatus.QUEUED,
              progress: 0,
              attempts: 1,
              priority: 0,
              payload,
              WorkspaceRef: 'workspace-1',
              UserRef: 'user-1',
              created: '2023-01-01T00:00:00Z',
              updated: '2023-01-01T00:00:00Z',
              collectionId: 'tasks',
              collectionName: 'Tasks',
              expand: {},
            };

            const upload = {
              id: payload.uploadId,
              name: 'test.mp4',
              WorkspaceRef: 'workspace-1',
              externalPath: `uploads/${payload.uploadId}.mp4`,
              storageBackend: 'local',
            };

            const strategyResult = {
              thumbnailPath: `/tmp/thumb-${payload.uploadId}.jpg`,
              spritePath: `/tmp/sprite-${payload.uploadId}.jpg`,
              proxyPath: payload.transcode?.enabled ? `/tmp/proxy-${payload.uploadId}.mp4` : undefined,
              probeOutput: {
                duration: 60,
                width: 1920,
                height: 1080,
                codec: 'h264',
                fps: 30,
              },
            };

            // Mock service responses
            vi.mocked(pocketbaseService.uploadMutator.getById as any).mockResolvedValue(upload);
            vi.mocked(pocketbaseService.mediaMutator.getByUpload as any).mockResolvedValue(null); // No existing media
            vi.mocked(pocketbaseService.fileMutator.getByUpload as any).mockResolvedValue({ items: [] });
            vi.mocked(storageService.resolveFilePath as any).mockResolvedValue(`/tmp/input-${payload.uploadId}.mp4`);
            
            // Mock strategy selection
            const isGoogleTranscoder = payload.provider === ProcessingProvider.GOOGLE_TRANSCODER;
            vi.mocked(configService.get as any).mockImplementation((key: string) => {
              if (key === 'processors.enableGoogleTranscoder') return isGoogleTranscoder;
              return false;
            });

            // Mock strategy to simulate progress updates
            const mockStrategyProcess = vi.fn().mockImplementation(async (filePath, taskPayload, progressCallback) => {
              // Simulate progress updates from strategy
              progressCallback(10);
              progressCallback(30);
              progressCallback(60);
              progressCallback(90);
              progressCallback(100);
              return strategyResult;
            });

            if (isGoogleTranscoder) {
              googleTranscoderStrategy.process = mockStrategyProcess;
            } else {
              ffmpegStrategy.process = mockStrategyProcess;
            }

            // Mock file operations
            let fileCreateCallCount = 0;
            vi.mocked(pocketbaseService.createFileWithUpload as any).mockImplementation(() => {
              fileCreateCallCount++;
              return Promise.resolve({ id: `file-${fileCreateCallCount}` });
            });

            vi.mocked(pocketbaseService.createMedia as any).mockResolvedValue({ 
              id: `media-${payload.uploadId}`,
              thumbnailFileRef: 'file-1',
              spriteFileRef: 'file-2',
              proxyFileRef: payload.transcode?.enabled ? 'file-3' : undefined,
            });

            // Track progress updates
            const progressUpdates: number[] = [];
            const progressCallback = vi.fn().mockImplementation((progress: number) => {
              progressUpdates.push(progress);
            });

            // Act
            await service.processTask(task, progressCallback);

            // Assert - Verify progress updates are monotonic
            expect(progressUpdates.length).toBeGreaterThan(0);
            
            // Check that progress starts at or near 0
            expect(progressUpdates[0]).toBeGreaterThanOrEqual(0);
            expect(progressUpdates[0]).toBeLessThanOrEqual(20); // Allow some initial progress
            
            // Check that progress ends at 100
            expect(progressUpdates[progressUpdates.length - 1]).toBe(100);
            
            // Check monotonic increase (allowing for equal values)
            for (let i = 1; i < progressUpdates.length; i++) {
              expect(progressUpdates[i]).toBeGreaterThanOrEqual(progressUpdates[i - 1]);
            }
            
            // Verify progress is within valid range [0, 100]
            for (const progress of progressUpdates) {
              expect(progress).toBeGreaterThanOrEqual(0);
              expect(progress).toBeLessThanOrEqual(100);
            }

            // Verify progress callback was called multiple times
            expect(progressCallback).toHaveBeenCalledTimes(progressUpdates.length);
          }
        ),
        { numRuns: 30 }
      );
    });
  });

  describe('Property 9: Media Record Creation', () => {
    /**
     * Property: For any successfully completed transcode task, a corresponding 
     * Media record should exist in PocketBase with references to all generated files.
     *
     * Validates: Requirements 9.5
     */
    it('should create Media record with all file references for successful transcode', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            uploadId: fc.string({ minLength: 1 }),
            provider: fc.option(
              fc.constantFrom(
                ProcessingProvider.FFMPEG,
                ProcessingProvider.GOOGLE_TRANSCODER,
              ),
            ),
            transcode: fc.option(fc.record({
              enabled: fc.boolean(),
              codec: fc.constantFrom('h264', 'h265', 'vp9'),
              resolution: fc.constantFrom('720p', '1080p', 'original'),
            })),
          }),
          async (payload) => {
            // Reset mocks for each property test iteration
            vi.clearAllMocks();

            const task: Task = {
              id: `task-${payload.uploadId}`,
              type: TaskType.PROCESS_UPLOAD,
              sourceType: 'upload',
              sourceId: payload.uploadId,
              status: TaskStatus.QUEUED,
              progress: 0,
              attempts: 1,
              priority: 0,
              payload,
              WorkspaceRef: 'workspace-1',
              UserRef: 'user-1',
              created: '2023-01-01T00:00:00Z',
              updated: '2023-01-01T00:00:00Z',
              collectionId: 'tasks',
              collectionName: 'Tasks',
              expand: {},
            };

            const upload = {
              id: payload.uploadId,
              name: 'test.mp4',
              WorkspaceRef: 'workspace-1',
              externalPath: `uploads/${payload.uploadId}.mp4`,
              storageBackend: 'local',
            };

            const probeOutput = {
              duration: 60,
              width: 1920,
              height: 1080,
              codec: 'h264',
              fps: 30,
              bitrate: 5000000,
              format: 'mp4',
              size: 10485760,
            };

            const strategyResult = {
              thumbnailPath: `/tmp/thumb-${payload.uploadId}.jpg`,
              spritePath: `/tmp/sprite-${payload.uploadId}.jpg`,
              proxyPath: payload.transcode?.enabled ? `/tmp/proxy-${payload.uploadId}.mp4` : undefined,
              probeOutput,
            };

            // Mock service responses
            vi.mocked(pocketbaseService.uploadMutator.getById as any).mockResolvedValue(upload);
            vi.mocked(pocketbaseService.mediaMutator.getByUpload as any).mockResolvedValue(null); // No existing media
            vi.mocked(pocketbaseService.fileMutator.getByUpload as any).mockResolvedValue({ items: [] });
            vi.mocked(storageService.resolveFilePath as any).mockResolvedValue(`/tmp/input-${payload.uploadId}.mp4`);
            
            // Mock strategy selection
            const isGoogleTranscoder = payload.provider === ProcessingProvider.GOOGLE_TRANSCODER;
            vi.mocked(configService.get as any).mockImplementation((key: string) => {
              if (key === 'processors.enableGoogleTranscoder') return isGoogleTranscoder;
              return false;
            });

            if (isGoogleTranscoder) {
              vi.mocked(googleTranscoderStrategy.process as any).mockResolvedValue(strategyResult);
            } else {
              vi.mocked(ffmpegStrategy.process as any).mockResolvedValue(strategyResult);
            }

            // Mock file operations
            let fileCreateCallCount = 0;
            vi.mocked(pocketbaseService.createFileWithUpload as any).mockImplementation(() => {
              fileCreateCallCount++;
              return Promise.resolve({ id: `file-${fileCreateCallCount}` });
            });

            const createdMedia = { 
              id: `media-${payload.uploadId}`,
              thumbnailFileRef: 'file-1',
              spriteFileRef: 'file-2',
              proxyFileRef: payload.transcode?.enabled ? 'file-3' : undefined,
            };
            vi.mocked(pocketbaseService.createMedia as any).mockResolvedValue(createdMedia);

            const progressCallback = vi.fn();

            // Act
            const result = await service.processTask(task, progressCallback);

            // Assert - Verify Media record was created with all file references
            expect(result).toBeDefined();
            expect(result.mediaId).toBe(`media-${payload.uploadId}`);

            // Verify mediaMutator.create was called with correct data structure
            expect(pocketbaseService.mediaMutator.create).toHaveBeenCalledWith(
              expect.objectContaining({
                WorkspaceRef: upload.WorkspaceRef,
                UploadRef: payload.uploadId,
                mediaType: 'video', // The service determines this from probe output (width/height present = video)
                duration: probeOutput.duration,
                mediaData: expect.objectContaining({
                  name: upload.name,
                  width: probeOutput.width,
                  height: probeOutput.height,
                  fps: probeOutput.fps,
                  codec: probeOutput.codec,
                  bitrate: probeOutput.bitrate,
                  size: probeOutput.size,
                  probeOutput: probeOutput,
                  processorVersion: expect.stringContaining('nestjs-worker:1.0.0'),
                }),
                thumbnailFileRef: 'file-1',
                spriteFileRef: 'file-2',
                proxyFileRef: payload.transcode?.enabled ? 'file-3' : undefined,
                version: 1,
              })
            );

            // Verify all required file records were created
            expect(pocketbaseService.createFileWithUpload).toHaveBeenCalledTimes(
              payload.transcode?.enabled ? 3 : 2
            );

            // Verify thumbnail file creation
            expect(pocketbaseService.createFileWithUpload).toHaveBeenCalledWith(
              expect.objectContaining({
                fileName: `thumbnail_${payload.uploadId}.jpg`,
                fileType: FileType.THUMBNAIL,
                fileSource: expect.any(String),
                storageKey: `uploads/thumb-${payload.uploadId}.jpg`,
                workspaceRef: upload.WorkspaceRef,
                uploadRef: payload.uploadId,
                mimeType: 'image/jpeg',
              })
            );

            // Verify sprite file creation
            expect(pocketbaseService.createFileWithUpload).toHaveBeenCalledWith(
              expect.objectContaining({
                fileName: `sprite_${payload.uploadId}.jpg`,
                fileType: FileType.SPRITE,
                fileSource: expect.any(String),
                storageKey: `uploads/sprite-${payload.uploadId}.jpg`,
                workspaceRef: upload.WorkspaceRef,
                uploadRef: payload.uploadId,
                mimeType: 'image/jpeg',
              })
            );

            // Verify proxy file creation if transcoding is enabled
            if (payload.transcode?.enabled) {
              expect(pocketbaseService.createFileWithUpload).toHaveBeenCalledWith(
                expect.objectContaining({
                  fileName: `proxy_${payload.uploadId}.mp4`,
                  fileType: FileType.PROXY,
                  fileSource: expect.any(String),
                  storageKey: `uploads/proxy-${payload.uploadId}.mp4`,
                  workspaceRef: upload.WorkspaceRef,
                  uploadRef: payload.uploadId,
                  mimeType: 'video/mp4',
                })
              );
            }

            // Verify result contains all expected file references
            expect(result.thumbnailFileId).toBe('file-1');
            expect(result.spriteFileId).toBe('file-2');
            if (payload.transcode?.enabled) {
              expect(result.proxyFileId).toBe('file-3');
            } else {
              expect(result.proxyFileId).toBeUndefined();
            }

            // Verify probe output is included in result
            expect(result.probeOutput).toEqual(probeOutput);
          }
        ),
        { numRuns: 25 }
      );
    });
  });
});