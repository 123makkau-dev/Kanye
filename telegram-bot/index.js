const path = require('path');
global.__basedir = path.dirname(process.argv[1]);

require('dotenv').config({ path: path.join(global.__basedir, '.env') });

const db         = require('./db');
const bot        = require('./bot');
const torManager = require('./tor-manager');

async function start() {
  console.log('──────────────────────────────────────────');
  console.log(`📁 Base directory: ${global.__basedir}`);
  console.log('📦 Running as: Telegram Bot (Node.js)');
  console.log('──────────────────────────────────────────');

  console.log('🌐 Connecting to shared Tor proxy...');
  try {
    await torManager.startTor();
    console.log('✅ Tor ready — Instagram API access enabled');
  } catch (e) {
    console.error('⚠️  Tor not ready:', e.message, '— will retry in background');
  }

  console.log('🔄 Connecting to MongoDB...');
  await db.connect();

  console.log('🤖 Starting Telegram bot...');
  await bot.start();
}

start().catch(err => {
  console.error('❌ Startup failed:', err);
  process.exit(1);
});
