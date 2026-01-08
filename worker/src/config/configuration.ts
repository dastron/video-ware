export default () => ({
  port: parseInt(process.env.PORT || '3001', 10),

  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },

  pocketbase: {
    url: process.env.POCKETBASE_URL,
    adminEmail: process.env.POCKETBASE_ADMIN_EMAIL,
    adminPassword: process.env.POCKETBASE_ADMIN_PASSWORD,
  },

  storage: {
    type: process.env.STORAGE_TYPE || 'local',
    localPath: process.env.STORAGE_LOCAL_PATH,
    s3Bucket: process.env.STORAGE_S3_BUCKET,
    s3Region: process.env.STORAGE_S3_REGION,
  },

  processors: {
    enableFfmpeg: process.env.ENABLE_FFMPEG !== 'false',
    enableGoogleTranscoder: process.env.ENABLE_GOOGLE_TRANSCODER === 'true',
    enableGoogleVideoIntelligence:
      process.env.ENABLE_GOOGLE_VIDEO_INTELLIGENCE === 'true',
    enableGoogleSpeech: process.env.ENABLE_GOOGLE_SPEECH === 'true',
  },

  watcher: {
    enabled: process.env.ENABLE_S3_WATCHER === 'true',
    pollInterval: parseInt(process.env.S3_WATCHER_POLL_INTERVAL || '60000', 10),
    watchPaths: process.env.S3_WATCHER_PATHS?.split(',') || [],
  },

  google: {
    projectId: process.env.GOOGLE_PROJECT_ID,
    keyFilename: process.env.GOOGLE_CLOUD_KEY_FILE || undefined,
    credentials: process.env.GOOGLE_CLOUD_CREDENTIALS
      ? JSON.parse(process.env.GOOGLE_CLOUD_CREDENTIALS)
      : undefined,
    gcsBucket: process.env.GCS_BUCKET,
  },

  tasks: {
    enqueuerEnabled: process.env.ENABLE_TASK_ENQUEUER !== 'false',
    enqueuerPollIntervalMs: parseInt(
      process.env.TASK_ENQUEUER_POLL_INTERVAL_MS || '5000',
      10
    ),
    enqueuerBatchSize: parseInt(
      process.env.TASK_ENQUEUER_BATCH_SIZE || '25',
      10
    ),
  },
});
