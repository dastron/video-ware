import express from 'express';
import { runWorker } from './task-worker.js';
import { startS3Watcher } from './s3-watcher-startup.js';

const app = express();
const port = 3001;

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Status endpoint (can be expanded later)
app.get('/status', (req, res) => {
  res.status(200).json({
    status: 'running',
    version: '1.0.0',
    uptime: process.uptime(),
  });
});

app.listen(port, () => {
  console.log(`[Worker Service] Monitoring server listening on port ${port}`);

  // Start the background worker loop
  runWorker().catch((error) => {
    console.error('[Worker Service] Fatal error in worker loop:', error);
    process.exit(1);
  });

  // Start S3 watcher if enabled
  startS3Watcher().catch((error) => {
    console.error('[Worker Service] Error starting S3 watcher:', error);
    // Don't exit - watcher is optional
  });
});
