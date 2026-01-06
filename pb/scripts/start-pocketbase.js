#!/usr/bin/env node

import { spawn } from 'child_process';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { platform } from 'os';

const POCKETBASE_DIR = join(process.cwd(), 'pocketbase');
const DATA_DIR = join(POCKETBASE_DIR, 'pb_data');
const MIGRATIONS_DIR = join(POCKETBASE_DIR, 'pb_migrations');

function startPocketBase() {
  console.log('🚀 Starting PocketBase...');
  
  const filename = platform() === 'win32' ? 'pocketbase.exe' : 'pocketbase';
  const pbPath = join(POCKETBASE_DIR, filename);
  
  if (!existsSync(pbPath)) {
    console.error('❌ PocketBase not found. Run "yarn pb:download" first.');
    process.exit(1);
  }
  
  // Create directories if they don't exist
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
  
  if (!existsSync(MIGRATIONS_DIR)) {
    mkdirSync(MIGRATIONS_DIR, { recursive: true });
  }
  
  // Start PocketBase
  const pb = spawn(pbPath, ['serve', '--dir', POCKETBASE_DIR, '--dev'], {
    stdio: 'inherit',
    cwd: POCKETBASE_DIR
  });
  
  pb.on('error', (error) => {
    console.error('❌ Failed to start PocketBase:', error.message);
    process.exit(1);
  });
  
  pb.on('close', (code) => {
    console.log(`PocketBase exited with code ${code}`);
  });
  
  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\n🛑 Stopping PocketBase...');
    pb.kill('SIGINT');
  });
  
  process.on('SIGTERM', () => {
    pb.kill('SIGTERM');
  });
}

startPocketBase();