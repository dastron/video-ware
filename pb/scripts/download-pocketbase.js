#!/usr/bin/env node

import { execSync } from 'child_process';
import { existsSync, mkdirSync, chmodSync, readFileSync } from 'fs';
import { join } from 'path';
import { platform, arch } from 'os';

// Read PB_VERSION from .env file
function getPocketBaseVersion() {
  try {
    const envPath = join(process.cwd(), '.env');
    if (existsSync(envPath)) {
      const envContent = readFileSync(envPath, 'utf8');
      const versionMatch = envContent.match(/^PB_VERSION=(.+)$/m);
      if (versionMatch) {
        return versionMatch[1].trim();
      }
    }
  } catch (error) {
    console.warn('⚠️  Could not read PB_VERSION from .env file');
  }
  return '0.35.0'; // fallback version
}

const POCKETBASE_VERSION = getPocketBaseVersion();
const POCKETBASE_DIR = join(process.cwd(), 'pocketbase');

function getPocketBaseUrl() {
  const platformMap = {
    'darwin': 'darwin',
    'linux': 'linux',
    'win32': 'windows'
  };
  
  const archMap = {
    'x64': 'amd64',
    'arm64': 'arm64'
  };
  
  const os = platformMap[platform()];
  const architecture = archMap[arch()];
  
  if (!os || !architecture) {
    throw new Error(`Unsupported platform: ${platform()}-${arch()}`);
  }
  
  const extension = platform() === 'win32' ? 'zip' : 'zip';
  return `https://github.com/pocketbase/pocketbase/releases/download/v${POCKETBASE_VERSION}/pocketbase_${POCKETBASE_VERSION}_${os}_${architecture}.${extension}`;
}

async function downloadPocketBase() {
  console.log(`📦 Setting up PocketBase v${POCKETBASE_VERSION}...`);
  
  if (!existsSync(POCKETBASE_DIR)) {
    mkdirSync(POCKETBASE_DIR, { recursive: true });
  }
  
  const url = getPocketBaseUrl();
  const filename = platform() === 'win32' ? 'pocketbase.exe' : 'pocketbase';
  const filepath = join(POCKETBASE_DIR, filename);
  
  if (existsSync(filepath)) {
    console.log('✅ PocketBase already downloaded');
    return;
  }
  
  console.log(`⬇️  Downloading PocketBase from ${url}`);
  
  try {
    // Download and extract
    execSync(`curl -L "${url}" -o "${POCKETBASE_DIR}/pocketbase.zip"`, { stdio: 'inherit' });
    execSync(`cd "${POCKETBASE_DIR}" && unzip -o pocketbase.zip`, { stdio: 'inherit' });
    
    // Make executable on Unix systems
    if (platform() !== 'win32') {
      chmodSync(filepath, '755');
    }
    
    // Clean up zip file
    execSync(`rm "${POCKETBASE_DIR}/pocketbase.zip"`, { stdio: 'inherit' });
    
    console.log('✅ PocketBase downloaded successfully');
  } catch (error) {
    console.error('❌ Failed to download PocketBase:', error.message);
    process.exit(1);
  }
}

downloadPocketBase();