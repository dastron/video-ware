import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { LabelType, ProcessingProvider } from '@project/shared';
import type {
  SpeechTranscriptionResponse,
  NormalizerInput,
  NormalizerOutput,
  LabelEntityData,
  LabelClipData,
  LabelMediaData,
} from '../types';

/**
 * Speech Transcription Normalizer
 *
 * Transforms GCVI Speech Transcription API responses into database entities:
 * - LabelEntity: Significant words/phrases from the transcript
 * - LabelClip: Speech segments (sentences or time-bounded chunks)
 * - LabelMedia: Full transcript and word counts
 *
 * This normalizer handles:
 * - Full transcript text
 * - Word-level timing information
 * - Speech segment creation
 * - Significant word/phrase extraction
 */
@Injectable()
export class SpeechTranscriptionNormalizer {
  private readonly logger = new Logger(SpeechTranscriptionNormalizer.name);

  // Configuration for segment creation
  private readonly MAX_SEGMENT_DURATION = 30.0; // seconds
  private readonly MIN_WORD_CONFIDENCE = 0.7; // For significant word extraction
  private readonly MIN_WORD_LENGTH = 4; // Minimum characters for significant words

  /**
   * Normalize speech transcription response into database entities
   *
   * @param input Normalizer input with response and context
   * @returns Normalized entities ready for database insertion
   */
  async normalize(
    input: NormalizerInput<SpeechTranscriptionResponse>
  ): Promise<NormalizerOutput> {
    const {
      response,
      mediaId,
      workspaceRef,
      taskRef,
      version,
      processor,
      processorVersion,
    } = input;

    this.logger.debug(
      `Normalizing speech transcription response for media ${mediaId}: ${response.words.length} words`
    );

    const labelEntities: LabelEntityData[] = [];
    const labelClips: LabelClipData[] = [];
    const seenLabels = new Set<string>();

    // Extract significant words/phrases for LabelEntity
    const significantWords = this.extractSignificantWords(response.words);

    for (const word of significantWords) {
      const entityHash = this.generateEntityHash(
        workspaceRef,
        LabelType.SPEECH,
        word,
        ProcessingProvider.GOOGLE_SPEECH
      );

      if (!seenLabels.has(entityHash)) {
        labelEntities.push({
          WorkspaceRef: workspaceRef,
          labelType: LabelType.SPEECH,
          canonicalName: word,
          provider: ProcessingProvider.GOOGLE_SPEECH,
          processor: processorVersion,
          entityHash,
          metadata: {
            languageCode: response.languageCode,
          },
        });
        seenLabels.add(entityHash);
      }
    }

    // Create speech segments (time-bounded chunks)
    const segments = this.createSpeechSegments(response.words);

    for (const segment of segments) {
      const clipHash = this.generateClipHash(
        mediaId,
        segment.start,
        segment.end,
        LabelType.SPEECH
      );

      labelClips.push({
        WorkspaceRef: workspaceRef,
        MediaRef: mediaId,
        TaskRef: taskRef,
        labelHash: clipHash,
        labelType: LabelType.SPEECH,
        type: 'Speech', // Deprecated field
        start: segment.start,
        end: segment.end,
        duration: segment.end - segment.start,
        confidence: segment.confidence,
        version,
        processor: processorVersion,
        provider: ProcessingProvider.GOOGLE_SPEECH,
        labelData: {
          entity: 'Speech',
          text: segment.text,
          wordCount: segment.wordCount,
          languageCode: response.languageCode,
        },
        // LabelEntityRef will be set by step processor (for "Speech" entity)
        // LabelTrackRef is null for speech (no spatial tracking)
      });
    }

    // Create LabelMedia update with full transcript and counts
    const labelMediaUpdate: Partial<LabelMediaData> = {
      speechTranscriptionProcessedAt: new Date().toISOString(),
      speechTranscriptionProcessor: processorVersion,
      transcript: response.transcript,
      transcriptLength: response.transcript.length,
      wordCount: response.words.length,
      // Add processor to processors array
      processors: ['speech_transcription'],
    };

    this.logger.debug(
      `Normalized ${labelEntities.length} entities, ${labelClips.length} clips from ${response.words.length} words`
    );

    return {
      labelEntities,
      labelTracks: [], // No tracks for speech transcription
      labelClips,
      labelMediaUpdate,
    };
  }

  /**
   * Extract significant words from transcript
   *
   * Filters words by:
   * - Minimum confidence threshold
   * - Minimum word length
   * - Excludes common stop words
   *
   * @param words Array of transcribed words
   * @returns Array of significant words
   */
  private extractSignificantWords(
    words: Array<{ word: string; confidence: number }>
  ): string[] {
    const stopWords = new Set([
      'the',
      'a',
      'an',
      'and',
      'or',
      'but',
      'in',
      'on',
      'at',
      'to',
      'for',
      'of',
      'with',
      'by',
      'from',
      'as',
      'is',
      'was',
      'are',
      'were',
      'be',
      'been',
      'being',
      'have',
      'has',
      'had',
      'do',
      'does',
      'did',
      'will',
      'would',
      'should',
      'could',
      'may',
      'might',
      'can',
      'this',
      'that',
      'these',
      'those',
      'it',
      'its',
      'they',
      'them',
      'their',
      'we',
      'us',
      'our',
      'you',
      'your',
      'he',
      'him',
      'his',
      'she',
      'her',
      'i',
      'me',
      'my',
    ]);

    const significantWords = new Set<string>();

    for (const wordObj of words) {
      const word = wordObj.word.toLowerCase().trim();

      // Filter by confidence, length, and stop words
      if (
        wordObj.confidence >= this.MIN_WORD_CONFIDENCE &&
        word.length >= this.MIN_WORD_LENGTH &&
        !stopWords.has(word)
      ) {
        // Capitalize first letter for display
        const capitalizedWord = word.charAt(0).toUpperCase() + word.slice(1);
        significantWords.add(capitalizedWord);
      }
    }

    return Array.from(significantWords);
  }

  /**
   * Create speech segments from words
   *
   * Groups words into time-bounded segments with maximum duration.
   * Each segment represents a continuous speech chunk.
   *
   * @param words Array of transcribed words with timing
   * @returns Array of speech segments
   */
  private createSpeechSegments(
    words: Array<{
      word: string;
      startTime: number;
      endTime: number;
      confidence: number;
    }>
  ): Array<{
    start: number;
    end: number;
    text: string;
    confidence: number;
    wordCount: number;
  }> {
    if (words.length === 0) {
      return [];
    }

    const segments: Array<{
      start: number;
      end: number;
      text: string;
      confidence: number;
      wordCount: number;
    }> = [];

    let currentSegment: {
      start: number;
      end: number;
      words: string[];
      confidences: number[];
    } = {
      start: words[0].startTime,
      end: words[0].endTime,
      words: [words[0].word],
      confidences: [words[0].confidence],
    };

    for (let i = 1; i < words.length; i++) {
      const word = words[i];
      const segmentDuration = word.endTime - currentSegment.start;

      // Check if we should start a new segment
      if (segmentDuration > this.MAX_SEGMENT_DURATION) {
        // Finalize current segment
        segments.push({
          start: currentSegment.start,
          end: currentSegment.end,
          text: currentSegment.words.join(' '),
          confidence:
            currentSegment.confidences.reduce((sum, c) => sum + c, 0) /
            currentSegment.confidences.length,
          wordCount: currentSegment.words.length,
        });

        // Start new segment
        currentSegment = {
          start: word.startTime,
          end: word.endTime,
          words: [word.word],
          confidences: [word.confidence],
        };
      } else {
        // Add word to current segment
        currentSegment.end = word.endTime;
        currentSegment.words.push(word.word);
        currentSegment.confidences.push(word.confidence);
      }
    }

    // Finalize last segment
    if (currentSegment.words.length > 0) {
      segments.push({
        start: currentSegment.start,
        end: currentSegment.end,
        text: currentSegment.words.join(' '),
        confidence:
          currentSegment.confidences.reduce((sum, c) => sum + c, 0) /
          currentSegment.confidences.length,
        wordCount: currentSegment.words.length,
      });
    }

    return segments;
  }

  /**
   * Generate entity hash for deduplication
   */
  private generateEntityHash(
    workspaceRef: string,
    labelType: LabelType,
    canonicalName: string,
    provider: ProcessingProvider
  ): string {
    const normalizedName = canonicalName.trim().toLowerCase();
    const hashInput = `${workspaceRef}:${labelType}:${normalizedName}:${provider}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }

  /**
   * Generate clip hash for deduplication
   *
   * Hash format: mediaId:start:end:labelType
   * This ensures unique clips based on media, time range, and label type
   *
   * @param mediaId Media ID
   * @param start Start time
   * @param end End time
   * @param labelType Label type
   * @returns SHA-256 hash
   */
  private generateClipHash(
    mediaId: string,
    start: number,
    end: number,
    labelType: LabelType
  ): string {
    const hashInput = `${mediaId}:${start.toFixed(3)}:${end.toFixed(3)}:${labelType}`;
    return createHash('sha256').update(hashInput).digest('hex');
  }
}
