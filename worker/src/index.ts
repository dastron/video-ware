import express from 'express';
import { runWorker } from './task-worker.js';

const app = express();
const port = process.env.PORT || 3001;

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
});
