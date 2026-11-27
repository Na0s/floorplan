import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { shopApp, scanAndBuild, cleanup, run } from './helpers.mjs';

let root, server, port, origin, key, token, output = '';
const freePort = () => new Promise((resolve, reject) => {
  const socket = net.createServer(); socket.once('error', reject);
  socket.listen(0, '0.0.0.0', () => { const p = socket.address().port; socket.close(() => resolve(p)); });
});
async function start() {
  server = spawn(process.execPath, [path.join(root, 'floorplan/serve.mjs'), '--lan', '--public-url', origin, '--port', String(port), '--no-open'], {
    cwd: root, env: { ...process.env, FLOORPLAN_CLAUDE: path.join(root, 'missing-cli'), FLOORPLAN_CODEX: path.join(root, 'missing-cli'), FLOORPLAN_NO_PROMPTS: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('LAN server did not start')), 20000);
    server.stdout.on('data', chunk => { output += chunk; if (String(chunk).includes('Floorplan:')) { clearTimeout(timer); resolve(); } });
    server.stderr.on('data', () => {});
    server.once('exit', () => { clearTimeout(timer); reject(new Error('LAN server exited before listening')); });
  });
}
async function stop() {
  if (server?.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
}
const request = (route, { host = new URL(origin).host, connect = '127.0.0.1', method = 'GET', headers = {}, body = '' } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: connect, port, path: route, method, headers: { host, ...headers } }, res => {
    let text = ''; res.on('data', c => { text += c; });
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
  });
  req.on('error', reject); req.setTimeout(3000, () => req.destroy(new Error('HTTP test request timed out'))); req.end(body);
});
const login = (value = key, extra = {}) => request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin, ...extra }, body: new URLSearchParams({ accessKey: value }).toString() });
const getCookie = response => response.headers['set-cookie'][0].split(';')[0];

before(async () => {
  root = shopApp(); scanAndBuild(root); port = await freePort(); origin = `http://192.0.2.45:${port}`;
  await start();
  key = fs.readFileSync(path.join(root, 'floorplan/.cache/lan-access-key.txt'), 'utf8').trim();
  token = JSON.parse(fs.readFileSync(path.join(root, 'floorplan/.cache/server.json'), 'utf8')).token;
});
after(async () => { await stop(); cleanup(root); });

test('network users cannot receive the map or use its API before signing in', async () => {
  const page = await request('/'); assert.equal(page.status, 401);
  assert.ok(page.text.includes('Access key')); assert.ok(!page.text.includes('window.FLOORPLAN'));
  assert.ok(!page.text.includes(token) && !page.text.includes(key));
  assert.equal((await request('/api/flows', { headers: { 'x-floorplan-token': token } })).status, 401);
  assert.equal((await request('/', { host: `evil.example:${port}` })).status, 403);
});

test('key storage is private and the key is absent from logs and URLs', () => {
  assert.match(key, /^[0-9a-f]{64}$/); assert.ok(!output.includes(key));
  const state = JSON.parse(fs.readFileSync(path.join(root, 'floorplan/.cache/server.json'), 'utf8'));
  assert.equal(state.publicUrl, origin); assert.ok(!JSON.stringify(state).includes(key));
  if (process.platform !== 'win32') for (const file of ['lan-access-key.txt', 'server.json']) assert.equal(fs.statSync(path.join(root, 'floorplan/.cache', file)).mode & 0o777, 0o600);
});

test('bad keys, cross-origin logins and oversized bodies fail without crashing', async () => {
  assert.equal((await login('wrong')).status, 401);
  assert.equal((await login('é'.repeat(64))).status, 401);
  assert.equal((await login(key, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await request('/login', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'a'.repeat(1025) })).status, 413);
  assert.equal((await request('/login')).status, 200);
  assert.equal((await request('//[/')).status, 400);
  assert.equal((await request('/login')).status, 200);
});

test('a valid login grants a cookie, while API token and origin checks remain mandatory', async () => {
  const response = await login(); assert.equal(response.status, 303);
  const cookie = getCookie(response);
  assert.match(response.headers['set-cookie'][0], /HttpOnly; SameSite=Strict; Max-Age=43200/);
  const page = await request('/', { headers: { cookie } }); assert.equal(page.status, 200); assert.ok(page.text.includes('window.FLOORPLAN'));
  assert.equal((await request('/api/flows', { headers: { cookie } })).status, 403);
  assert.equal((await request('/api/flows', { headers: { cookie, 'x-floorplan-token': token, origin } })).status, 200);
  assert.equal((await request('/api/flows', { headers: { cookie, 'x-floorplan-token': token, origin: 'https://evil.example' } })).status, 403);
});

test('even authenticated clients cannot download state, keys, worksheets or source', async () => {
  const cookie = getCookie(await login());
  for (const route of ['/.cache/server.json', '/.cache/lan-access-key.txt', '/%2ecache/server.json', '/graph.json', '/serve.mjs', '/..%2fshop-api%2fconfig.js']) {
    const response = await request(route, { headers: { cookie } }); assert.equal(response.status, 404, route); assert.ok(!response.text.includes(key));
  }
});

test('logout revokes the session, rather than only clearing the browser cookie', async () => {
  const cookie = getCookie(await login());
  const response = await request('/api/logout', { method: 'POST', headers: { cookie, origin, 'x-floorplan-token': token } });
  assert.equal(response.status, 204); assert.match(response.headers['set-cookie'][0], /Max-Age=0/);
  assert.equal((await request('/', { headers: { cookie } })).status, 401);
});

test('open reuses matching LAN settings and invalid settings leave the server running', () => {
  const stateFile = path.join(root, 'floorplan/.cache/server.json');
  const pid = JSON.parse(fs.readFileSync(stateFile, 'utf8')).pid;
  const report = run('open.mjs', root, '--lan', '--public-url', origin, '--port', String(port), '--no-open');
  assert.ok(report.includes(origin)); assert.ok(!report.includes(key));
  assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).pid, pid);
  for (const args of [['--lan'], ['--lan', '--public-url', origin + '/wrong'], ['--public-url', origin]]) {
    assert.throws(() => run('open.mjs', root, ...args, '--no-open'));
    assert.equal(JSON.parse(fs.readFileSync(stateFile, 'utf8')).pid, pid);
    assert.doesNotThrow(() => process.kill(pid, 0));
  }
});

test('loopback management still works but a network client cannot spoof a loopback Host', async t => {
  assert.equal((await request('/', { host: `127.0.0.1:${port}` })).status, 200);
  const address = Object.values(os.networkInterfaces()).flat().find(a => a?.family === 'IPv4' && !a.internal)?.address;
  if (!address) { t.skip('no non-loopback interface in this environment'); return; }
  assert.equal((await request('/', { connect: address, host: `127.0.0.1:${port}` })).status, 401);
  assert.equal((await request('/api/flows', { connect: address, host: `localhost:${port}`, headers: { 'x-floorplan-token': token } })).status, 401);
});

test('restarting revokes browser sessions while retaining the private access key', async () => {
  const cookie = getCookie(await login()); await stop(); await start();
  assert.equal(fs.readFileSync(path.join(root, 'floorplan/.cache/lan-access-key.txt'), 'utf8').trim(), key);
  assert.equal((await request('/', { headers: { cookie } })).status, 401);
  assert.equal((await login()).status, 303);
});

test('LAN configuration fails closed without an explicit safe origin', () => {
  for (const value of ['', 'http://0.0.0.0:4378', 'http://user:pass@example.com', 'http://example.com/path', 'http://example.com/?key=oops', 'file:///tmp/map']) {
    const result = spawnSync(process.execPath, [path.join(root, 'floorplan/serve.mjs'), '--lan', '--public-url', value, '--no-open'], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1, value); assert.ok(!result.stdout.includes(key));
  }
});
