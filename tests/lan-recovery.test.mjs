import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { SKILL } from './helpers.mjs';

const viewer = fs.readFileSync(path.join(SKILL, 'assets/viewer.html'), 'utf8');
const start = viewer.indexOf('(function liveReload() {');
const end = viewer.indexOf('\n})();', start) + '\n})();'.length;
assert.ok(start >= 0 && end > start);
const code = viewer.slice(start, end);

async function reconnect(response) {
  const state = { reloads: 0, timers: [], messages: [] };
  class EventSource {
    static CLOSED = 2;
    constructor() { this.readyState = EventSource.CLOSED; state.events = this; }
    addEventListener() {}
  }
  vm.runInNewContext(code, {
    window: { FLOORPLAN_SERVER: { token: 'synthetic-token' } }, EventSource,
    fetch: async () => response, location: { reload: () => { state.reloads++; } },
    toast: message => state.messages.push(message),
    setTimeout: (callback, delay) => state.timers.push({ callback, delay }), Date,
  });
  state.events.onerror();
  await new Promise(setImmediate);
  return state;
}

test('a revoked LAN session reloads directly to sign-in after restart', async () => {
  const state = await reconnect({ status: 401, ok: false });
  assert.equal(state.reloads, 1); assert.equal(state.timers.length, 0); assert.deepEqual(state.messages, []);
});
test('a recovered local server keeps the normal map-updated reload', async () => {
  const state = await reconnect({ status: 200, ok: true });
  assert.equal(state.reloads, 0); assert.equal(state.timers[0].delay, 500);
  state.timers[0].callback(); assert.equal(state.reloads, 1);
});
test('a server that is not ready is retried without showing an old map as current', async () => {
  const state = await reconnect({ status: 503, ok: false });
  assert.equal(state.reloads, 0); assert.equal(state.timers[0].delay, 1000);
});
