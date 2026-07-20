/**
 * tor-manager.js (Telegram Bot — shared Tor)
 * Reuses Bot 1's Tor SOCKS proxy on 127.0.0.1:9050.
 * No separate Tor process is spawned.
 */

const net = require('net');

const SOCKS_PORT   = 9050;
const CONTROL_PORT = 9051;

let _isReady = false;

function waitForProxy() {
  return new Promise((resolve) => {
    function attempt() {
      const sock = net.createConnection({ host: '127.0.0.1', port: SOCKS_PORT });
      sock.once('connect', () => {
        sock.destroy();
        _isReady = true;
        console.log('[tor-tg] ✅ Shared Tor proxy reachable on port', SOCKS_PORT);
        resolve();
      });
      sock.once('error', () => {
        console.log('[tor-tg] Waiting for shared Tor proxy...');
        setTimeout(attempt, 3000);
      });
    }
    attempt();
  });
}

function newCircuit() {
  let _lastNewnym = 0;
  return new Promise((resolve) => {
    const now  = Date.now();
    const wait = Math.max(0, 10000 - (now - _lastNewnym));
    setTimeout(() => {
      _lastNewnym = Date.now();
      const sock = net.createConnection({ host: '127.0.0.1', port: CONTROL_PORT });
      sock.once('connect', () => {
        sock.write('AUTHENTICATE ""\r\nSIGNAL NEWNYM\r\nQUIT\r\n');
      });
      sock.once('data', () => sock.destroy());
      sock.once('error', () => {});
      sock.once('close', () => setTimeout(resolve, 3000));
    }, wait);
  });
}

function startTor() {
  if (_isReady) return Promise.resolve();
  return waitForProxy();
}

async function ensureReady() {
  if (_isReady) return;
  await startTor();
}

module.exports = {
  startTor,
  ensureReady,
  newCircuit,
  get isReady() { return _isReady; },
  SOCKS_PORT,
};
