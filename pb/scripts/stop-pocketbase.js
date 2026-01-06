#!/usr/bin/env node

import { execSync } from 'child_process';
import { platform } from 'os';

function stopPocketBase() {
  console.log('🛑 Stopping PocketBase...');
  
  try {
    if (platform() === 'win32') {
      // Windows
      execSync('taskkill /f /im pocketbase.exe', { stdio: 'inherit' });
    } else {
      // Unix-like systems
      execSync('pkill -f pocketbase', { stdio: 'inherit' });
    }
    console.log('✅ PocketBase stopped');
  } catch (error) {
    console.log('ℹ️  No PocketBase process found or already stopped');
  }
}

stopPocketBase();