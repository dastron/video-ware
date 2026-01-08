// Label normalizer types for processing provider responses

import type {
  LabelData,
  ObjectLabelData,
  ShotLabelData,
  PersonLabelData,
  SpeechLabelData,
} from '@project/shared';
import { LabelType, ProcessingProvider } from '@project/shared';

// Input types for normalization

export interface VideoIntelligenceResponse {
  annotationResults?: Array<{
    segmentLabelAnnotations?: Array<{
      entity?: {
        entityId?: string;
        description?: string;
      };
      segments?: Array<{
        segment?: {
          startTimeOffset?: string | { seconds?: number; nanos?: number };
          endTimeOffset?: string | { seconds?: number; nanos?: number };
        };
        confidence?: number;
      }>;
    }>;
    objectAnnotations?: Array<{
      entity?: {
        entityId?: string;
        description?: string;
      };
      confidence?: number;
      frames?: Array<{
        timeOffset?: string | { seconds?: number; nanos?: number };
        normalizedBoundingBox?: {
          left?: number;
          top?: number;
          right?: number;
          bottom?: number;
        };
      }>;
      segment?: {
        startTimeOffset?: string | { seconds?: number; nanos?: number };
        endTimeOffset?: string | { seconds?: number; nanos?: number };
      };
    }>;
    shotAnnotations?: Array<{
      startTimeOffset?: string | { seconds?: number; nanos?: number };
      endTimeOffset?: string | { seconds?: number; nanos?: number };
    }>;
    personDetectionAnnotations?: Array<{
      tracks?: Array<{
        segment?: {
          startTimeOffset?: string | { seconds?: number; nanos?: number };
          endTimeOffset?: string | { seconds?: number; nanos?: number };
        };
        confidence?: number;
        timestampedObjects?: Array<{
          timeOffset?: string | { seconds?: number; nanos?: number };
          normalizedBoundingBox?: {
            left?: number;
            top?: number;
            right?: number;
            bottom?: number;
          };
        }>;
      }>;
    }>;
  }>;
}

export interface SpeechToTextResponse {
  results?: Array<{
    alternatives?: Array<{
      transcript?: string;
      confidence?: number;
      words?: Array<{
        startTime?: string | { seconds?: number; nanos?: number };
        endTime?: string | { seconds?: number; nanos?: number };
        word?: string;
      }>;
    }>;
    languageCode?: string;
  }>;
}

// Output types for normalization

export interface NormalizedLabelClip {
  labelType: LabelType;
  start: number; // seconds (float)
  end: number; // seconds (float)
  duration: number; // seconds (float)
  confidence: number; // 0-1
  labelData: LabelData;
}

export interface NormalizeVideoIntelligenceInput {
  response: VideoIntelligenceResponse;
  mediaId: string;
  version: number;
  rawJsonPath: string;
  processor: string;
}

export interface NormalizeVideoIntelligenceOutput {
  labelClips: NormalizedLabelClip[];
  summary: {
    shotCount: number;
    objectCount: number;
    personCount: number;
  };
}

export interface NormalizeSpeechToTextInput {
  response: SpeechToTextResponse;
  mediaId: string;
  version: number;
  rawJsonPath: string;
  processor: string;
}

export interface NormalizeSpeechToTextOutput {
  labelClips: NormalizedLabelClip[];
  summary: {
    speechCount: number;
    totalWords: number;
  };
}

// Provider response type mappings

export type ProviderResponseMap = {
  [ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE]: VideoIntelligenceResponse;
  [ProcessingProvider.GOOGLE_SPEECH]: SpeechToTextResponse;
};

export type NormalizerInputMap = {
  [ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE]: NormalizeVideoIntelligenceInput;
  [ProcessingProvider.GOOGLE_SPEECH]: NormalizeSpeechToTextInput;
};

export type NormalizerOutputMap = {
  [ProcessingProvider.GOOGLE_VIDEO_INTELLIGENCE]: NormalizeVideoIntelligenceOutput;
  [ProcessingProvider.GOOGLE_SPEECH]: NormalizeSpeechToTextOutput;
};
