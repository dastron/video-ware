/**
 * Score Combiner
 *
 * Combines scores from multiple recommendation strategies using configurable weights.
 * Supports weighted averaging and handles zero-weight strategies (excluded from combination).
 */

import { RecommendationStrategy } from '@project/shared';

/**
 * Combine scores from multiple strategies using weighted averaging
 *
 * @param scoresByStrategy - Map of strategy to score
 * @param weights - Optional weights for each strategy
 * @returns Combined score (0-1)
 */
export function combineScores(
  scoresByStrategy: Partial<Record<RecommendationStrategy, number>>,
  weights: Partial<Record<RecommendationStrategy, number>> = {}
): number {
  const strategies = Object.keys(scoresByStrategy) as RecommendationStrategy[];

  if (strategies.length === 0) {
    return 0;
  }

  if (strategies.length === 1) {
    return scoresByStrategy[strategies[0]] ?? 0;
  }

  let totalWeightedScore = 0;
  let totalWeight = 0;

  for (const strategy of strategies) {
    const score = scoresByStrategy[strategy] ?? 0;
    const weight = weights[strategy] ?? 1.0;

    // Skip strategies with zero weight
    if (weight === 0) continue;

    totalWeightedScore += score * weight;
    totalWeight += weight;
  }

  return totalWeight > 0 ? totalWeightedScore / totalWeight : 0;
}

import {
  ScoredMediaCandidate,
  ScoredTimelineCandidate,
} from './base-strategy';

/**
 * Strategy weights configuration
 * Maps strategy names to their weights (0-1)
 */
export type StrategyWeights = Partial<Record<RecommendationStrategy, number>>;

/**
 * Default weights for strategies (all equal)
 */
export const DEFAULT_STRATEGY_WEIGHTS: StrategyWeights = {
  [RecommendationStrategy.SAME_ENTITY]: 1.0,
  [RecommendationStrategy.ADJACENT_SHOT]: 1.0,
  [RecommendationStrategy.TEMPORAL_NEARBY]: 1.0,
  [RecommendationStrategy.CONFIDENCE_DURATION]: 1.0,
};

/**
 * Candidate with strategy information
 */
interface CandidateWithStrategy<T> {
  candidate: T;
  strategy: RecommendationStrategy;
}

/**
 * Score Combiner for recommendation strategies
 */
export class ScoreCombiner {
  constructor(private weights: StrategyWeights = DEFAULT_STRATEGY_WEIGHTS) {}

  /**
   * Combine media candidates from multiple strategies
   *
   * Groups candidates by segment (startTime, endTime) and combines their scores
   * using weighted averaging based on strategy weights.
   *
   * @param candidatesByStrategy - Map of strategy to candidates
   * @returns Combined and deduplicated candidates
   */
  combineMediaCandidates(
    candidatesByStrategy: Map<
      RecommendationStrategy,
      ScoredMediaCandidate[]
    >,
  ): ScoredMediaCandidate[] {
    // Group candidates by segment key (startTime-endTime)
    const candidateGroups = new Map<
      string,
      CandidateWithStrategy<ScoredMediaCandidate>[]
    >();

    for (const [strategy, candidates] of candidatesByStrategy.entries()) {
      // Skip strategies with zero weight
      const weight = this.weights[strategy] ?? 0;
      if (weight === 0) continue;

      for (const candidate of candidates) {
        const key = this.getMediaSegmentKey(candidate);
        if (!candidateGroups.has(key)) {
          candidateGroups.set(key, []);
        }
        candidateGroups.get(key)!.push({ candidate, strategy });
      }
    }

    // Combine scores for each group
    const combined: ScoredMediaCandidate[] = [];

    for (const [key, group] of candidateGroups.entries()) {
      if (group.length === 0) continue;

      // If only one strategy contributed, use it directly
      if (group.length === 1) {
        combined.push(group[0].candidate);
        continue;
      }

      // Calculate weighted average score
      let totalWeightedScore = 0;
      let totalWeight = 0;

      for (const { candidate, strategy } of group) {
        const weight = this.weights[strategy] ?? 1.0;
        totalWeightedScore += candidate.score * weight;
        totalWeight += weight;
      }

      const combinedScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;

      // Use the first candidate as base and update score
      const baseCand = group[0].candidate;
      const strategies = group.map((g) => g.strategy);

      combined.push({
        ...baseCand,
        score: combinedScore,
        reason: this.combineReasons(
          group.map((g) => g.candidate.reason),
          strategies,
        ),
        reasonData: {
          ...baseCand.reasonData,
          combinedStrategies: strategies,
          individualScores: Object.fromEntries(
            group.map((g) => [g.strategy, g.candidate.score]),
          ),
        },
      });
    }

    return combined;
  }

  /**
   * Combine timeline candidates from multiple strategies
   *
   * Groups candidates by clipId and combines their scores using weighted averaging.
   *
   * @param candidatesByStrategy - Map of strategy to candidates
   * @returns Combined and deduplicated candidates
   */
  combineTimelineCandidates(
    candidatesByStrategy: Map<
      RecommendationStrategy,
      ScoredTimelineCandidate[]
    >,
  ): ScoredTimelineCandidate[] {
    // Group candidates by clipId
    const candidateGroups = new Map<
      string,
      CandidateWithStrategy<ScoredTimelineCandidate>[]
    >();

    for (const [strategy, candidates] of candidatesByStrategy.entries()) {
      // Skip strategies with zero weight
      const weight = this.weights[strategy] ?? 0;
      if (weight === 0) continue;

      for (const candidate of candidates) {
        const clipId = candidate.clipId;
        if (!candidateGroups.has(clipId)) {
          candidateGroups.set(clipId, []);
        }
        candidateGroups.get(clipId)!.push({ candidate, strategy });
      }
    }

    // Combine scores for each group
    const combined: ScoredTimelineCandidate[] = [];

    for (const [clipId, group] of candidateGroups.entries()) {
      if (group.length === 0) continue;

      // If only one strategy contributed, use it directly
      if (group.length === 1) {
        combined.push(group[0].candidate);
        continue;
      }

      // Calculate weighted average score
      let totalWeightedScore = 0;
      let totalWeight = 0;

      for (const { candidate, strategy } of group) {
        const weight = this.weights[strategy] ?? 1.0;
        totalWeightedScore += candidate.score * weight;
        totalWeight += weight;
      }

      const combinedScore = totalWeight > 0 ? totalWeightedScore / totalWeight : 0;

      // Use the first candidate as base and update score
      const baseCand = group[0].candidate;
      const strategies = group.map((g) => g.strategy);

      combined.push({
        ...baseCand,
        score: combinedScore,
        reason: this.combineReasons(
          group.map((g) => g.candidate.reason),
          strategies,
        ),
        reasonData: {
          ...baseCand.reasonData,
          combinedStrategies: strategies,
          individualScores: Object.fromEntries(
            group.map((g) => [g.strategy, g.candidate.score]),
          ),
        },
      });
    }

    return combined;
  }

  /**
   * Generate a segment key for media candidates
   */
  private getMediaSegmentKey(candidate: ScoredMediaCandidate): string {
    // Round to 2 decimal places to handle floating point precision
    const start = Math.round(candidate.startTime * 100) / 100;
    const end = Math.round(candidate.endTime * 100) / 100;
    return `${start}-${end}`;
  }

  /**
   * Combine multiple reason strings into one
   */
  private combineReasons(
    reasons: string[],
    strategies: RecommendationStrategy[],
  ): string {
    if (reasons.length === 1) {
      return reasons[0];
    }

    // Create a combined reason mentioning multiple strategies
    const strategyNames = strategies
      .map((s) => s.replace(/_/g, ' '))
      .join(', ');
    return `Recommended by multiple strategies: ${strategyNames}`;
  }

  /**
   * Get the effective weight for a strategy
   */
  getWeight(strategy: RecommendationStrategy): number {
    return this.weights[strategy] ?? 1.0;
  }

  /**
   * Check if a strategy is enabled (weight > 0)
   */
  isStrategyEnabled(strategy: RecommendationStrategy): boolean {
    const weight = this.weights[strategy] ?? 1.0;
    return weight > 0;
  }

  /**
   * Get all enabled strategies
   */
  getEnabledStrategies(): RecommendationStrategy[] {
    return Object.values(RecommendationStrategy).filter((strategy) =>
      this.isStrategyEnabled(strategy),
    );
  }
}
