// ─── EXE-safe base directory ──────────────────────────────────────────────────
// When running as pkg exe: process.execPath = path to exe, process.pkg is defined
// When running as node: process.argv[1] = path to script
const path = require('path');

// Detect if running inside pkg exe
const isPkg = typeof process.pkg !== 'undefined';

// Base directory = folder where the exe (or script) lives
const BASE_DIR = isPkg
  ? path.dirname(process.execPath)    // exe folder
  : path.dirname(process.argv[1]);    // script folder (same as __dirname for index.js)

// Make it globally available for bot.js and db.js
global.__basedir = BASE_DIR;

// Load .env from the exe/script directory
require('dotenv').config({ path: path.join(BASE_DIR, '.env') });

const db  = require('./db');
const bot = require('./bot');

async function start() {
  console.log('──────────────────────────────────────────');
  console.log(`📁 Base directory: ${BASE_DIR}`);
  console.log(`📦 Running as: ${isPkg ? 'EXE (pkg)' : 'Node.js script'}`);
  console.log('──────────────────────────────────────────');

  console.log('🔄 Connecting to MongoDB...');
  await db.connect();

  console.log('🤖 Starting Discord bot...');
  await bot.start();
}

start().catch(err => {
  console.error('❌ Startup failed:', err);
  process.exit(1);
});
