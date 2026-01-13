import { describe, it, expect, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { SpeechTranscriptionNormalizer } from '../speech-transcription.normalizer';
import { NormalizerInput } from '../../types';

describe('SpeechTranscriptionNormalizer', () => {
  let normalizer: SpeechTranscriptionNormalizer;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SpeechTranscriptionNormalizer],
    }).compile();

    normalizer = module.get<SpeechTranscriptionNormalizer>(
      SpeechTranscriptionNormalizer
    );
  });

  it('should be defined', () => {
    expect(normalizer).toBeDefined();
  });

  it('should normalize speech transcription response into segments', async () => {
    const input: NormalizerInput<any> = {
      response: {
        transcript: 'Hello world. This is a test.',
        words: [
          { word: 'Hello', startTime: 0, endTime: 0.5, confidence: 0.9 },
          { word: 'world', startTime: 0.6, endTime: 1.0, confidence: 0.9 },
          { word: 'This', startTime: 2.0, endTime: 2.5, confidence: 0.8 },
          { word: 'is', startTime: 2.6, endTime: 2.8, confidence: 0.8 },
          { word: 'a', startTime: 2.9, endTime: 3.0, confidence: 0.8 },
          { word: 'test', startTime: 3.1, endTime: 3.5, confidence: 0.9 },
        ],
        languageCode: 'en-US',
      },
      mediaId: 'media-1',
      workspaceRef: 'workspace-1',
      taskRef: 'task-1',
      version: 1,
      processor: 'speech-transcription',
      processorVersion: '1.0.0',
    };

    const output = await normalizer.normalize(input);

    expect(output.labelEntities.length).toBeGreaterThan(0); // Significant words
    expect(output.labelSpeech?.length).toBeGreaterThan(0); // Segments

    // Check segments
    // Given the short duration, it might be 1 segment unless pauses break it
    // The implementation groups by MAX_SEGMENT_DURATION

    const segments = output.labelSpeech || [];
    expect(segments.length).toBe(1); // 3.5 seconds total < 30s
    expect(segments[0].transcript).toBe('Hello world This is a test');
    expect(segments[0].words.length).toBe(6);
    expect(segments[0].startTime).toBe(0);
    expect(segments[0].endTime).toBe(3.5);
  });

  it('should segment speech by speaker', async () => {
    const input: NormalizerInput<any> = {
      response: {
        transcript: 'Hello from speaker 1. Hello from speaker 2.',
        words: [
          {
            word: 'Hello',
            startTime: 0,
            endTime: 0.5,
            confidence: 0.9,
            speakerTag: 1,
          },
          {
            word: 'from',
            startTime: 0.6,
            endTime: 1.0,
            confidence: 0.9,
            speakerTag: 1,
          },
          {
            word: 'speaker',
            startTime: 1.1,
            endTime: 1.5,
            confidence: 0.9,
            speakerTag: 1,
          },
          {
            word: '1',
            startTime: 1.6,
            endTime: 2.0,
            confidence: 0.9,
            speakerTag: 1,
          },
          {
            word: 'Hello',
            startTime: 2.1,
            endTime: 2.5,
            confidence: 0.9,
            speakerTag: 2,
          },
          {
            word: 'from',
            startTime: 2.6,
            endTime: 3.0,
            confidence: 0.9,
            speakerTag: 2,
          },
          {
            word: 'speaker',
            startTime: 3.1,
            endTime: 3.5,
            confidence: 0.9,
            speakerTag: 2,
          },
          {
            word: '2',
            startTime: 3.6,
            endTime: 4.0,
            confidence: 0.9,
            speakerTag: 2,
          },
        ],
        languageCode: 'en-US',
      },
      mediaId: 'media-1',
      workspaceRef: 'workspace-1',
      taskRef: 'task-1',
      version: 1,
      processor: 'speech-transcription',
      processorVersion: '1.0.0',
    };

    const output = await normalizer.normalize(input);
    const segments = output.labelSpeech || [];

    expect(segments.length).toBe(2);

    expect(segments[0].speakerTag).toBe(1);
    expect(segments[0].transcript).toBe('Hello from speaker 1');

    expect(segments[1].speakerTag).toBe(2);
    expect(segments[1].transcript).toBe('Hello from speaker 2');
  });
});
