import test from 'node:test';
import assert from 'node:assert/strict';
import { recordsPlan } from '../src/lib/record_queries.ts';
import { createRecordPager } from '../src/lib/record_pager.ts';

const owner = { uid: 'owner-a', role: 'organizer', isActive: true };
const admin = { uid: 'admin-a', role: 'admin', isActive: true };
const deferred = () => { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; }); return { promise, resolve, reject }; };
const record = (id, createdAt = 0, extra = {}) => ({ id, createdAt, ...extra });

// In-memory server: honors the production plan's filters/order, reports the
// documents actually read, and uses full sort-value/ID cursors, not offsets.
function server(plan, data) {
  let next, failed, stopped = 0, subscriptions = 0, pending;
  const reads = [], refreshed = [];
  function compare(a, b) {
    for (const { field, direction } of plan.order) {
      const left = field === '__name__' ? a.id : a.cursor[field];
      const right = field === '__name__' ? b.id : b.cursor[field];
      if (left < right) return direction === 'asc' ? -1 : 1;
      if (left > right) return direction === 'asc' ? 1 : -1;
    }
    return 0;
  }
  const row = value => ({ id: value.id, value, cursor: { ...value } });
  function matching() {
    return data.filter(item => plan.filters.every(filter => item[filter.field] === filter.value) && plan.order.every(order => order.field === '__name__' || order.field in item)).map(row).sort(compare);
  }
  const source = {
    compare,
    listen(callback, error) { subscriptions++; next = callback; failed = error; return () => stopped++; },
    async read(after, before) {
      const rows = matching().filter(item => compare(item, row(after)) > 0 && (!before || compare(item, row(before)) < 0)).slice(0, plan.pageSize);
      reads.push({ after: after.id, before: before?.id, ids: rows.map(item => item.id), limit: plan.pageSize });
      return pending ? pending.promise : rows;
    },
    async refresh(previous) { refreshed.push(previous.id); return matching().find(item => item.id === previous.id); },
  };
  const pager = createRecordPager(source, plan.pageSize);
  pager.start();
  return { pager, source, reads, refreshed, data, emit: () => next(matching().slice(0, plan.pageSize)), emitRows: next, fail: error => failed(error),
    delay: value => { pending = value; }, get subscriptions() { return subscriptions; }, get stopped() { return stopped; } };
}

test('load more uses distinct bounded cursor pages without rereading earlier prefixes or resubscribing', async () => {
  const plan = recordsPlan('users', admin);
  const s = server(plan, Array.from({ length: 450 }, (_, i) => ({ id: `user-${String(i).padStart(3, '0')}` })));
  assert.equal(s.pager.getSnapshot().loading, true);
  s.emit();
  assert.equal(s.pager.getSnapshot().items.length, 200);
  await s.pager.loadMore();
  await s.pager.loadMore();
  assert.deepEqual(s.reads.map(read => [read.after, read.ids.length, read.limit]), [['user-199', 200, 200], ['user-399', 50, 200]]);
  assert.equal(new Set(s.reads.flatMap(read => read.ids)).size, 250);
  assert.equal(s.subscriptions, 1);
  assert.equal(s.pager.getSnapshot().items.length, 450);
  assert.equal(s.pager.getSnapshot().hasMore, false);
  await s.pager.loadMore();
  assert.equal(s.reads.length, 2);
  s.pager.dispose();
  assert.equal(s.stopped, 1);
});

test('newest operational advice beyond the first 200 IDs is in the live head, with stable timestamp ties', async () => {
  for (const collection of ['routeSuggestions', 'collisionAlerts', 'arrivalNotifications', 'announcements', 'accessCodes']) {
    const plan = recordsPlan(collection, owner, 'eventId', 'event-a');
    const data = Array.from({ length: 240 }, (_, i) => record(`a-${String(i).padStart(3, '0')}`, 1, { eventId: 'event-a' }));
    data.push(record('zz-newest', 1000, { eventId: 'event-a' }));
    const s = server(plan, data);
    s.emit();
    assert.equal(s.pager.getSnapshot().items[0].id, 'zz-newest', collection);
    await s.pager.loadMore();
    assert.equal(s.pager.getSnapshot().items.length, 241);
    assert.equal(new Set(s.pager.getSnapshot().items.map(item => item.id)).size, 241);
    assert.equal(s.pager.getSnapshot().items[1].id, 'a-239');
    s.pager.dispose();
  }
});

test('active/pending filtering happens before the limit, not after a page of obsolete advice', () => {
  for (const [collection, status] of [['collisionAlerts', 'active'], ['routeSuggestions', 'pending']]) {
    const plan = recordsPlan(collection, owner, 'eventId', 'event-a', { status });
    const data = Array.from({ length: 300 }, (_, i) => record(`old-${i}`, 1000 + i, { eventId: 'event-a', status: 'resolved' }));
    data.push(record('current', 10, { eventId: 'event-a', status }), record('foreign', 2000, { eventId: 'event-b', status }));
    const s = server(plan, data);
    s.emit();
    assert.deepEqual(s.pager.getSnapshot().items.map(item => item.id), ['current']);
    s.pager.dispose();
  }
});

test('every timestamp-free consumer retains oldest minimal planning/profile fixtures', () => {
  const scopes = [['events'], ['users'], ['groups', 'eventId'], ['routes', 'eventId'], ['groupProgress', 'eventId'], ['stopPoints', 'routeId'], ['routeSegments', 'routeId']];
  for (const [collection, field] of scopes) {
    const plan = recordsPlan(collection, admin, field, field ? 'scope-a' : undefined);
    const s = server(plan, [{ id: 'legacy', ...(field ? { [field]: 'scope-a' } : {}) }]);
    s.emit();
    assert.equal(s.pager.getSnapshot().items[0].id, 'legacy', collection);
    assert.deepEqual(plan.order, [{ field: '__name__', direction: 'asc' }]);
    s.pager.dispose();
  }
});

test('ownership filters cannot be replaced by requested event/status filters or an empty selector', () => {
  const plan = recordsPlan('events', owner, 'status', 'active');
  assert.deepEqual(plan.filters, [{ field: 'status', value: 'active' }, { field: 'organizerId', value: 'owner-a' }]);
  assert.equal(recordsPlan('events', owner, 'organizerId', 'foreign-owner').enabled, false);
  for (const collection of ['groups', 'routes', 'announcements', 'accessCodes', 'arrivalNotifications', 'routeSuggestions', 'collisionAlerts', 'groupProgress']) {
    assert.equal(recordsPlan(collection, owner).enabled, false, collection);
    assert.equal(recordsPlan(collection, owner, 'eventId', '').enabled, false, collection);
  }
  assert.equal(recordsPlan('stopPoints', owner, 'routeId', '').enabled, false);
  assert.equal(recordsPlan('users', owner).enabled, false);
  assert.equal(recordsPlan('events', { ...owner, uid: undefined }).enabled, false);
  assert.equal(recordsPlan('events', { ...owner, isActive: false }).enabled, false);
  assert.notEqual(recordsPlan('routeSuggestions', owner, 'eventId', 'a').key, recordsPlan('routeSuggestions', owner, 'eventId', 'b').key);
  assert.notEqual(recordsPlan('routeSuggestions', owner, 'eventId', 'a').key, recordsPlan('routeSuggestions', owner, 'eventId', 'a', { status: 'pending' }).key);
  assert.notEqual(recordsPlan('events', owner).key, recordsPlan('events', { ...owner, uid: 'owner-b' }).key);
  assert.notEqual(recordsPlan('events', owner).key, recordsPlan('events', { ...owner, role: 'admin' }).key);
});

test('filter reset disposes history and ignores late page/listener callbacks from the previous query', async () => {
  const a = server({ ...recordsPlan('groups', owner, 'eventId', 'a'), pageSize: 2 }, [1, 2, 3].map(i => record(`a-${i}`, i, { eventId: 'a' })));
  a.emit();
  const late = deferred(); a.delay(late);
  const inflight = a.pager.loadMore();
  a.pager.dispose();
  const b = server({ ...recordsPlan('groups', owner, 'eventId', 'b'), pageSize: 2 }, [record('b-1', 0, { eventId: 'b' })]);
  assert.deepEqual(b.pager.getSnapshot().items, []);
  assert.equal(b.pager.getSnapshot().loading, true);
  b.emit();
  late.resolve([{ id: 'a-3', value: record('a-3'), cursor: record('a-3') }]); await inflight;
  a.emit();
  assert.deepEqual(b.pager.getSnapshot().items.map(item => item.id), ['b-1']);
  assert.equal(b.pager.getSnapshot().hasMore, false);
  assert.equal(a.stopped, 1);
  b.pager.dispose();
});

test('overlapping live/history pages deduplicate by ID and prefer live values', async () => {
  const s = server({ ...recordsPlan('announcements', owner, 'eventId', 'a'), pageSize: 2 }, [3, 2, 1].map(i => record(`id-${i}`, i, { eventId: 'a' })));
  s.emit();
  const late = deferred(); s.delay(late);
  const inflight = s.pager.loadMore();
  s.data.push(record('id-4', 4, { eventId: 'a' })); s.emit();
  late.resolve([3, 2, 1].map(i => ({ id: `id-${i}`, value: record(`id-${i}`, i, { eventId: 'a', stale: true }), cursor: record(`id-${i}`, i) })));
  await inflight;
  assert.deepEqual(s.pager.getSnapshot().items.map(item => item.id), ['id-4', 'id-3', 'id-2', 'id-1']);
  assert.equal(s.pager.getSnapshot().items.find(item => item.id === 'id-3').stale, undefined);
  assert.equal(s.pager.getSnapshot().items.find(item => item.id === 'id-2').stale, undefined);
  assert.equal(s.subscriptions, 1);
  s.pager.dispose();
});

test('a late historical snapshot cannot resurrect a document removed while the page was loading', async () => {
  const s = server({ ...recordsPlan('users', admin), pageSize: 2 }, [1, 2, 3, 4].map(i => record(`id-${i}`)));
  s.emit(); const late = deferred(); s.delay(late);
  const inflight = s.pager.loadMore();
  s.data.splice(0, 1); s.emit();
  await Promise.resolve(); await Promise.resolve();
  late.resolve([1, 3, 4].map(i => ({ id: `id-${i}`, value: record(`id-${i}`), cursor: record(`id-${i}`) })));
  await inflight;
  assert.deepEqual(s.pager.getSnapshot().items.map(item => item.id), ['id-2', 'id-3', 'id-4']);
  s.pager.dispose();
});

test('live head evictions stay visible with history, but removed/deactivated records do not', async () => {
  const plan = { ...recordsPlan('collisionAlerts', owner, 'eventId', 'a', { status: 'active' }), pageSize: 2 };
  const s = server(plan, [3, 2, 1].map(i => record(`id-${i}`, i, { eventId: 'a', status: 'active' })));
  s.emit(); await s.pager.loadMore();
  s.data.push(record('id-4', 4, { eventId: 'a', status: 'active' })); s.emit();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(s.pager.getSnapshot().items.map(item => item.id), ['id-4', 'id-3', 'id-2', 'id-1']);
  s.data.find(item => item.id === 'id-3').status = 'resolved'; s.emit();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(s.pager.getSnapshot().items.map(item => item.id), ['id-4', 'id-2', 'id-1']);
  s.data.splice(s.data.findIndex(item => item.id === 'id-4'), 1); s.emit();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(s.pager.getSnapshot().items.map(item => item.id), ['id-2', 'id-1']);
  s.pager.dispose();
});

test('bursts larger than the head leave bounded cursor gaps that can be loaded without losing earlier history', async () => {
  const s = server({ ...recordsPlan('announcements', owner, 'eventId', 'a'), pageSize: 2 }, [4, 3, 2, 1].map(i => record(`id-${i}`, i, { eventId: 'a' })));
  s.emit(); await s.pager.loadMore(); await s.pager.loadMore();
  assert.equal(s.pager.getSnapshot().hasMore, false);
  s.data.push(...[5, 6, 7, 8, 9, 10].map(i => record(`id-${i}`, i, { eventId: 'a' }))); s.emit();
  assert.equal(s.pager.getSnapshot().hasMore, true);
  await s.pager.loadMore(); await s.pager.loadMore(); await s.pager.loadMore();
  assert.deepEqual(s.pager.getSnapshot().items.map(item => item.createdAt), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.deepEqual(s.reads.slice(2).map(read => [read.after, read.before]), [['id-9', 'id-4'], ['id-7', 'id-4'], ['id-5', 'id-4']]);
  s.pager.dispose();
});

test('duplicate load-more clicks share one request and errors preserve the retry cursor and existing items', async () => {
  const s = server({ ...recordsPlan('users', admin), pageSize: 2 }, [1, 2, 3].map(i => record(`id-${i}`)));
  s.emit(); const request = deferred(); s.delay(request);
  const first = s.pager.loadMore(); await s.pager.loadMore();
  assert.equal(s.reads.length, 1);
  assert.equal(s.pager.getSnapshot().loadingMore, true);
  request.reject(Error('Temporarily offline')); await first;
  assert.equal(s.pager.getSnapshot().loadingMore, false);
  assert.equal(s.pager.getSnapshot().items.length, 2);
  assert.match(s.pager.getSnapshot().error, /offline/);
  assert.equal(s.pager.getSnapshot().hasMore, true);
  s.delay(undefined); await s.pager.loadMore();
  assert.deepEqual(s.reads.map(read => read.after), ['id-2', 'id-2']);
  assert.equal(s.pager.getSnapshot().error, '');
  assert.equal(s.pager.getSnapshot().items.length, 3);
  s.pager.dispose();
});

test('live permission failure clears current/history and cannot be undone by a late page', async () => {
  const s = server({ ...recordsPlan('users', admin), pageSize: 2 }, [1, 2, 3].map(i => record(`id-${i}`)));
  s.emit(); const late = deferred(); s.delay(late);
  const inflight = s.pager.loadMore(); s.fail(Error('Permission denied'));
  late.resolve([{ id: 'id-3', value: record('id-3'), cursor: record('id-3') }]); await inflight;
  assert.deepEqual(s.pager.getSnapshot().items, []);
  assert.equal(s.pager.getSnapshot().hasMore, false);
  assert.equal(s.pager.getSnapshot().loadingMore, false);
  assert.match(s.pager.getSnapshot().error, /Permission/);
  s.pager.dispose();
});
