#!/usr/bin/env node

/**
 * Generate a bcrypt hash for DASHBOARD_PASSWORD
 * 
 * Usage:
 *   node scripts/generate-dashboard-password.js "your-password"
 *   
 * Or interactively:
 *   node scripts/generate-dashboard-password.js
 */

import bcrypt from 'bcrypt';
import { createInterface } from 'readline';

const SALT_ROUNDS = 10; // Good balance of security and performance

async function generateHash(password) {
  try {
    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    console.log('\n✅ Bcrypt hash generated successfully!\n');
    console.log('Add this to your .env file:');
    console.log('━'.repeat(60));
    console.log(`DASHBOARD_PASSWORD=${hash}`);
    console.log('━'.repeat(60));
    console.log('\nSecurity note: This hash is safe to store in version control');
    console.log('if your repository is private, but the original password should');
    console.log('never be committed to version control.\n');
  } catch (error) {
    console.error('❌ Error generating hash:', error.message);
    process.exit(1);
  }
}

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length > 0) {
    // Password provided as command-line argument
    const password = args[0];
    await generateHash(password);
  } else {
    // Interactive mode
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });

    console.log('\n🔐 Dashboard Password Hash Generator\n');
    console.log('This script will generate a secure bcrypt hash for your dashboard password.');
    console.log('The hash can be safely stored in your .env file.\n');

    rl.question('Enter your dashboard password: ', async (password) => {
      rl.close();
      
      if (!password || password.length < 8) {
        console.error('\n❌ Error: Password must be at least 8 characters long');
        process.exit(1);
      }
      
      await generateHash(password);
    });
  }
}

main();
