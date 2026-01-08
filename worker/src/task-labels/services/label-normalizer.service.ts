// Label normalizer service for converting provider responses to normalized label clips

import { Injectable, Logger } from '@nestjs/common';
import { LabelType } from '@project/shared';
import type {
  VideoIntelligenceResponse,
  SpeechToTextResponse,
  NormalizedLabelClip,
} from '../executors/interfaces';
import type {
  ObjectLabelData,
  ShotLabelData,
  PersonLabelData,
  SpeechLabelData,
} from '@project/shared';
import { toSeconds, normalizeTimeRange } from '../utils/time-conversion';
import { sampleBoundingBoxes } from '../utils/bbox-sampling';

/**
 * Normalizer input/output types
 */
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

@Injectable()
export class LabelNormalizerService {
  private readonly logger = new Logger(LabelNormalizerService.name);
  private readonly processorVersion = 'label-normalizer:1.0.0';

  /**
   * Normalize Google Video Intelligence API response into label clips
   */
  async normalizeVideoIntelligence(
    input: NormalizeVideoIntelligenceInput,
  ): Promise<NormalizeVideoIntelligenceOutput> {
    const { response, rawJsonPath } = input;
    const labelClips: NormalizedLabelClip[] = [];

    this.logger.log(
      `Normalizing video intelligence for media ${input.mediaId}, version ${input.version}`,
    );

    // Process shot annotations
    const shotClips = this.normalizeShotAnnotations(response, rawJsonPath);
    labelClips.push(...shotClips);

    // Process object annotations
    const objectClips = this.normalizeObjectAnnotations(response, rawJsonPath);
    labelClips.push(...objectClips);

    // Process person detection annotations
    const personClips = this.normalizePersonAnnotations(response, rawJsonPath);
    labelClips.push(...personClips);

    this.logger.log(
      `Normalized ${labelClips.length} label clips: ${shotClips.length} shots, ${objectClips.length} objects, ${personClips.length} persons`,
    );

    return {
      labelClips,
      summary: {
        shotCount: shotClips.length,
        objectCount: objectClips.length,
        personCount: personClips.length,
      },
    };
  }

  /**
   * Normalize Google Speech-to-Text API response into label clips
   */
  async normalizeSpeechToText(
    input: NormalizeSpeechToTextInput,
  ): Promise<NormalizeSpeechToTextOutput> {
    const { response, rawJsonPath } = input;
    const labelClips: NormalizedLabelClip[] = [];

    this.logger.log(
      `Normalizing speech-to-text for media ${input.mediaId}, version ${input.version}`,
    );

    if (!response.transcript || !response.words || response.words.length === 0) {
      this.logger.warn('No speech results found in response');
      return {
        labelClips: [],
        summary: {
          speechCount: 0,
          totalWords: 0,
        },
      };
    }

    const words = response.words;
    const totalWords = words.length;

    // Create a speech segment from the words
    if (words.length > 0) {
      const firstWord = words[0];
      const lastWord = words[words.length - 1];

      const startTime = firstWord.startTime;
      const endTime = lastWord.endTime;

      if (startTime >= endTime) {
        this.logger.warn(
          `Invalid time range for speech segment: start=${startTime}, end=${endTime}`,
        );
        return {
          labelClips: [],
          summary: {
            speechCount: 0,
            totalWords,
          },
        };
      }

      const labelData: SpeechLabelData = {
        entityId: `speech_${startTime}_${endTime}`,
        entityDescription: response.transcript.substring(0, 100),
        rawJsonPath,
        transcript: response.transcript,
        languageCode: response.languageCode || 'en-US',
        wordCount: words.length,
        providerPayload: {
          confidence: response.confidence,
        },
      };

      labelClips.push({
        labelType: LabelType.SPEECH,
        start: startTime,
        end: endTime,
        duration: endTime - startTime,
        confidence: response.confidence || 0.9,
        labelData,
      });
    }

    this.logger.log(
      `Normalized ${labelClips.length} speech segments with ${totalWords} total words`,
    );

    return {
      labelClips,
      summary: {
        speechCount: labelClips.length,
        totalWords,
      },
    };
  }

  /**
   * Get the processor version for this normalizer
   */
  getProcessorVersion(): string {
    return this.processorVersion;
  }

  /**
   * Normalize shot annotations from video intelligence response
   */
  private normalizeShotAnnotations(
    response: VideoIntelligenceResponse,
    rawJsonPath: string,
  ): NormalizedLabelClip[] {
    const clips: NormalizedLabelClip[] = [];

    if (!response.sceneChanges || response.sceneChanges.length === 0) {
      return clips;
    }

    // Scene changes are just time offsets, we need to create segments between them
    const sceneChanges = response.sceneChanges;
    
    for (let i = 0; i < sceneChanges.length - 1; i++) {
      try {
        const startTime = sceneChanges[i].timeOffset;
        const endTime = sceneChanges[i + 1].timeOffset;

        if (startTime >= endTime) {
          this.logger.warn(
            `Invalid shot time range: start=${startTime}, end=${endTime}`,
          );
          continue;
        }

        const labelData: ShotLabelData = {
          entityId: `shot_${i}`,
          entityDescription: `Shot ${i + 1}`,
          rawJsonPath,
          shotIndex: i,
        };

        clips.push({
          labelType: LabelType.SHOT,
          start: startTime,
          end: endTime,
          duration: endTime - startTime,
          confidence: 1.0, // Shots don't have confidence scores
          labelData,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to normalize shot ${i}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return clips;
  }

  /**
   * Normalize object annotations from video intelligence response
   */
  private normalizeObjectAnnotations(
    response: VideoIntelligenceResponse,
    rawJsonPath: string,
  ): NormalizedLabelClip[] {
    const clips: NormalizedLabelClip[] = [];

    if (!response.objects || response.objects.length === 0) {
      return clips;
    }

    for (const obj of response.objects) {
      try {
        if (!obj.entity || !obj.frames || obj.frames.length === 0) {
          continue;
        }

        // Get time range from first and last frame
        const firstFrame = obj.frames[0];
        const lastFrame = obj.frames[obj.frames.length - 1];
        
        const startTime = firstFrame.timeOffset;
        const endTime = lastFrame.timeOffset;

        if (startTime >= endTime) {
          this.logger.warn(
            `Invalid object time range: start=${startTime}, end=${endTime}`,
          );
          continue;
        }

        // Sample bounding boxes (max 10)
        const boundingBoxSamples = sampleBoundingBoxes(
          obj.frames.map((frame) => ({
            timeOffset: frame.timeOffset,
            left: frame.boundingBox.left,
            top: frame.boundingBox.top,
            right: frame.boundingBox.right,
            bottom: frame.boundingBox.bottom,
          })),
        );

        const labelData: ObjectLabelData = {
          entityId: obj.entity,
          entityDescription: obj.entity,
          rawJsonPath,
          boundingBoxSamples,
          providerPayload: {
            confidence: obj.confidence,
          },
        };

        clips.push({
          labelType: LabelType.OBJECT,
          start: startTime,
          end: endTime,
          duration: endTime - startTime,
          confidence: obj.confidence || 0.5,
          labelData,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to normalize object: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return clips;
  }

  /**
   * Normalize person detection annotations from video intelligence response
   */
  private normalizePersonAnnotations(
    response: VideoIntelligenceResponse,
    rawJsonPath: string,
  ): NormalizedLabelClip[] {
    const clips: NormalizedLabelClip[] = [];

    if (!response.persons || response.persons.length === 0) {
      return clips;
    }

    for (const person of response.persons) {
      try {
        if (!person.frames || person.frames.length === 0) {
          continue;
        }

        // Get time range from first and last frame
        const firstFrame = person.frames[0];
        const lastFrame = person.frames[person.frames.length - 1];
        
        const startTime = firstFrame.timeOffset;
        const endTime = lastFrame.timeOffset;

        if (startTime >= endTime) {
          this.logger.warn(
            `Invalid person time range: start=${startTime}, end=${endTime}`,
          );
          continue;
        }

        // Sample bounding boxes (max 10)
        const boundingBoxSamples = sampleBoundingBoxes(
          person.frames.map((frame) => ({
            timeOffset: frame.timeOffset,
            left: frame.boundingBox.left,
            top: frame.boundingBox.top,
            right: frame.boundingBox.right,
            bottom: frame.boundingBox.bottom,
          })),
        );

        const labelData: PersonLabelData = {
          entityId: `person_${startTime}_${endTime}`,
          entityDescription: 'Person',
          rawJsonPath,
          boundingBoxSamples,
          providerPayload: {
            confidence: person.confidence,
          },
        };

        clips.push({
          labelType: LabelType.PERSON,
          start: startTime,
          end: endTime,
          duration: endTime - startTime,
          confidence: person.confidence || 0.5,
          labelData,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to normalize person track: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return clips;
  }
}
