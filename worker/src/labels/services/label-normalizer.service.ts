// Label normalizer service for converting provider responses to normalized label clips

import { Injectable, Logger } from '@nestjs/common';
import { LabelType } from '@project/shared';
import type {
  VideoIntelligenceResponse,
  SpeechToTextResponse,
  NormalizedLabelClip,
  NormalizeVideoIntelligenceInput,
  NormalizeVideoIntelligenceOutput,
  NormalizeSpeechToTextInput,
  NormalizeSpeechToTextOutput,
} from '../types/normalizer';
import type {
  ObjectLabelData,
  ShotLabelData,
  PersonLabelData,
  SpeechLabelData,
} from '@project/shared';
import { toSeconds, normalizeTimeRange } from '../utils/time-conversion';
import { sampleBoundingBoxes } from '../utils/bbox-sampling';

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

    if (!response.results || response.results.length === 0) {
      this.logger.warn('No speech results found in response');
      return {
        labelClips: [],
        summary: {
          speechCount: 0,
          totalWords: 0,
        },
      };
    }

    let totalWords = 0;

    for (const result of response.results) {
      if (!result.alternatives || result.alternatives.length === 0) {
        continue;
      }

      const alternative = result.alternatives[0];
      if (!alternative.transcript || !alternative.words) {
        continue;
      }

      const words = alternative.words;
      totalWords += words.length;

      // Create a speech segment from the words
      if (words.length > 0) {
        const firstWord = words[0];
        const lastWord = words[words.length - 1];

        const startTime = toSeconds(firstWord.startTime);
        const endTime = toSeconds(lastWord.endTime);

        if (startTime >= endTime) {
          this.logger.warn(
            `Invalid time range for speech segment: start=${startTime}, end=${endTime}`,
          );
          continue;
        }

        const labelData: SpeechLabelData = {
          entityId: `speech_${startTime}_${endTime}`,
          entityDescription: alternative.transcript.substring(0, 100),
          rawJsonPath,
          transcript: alternative.transcript,
          languageCode: result.languageCode || 'en-US',
          wordCount: words.length,
          providerPayload: {
            confidence: alternative.confidence,
          },
        };

        labelClips.push({
          labelType: LabelType.SPEECH,
          start: startTime,
          end: endTime,
          duration: endTime - startTime,
          confidence: alternative.confidence || 0.9,
          labelData,
        });
      }
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

    if (!response.annotationResults) {
      return clips;
    }

    for (const result of response.annotationResults) {
      if (!result.shotAnnotations) {
        continue;
      }

      result.shotAnnotations.forEach((shot, index) => {
        try {
          const startTime = toSeconds(shot.startTimeOffset);
          const endTime = toSeconds(shot.endTimeOffset);

          if (startTime >= endTime) {
            this.logger.warn(
              `Invalid shot time range: start=${startTime}, end=${endTime}`,
            );
            return;
          }

          const labelData: ShotLabelData = {
            entityId: `shot_${index}`,
            entityDescription: `Shot ${index + 1}`,
            rawJsonPath,
            shotIndex: index,
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
            `Failed to normalize shot ${index}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
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

    if (!response.annotationResults) {
      return clips;
    }

    for (const result of response.annotationResults) {
      if (!result.objectAnnotations) {
        continue;
      }

      for (const obj of result.objectAnnotations) {
        try {
          if (!obj.entity || !obj.segment) {
            continue;
          }

          const startTime = toSeconds(obj.segment.startTimeOffset);
          const endTime = toSeconds(obj.segment.endTimeOffset);

          if (startTime >= endTime) {
            this.logger.warn(
              `Invalid object time range: start=${startTime}, end=${endTime}`,
            );
            continue;
          }

          // Sample bounding boxes (max 10)
          const boundingBoxSamples = obj.frames
            ? sampleBoundingBoxes(
                obj.frames.map((frame) => ({
                  timeOffset: toSeconds(frame.timeOffset),
                  left: frame.normalizedBoundingBox?.left || 0,
                  top: frame.normalizedBoundingBox?.top || 0,
                  right: frame.normalizedBoundingBox?.right || 1,
                  bottom: frame.normalizedBoundingBox?.bottom || 1,
                })),
              )
            : [];

          const labelData: ObjectLabelData = {
            entityId: obj.entity.entityId || '',
            entityDescription: obj.entity.description || 'Unknown object',
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

    if (!response.annotationResults) {
      return clips;
    }

    for (const result of response.annotationResults) {
      if (!result.personDetectionAnnotations) {
        continue;
      }

      for (const personAnnotation of result.personDetectionAnnotations) {
        if (!personAnnotation.tracks) {
          continue;
        }

        for (const track of personAnnotation.tracks) {
          try {
            if (!track.segment) {
              continue;
            }

            const startTime = toSeconds(track.segment.startTimeOffset);
            const endTime = toSeconds(track.segment.endTimeOffset);

            if (startTime >= endTime) {
              this.logger.warn(
                `Invalid person time range: start=${startTime}, end=${endTime}`,
              );
              continue;
            }

            // Sample bounding boxes (max 10)
            const boundingBoxSamples = track.timestampedObjects
              ? sampleBoundingBoxes(
                  track.timestampedObjects.map((obj) => ({
                    timeOffset: toSeconds(obj.timeOffset),
                    left: obj.normalizedBoundingBox?.left || 0,
                    top: obj.normalizedBoundingBox?.top || 0,
                    right: obj.normalizedBoundingBox?.right || 1,
                    bottom: obj.normalizedBoundingBox?.bottom || 1,
                  })),
                )
              : [];

            const labelData: PersonLabelData = {
              entityId: `person_${startTime}_${endTime}`,
              entityDescription: 'Person',
              rawJsonPath,
              boundingBoxSamples,
              providerPayload: {
                confidence: track.confidence,
              },
            };

            clips.push({
              labelType: LabelType.PERSON,
              start: startTime,
              end: endTime,
              duration: endTime - startTime,
              confidence: track.confidence || 0.5,
              labelData,
            });
          } catch (error) {
            this.logger.warn(
              `Failed to normalize person track: ${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }

    return clips;
  }
}
