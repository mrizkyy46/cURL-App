import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCurl, buildUrl } from '../src/public/js/parser.js';
import { createHistoryStore, HISTORY_KEY, HISTORY_LIMIT, HISTORY_MAX_CHARACTERS } from '../src/public/js/history.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
}
const sample = () => parseCurl("curl 'https://example.com/api?tag=a&tag=b&sig=%2f%20' -H 'Content-Type: application/json' -H 'X-Test: before' --data-raw '{\"ok\":true}'");

test('history persists detached snapshots with disabled fields, body and original query encoding', () => {
  const data = storage(), history = createHistoryStore(() => data), request = sample();
  request.params[0].enabled = false; request.headers[1].enabled = false;
  assert.deepEqual(history.list(), []);
  history.save(request);
  const restored = createHistoryStore(() => data).list()[0].request;
  assert.deepEqual(restored, request);
  assert.equal(buildUrl(restored), 'https://example.com/api?tag=b&sig=%2f%20');
  request.body = 'changed'; restored.params[1].value = 'changed';
  assert.equal(history.list()[0].request.body, '{"ok":true}');
  assert.equal(history.list()[0].request.params[1].value, 'b');
});

test('saving exact duplicates moves the snapshot to the front and retains different edits', () => {
  const data = storage(), history = createHistoryStore(() => data);
  const first = sample(), second = sample(); second.body = 'second';
  history.save(first); history.save(second); history.save(first);
  assert.equal(history.list().length, 2);
  assert.equal(history.list()[0].request.body, first.body);
  assert.equal(history.list()[1].request.body, 'second');
});

test('history retains the newest 50 entries and supports single deletion and clearing', () => {
  const data = storage(), history = createHistoryStore(() => data);
  for (let i = 0; i < HISTORY_LIMIT + 2; i++) { const request = sample(); request.body = String(i); history.save(request); }
  assert.equal(history.list().length, HISTORY_LIMIT);
  assert.equal(history.list()[0].request.body, String(HISTORY_LIMIT + 1));
  assert.equal(history.list().at(-1).request.body, '2');
  history.remove(history.list()[0].id);
  assert.equal(history.list().length, HISTORY_LIMIT - 1);
  assert.equal(history.list()[0].request.body, String(HISTORY_LIMIT));
  history.clear(); assert.deepEqual(history.list(), []); assert.equal(data.getItem(HISTORY_KEY), null);
});

test('history bounds total storage, evicts oldest entries, and preserves data for oversized requests', () => {
  const data = storage(), history = createHistoryStore(() => data);
  const first = sample(); first.body = 'a'.repeat(600_000); history.save(first);
  const second = sample(); second.body = 'b'.repeat(600_000); history.save(second);
  assert.equal(history.list().length, 1); assert.equal(history.list()[0].request.body[0], 'b');
  assert.ok(data.getItem(HISTORY_KEY).length <= HISTORY_MAX_CHARACTERS);
  const before = data.getItem(HISTORY_KEY);
  second.body = 'c'.repeat(HISTORY_MAX_CHARACTERS);
  assert.throws(() => history.save(second), /too large/);
  assert.equal(data.getItem(HISTORY_KEY), before);
});

test('malformed or unexpected stored data fails visibly and can be reset', () => {
  const data = storage(), history = createHistoryStore(() => data);
  for (const value of ['broken JSON', 'null', '{"version":99,"entries":[]}', '{"version":1,"entries":[{"id":"one","savedAt":0,"request":{}}]}']) {
    data.setItem(HISTORY_KEY, value);
    assert.throws(() => history.list(), /unreadable/);
    assert.throws(() => history.save(sample()), /unreadable/);
    assert.equal(data.getItem(HISTORY_KEY), value);
    history.clear(); assert.deepEqual(history.list(), []);
  }
});

test('blocked storage and quota errors do not erase previously saved history', () => {
  const blocked = createHistoryStore(() => { throw new Error('Denied'); });
  assert.throws(() => blocked.list(), /Allow browser storage/);
  assert.throws(() => blocked.clear(), /could not be cleared/);
  const data = storage(), history = createHistoryStore(() => data); history.save(sample());
  const before = data.getItem(HISTORY_KEY);
  data.setItem = () => { throw new Error('QuotaExceededError'); };
  const request = sample(); request.body = 'new';
  assert.throws(() => history.save(request), /full or blocked/);
  assert.equal(data.getItem(HISTORY_KEY), before);
});

test('invalid URLs cannot be saved, and storage contains only expected request fields', () => {
  const data = storage(), history = createHistoryStore(() => data);
  const request = sample(); request.baseUrl = 'javascript:alert(1)';
  assert.throws(() => history.save(request), /HTTP\(S\) URL/); assert.equal(data.getItem(HISTORY_KEY), null);
  request.baseUrl = 'https://example.com'; request.unexpected = 'not persisted';
  history.save(request); assert.equal(history.list()[0].request.unexpected, undefined);
});
