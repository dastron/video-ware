import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { FaceDetectionNormalizer } from '../face-detection.normalizer';
import { LabelType, ProcessingProvider } from '@project/shared';
import { NormalizerInput } from '../../types';

describe('FaceDetectionNormalizer', () => {
  let normalizer: FaceDetectionNormalizer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [FaceDetectionNormalizer],
    }).compile();

    normalizer = module.get<FaceDetectionNormalizer>(FaceDetectionNormalizer);
  });

  it('should be defined', () => {
    expect(normalizer).toBeDefined();
  });

  it('should normalize face detection response with missing trackId', async () => {
    const input: NormalizerInput<any> = {
      response: {
        faces: [
          {
            trackId: '', // Empty trackId
            frames: [
              {
                timeOffset: 0,
                boundingBox: { left: 0, top: 0, right: 1, bottom: 1 },
                confidence: 0.9,
              },
              {
                timeOffset: 1,
                boundingBox: { left: 0, top: 0, right: 1, bottom: 1 },
                confidence: 0.9,
              },
            ],
          },
        ],
      },
      mediaId: 'media-1',
      workspaceRef: 'workspace-1',
      taskRef: 'task-1',
      version: 1,
      processor: 'face-detection',
      processorVersion: '1.0.0',
    };

    const output = await normalizer.normalize(input);

    expect(output.labelEntities.length).toBe(1);
    expect(output.labelFaces?.length).toBe(1);
    expect(output.labelTracks.length).toBe(1);

    const face = output.labelFaces?.[0];
    expect(face?.trackId).toBeDefined();
    expect(face?.trackId.length).toBeGreaterThan(0);
    expect(face?.faceHash).toBeDefined();

    const track = output.labelTracks[0];
    expect(track.trackId).toBe(face?.trackId);
    expect(track.LabelEntityRef).toBeUndefined(); // Will be set by processor
  });

  it('should create LabelFace entities', async () => {
    const input: NormalizerInput<any> = {
      response: {
        faces: [
          {
            trackId: 'track-123',
            frames: [
              {
                timeOffset: 0,
                boundingBox: { left: 0, top: 0, right: 1, bottom: 1 },
                confidence: 0.9,
                attributes: {
                  headwear: 'High',
                },
              },
            ],
          },
        ],
      },
      mediaId: 'media-1',
      workspaceRef: 'workspace-1',
      taskRef: 'task-1',
      version: 1,
      processor: 'face-detection',
      processorVersion: '1.0.0',
    };

    const output = await normalizer.normalize(input);

    expect(output.labelFaces?.length).toBe(1);
    const face = output.labelFaces?.[0];
    expect(face?.trackId).toBe('track-123');
    expect(face?.headwearLikelihood).toBe('High');
  });
});
