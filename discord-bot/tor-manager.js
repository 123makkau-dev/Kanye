/**
 * tor-manager.js
 * Singleton Tor process manager — spawns Tor once and keeps it alive.
 * Provides a SOCKS5 proxy on 127.0.0.1:9050 for routing Instagram API requests.
 * Supports circuit rotation via SIGNAL NEWNYM when exit nodes are blocked.
 */

const { spawn, execSync } = require('child_process');
const fs  = require('fs');
const net = require('net');

const SOCKS_PORT   = 9050;
const CONTROL_PORT = 9051;
const TOR_DATA     = '/tmp/tor-bot-data';
const TORRC_PATH   = '/tmp/torrc-bot';

let torProc       = null;
let _isReady      = false;
let _startPromise = null;
let _restartTimer = null;
let _lastNewnym   = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writeTorrc() {
  fs.mkdirSync(TOR_DATA, { recursive: true });
  fs.writeFileSync(TORRC_PATH, [
    `DataDirectory ${TOR_DATA}`,
    `SocksPort 127.0.0.1:${SOCKS_PORT}`,
    `ControlPort 127.0.0.1:${CONTROL_PORT}`,
    // Log to stdout so Node.js can detect bootstrap progress
    'Log notice stdout',
    'ReachableAddresses *:80,*:443',
    'StrictNodes 0',
    'DisableNetwork 0',
  ].join('\n') + '\n');
}

function waitForPort(port, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeout;
    function attempt() {
      const sock = net.createConnection({ host: '127.0.0.1', port });
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        if (Date.now() > deadline) return reject(new Error(`Port ${port} never opened`));
        setTimeout(attempt, 300);
      });
    }
    attempt();
  });
}

// ─── Circuit rotation ─────────────────────────────────────────────────────────

/**
 * Ask Tor for a new circuit (new exit node).
 * NEWNYM is rate-limited by Tor to once every 10 s.
 */
function newCircuit() {
  return new Promise((resolve) => {
    const now = Date.now();
    // Respect Tor's built-in NEWNYM cooldown (10 s)
    const wait = Math.max(0, 10000 - (now - _lastNewnym));
    setTimeout(() => {
      _lastNewnym = Date.now();
      const sock = net.createConnection({ host: '127.0.0.1', port: CONTROL_PORT });
      sock.once('connect', () => {
        sock.write('AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\nQUIT\r\n');
      });
      sock.once('data', () => sock.destroy());
      sock.once('error', () => {});
      sock.once('close', () => {
        // Give the new circuit time to build
        setTimeout(resolve, 3000);
      });
    }, wait);
  });
}

// ─── Core spawn logic ─────────────────────────────────────────────────────────

function _spawn() {
  return new Promise((resolve, reject) => {
    writeTorrc();

    torProc = spawn('tor', ['-f', TORRC_PATH], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    let settled = false;
    const settle = (err) => {
      if (settled) return;
      settled = true;
      _startPromise = null;
      if (err) reject(err); else resolve();
    };

    const onData = (chunk) => {
      const line = chunk.toString();
      if (line.includes('Bootstrapped 100%')) {
        _isReady = true;
        console.log('[tor] ✅ Ready');
        waitForPort(SOCKS_PORT, 10000).then(() => settle()).catch(settle);
      }
    };

    torProc.stdout.on('data', onData);
    torProc.stderr.on('data', onData);

    torProc.on('exit', (code) => {
      _isReady = false;
      torProc   = null;
      _startPromise = null;
      console.warn(`[tor] Process exited (code=${code}) — restarting in 8 s`);
      if (_restartTimer) clearTimeout(_restartTimer);
      _restartTimer = setTimeout(() => {
        startTor().catch(e => console.error('[tor] Auto-restart failed:', e.message));
      }, 8000);
    });

    setTimeout(() => settle(new Error('Tor bootstrap timed out after 90 s')), 90000);
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

function startTor() {
  if (_isReady && torProc) return Promise.resolve();
  if (_startPromise) return _startPromise;

  try {
    execSync(`pkill -f "tor -f ${TORRC_PATH}" 2>/dev/null || true`, { stdio: 'ignore' });
  } catch (_) {}

  _startPromise = _spawn();
  return _startPromise;
}

async function ensureReady(timeout = 60000) {
  if (_isReady) return;
  await startTor();
  const deadline = Date.now() + timeout;
  while (!_isReady) {
    if (Date.now() > deadline) throw new Error('Tor still not ready after ' + timeout + ' ms');
    await new Promise(r => setTimeout(r, 300));
  }
}

module.exports = {
  startTor,
  ensureReady,
  newCircuit,
  get isReady() { return _isReady; },
  SOCKS_PORT,
};
