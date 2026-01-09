export const QUEUE_NAMES = {
  TRANSCODE: 'transcode',
  INTELLIGENCE: 'intelligence',
  RENDER: 'render',
  LABELS: 'labels',
  MEDIA_RECOMMENDATIONS: 'media_recommendations',
  TIMELINE_RECOMMENDATIONS: 'timeline_recommendations',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
