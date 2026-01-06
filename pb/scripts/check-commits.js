#!/usr/bin/env node

import { execSync } from 'child_process';

/**
 * Check if commits follow conventional commit format
 * This helps developers ensure their commits will trigger proper releases
 */

const CONVENTIONAL_COMMIT_REGEX = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore)(\(.+\))?(!)?: .{1,50}/;

function main() {
  try {
    // Get commits since last tag or all commits if no tags
    let commits;
    try {
      const lastTag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
      commits = execSync(`git log ${lastTag}..HEAD --oneline`, { encoding: 'utf8' }).trim();
    } catch {
      // No tags found, get all commits
      commits = execSync('git log --oneline', { encoding: 'utf8' }).trim();
    }

    if (!commits) {
      console.log('✅ No commits to check');
      return;
    }

    const commitLines = commits.split('\n');
    let validCommits = 0;
    let invalidCommits = 0;
    let willTriggerRelease = false;

    console.log('🔍 Checking commit messages for conventional commit format...\n');

    commitLines.forEach(line => {
      const [hash, ...messageParts] = line.split(' ');
      const message = messageParts.join(' ');
      
      if (CONVENTIONAL_COMMIT_REGEX.test(message)) {
        console.log(`✅ ${hash.substring(0, 7)} ${message}`);
        validCommits++;
        
        // Check if this commit will trigger a release
        if (message.startsWith('feat') || message.startsWith('fix') || message.includes('!')) {
          willTriggerRelease = true;
        }
      } else {
        console.log(`❌ ${hash.substring(0, 7)} ${message}`);
        invalidCommits++;
      }
    });

    console.log('\n📊 Summary:');
    console.log(`✅ Valid commits: ${validCommits}`);
    console.log(`❌ Invalid commits: ${invalidCommits}`);
    
    if (willTriggerRelease) {
      console.log('🚀 These commits will trigger a release when merged to main');
    } else {
      console.log('📝 No release-triggering commits found (feat, fix, or breaking changes)');
    }

    if (invalidCommits > 0) {
      console.log('\n💡 Invalid commits should follow this format:');
      console.log('   <type>[optional scope]: <description>');
      console.log('   Examples:');
      console.log('   - feat(cli): add new command');
      console.log('   - fix(migration): resolve parsing issue');
      console.log('   - docs: update README');
      console.log('   - feat!: breaking change');
      process.exit(1);
    }

  } catch (error) {
    console.error('❌ Error checking commits:', error.message);
    process.exit(1);
  }
}

main();