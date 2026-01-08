export const QUEUE_NAMES = {
  TRANSCODE: 'transcode',
  INTELLIGENCE: 'intelligence',
  RENDER: 'render',
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];
