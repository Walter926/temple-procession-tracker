import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
const empty = { items: [], loading: false, loadingMore: false, error: '', hasMore: false };
const component = () => null;
const Link = ({ to, children }) => React.createElement('a', { href: to }, children);
const flush = () => new Promise(resolve => setImmediate(resolve));

// Follow dashboard_forms.test.mjs: render real components and exercise their
// handlers with isolated hooks, without a DOM, Firebase, network or emulators.
function harness(file, stubs = {}, globals = {}) {
  const states = [], effects = [], cleanups = [], cache = new Map();
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) {
      const index = cursor++;
      if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }];
    },
    useEffect(callback) { effects.push(callback); },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} };
    cache.set(filename, module.exports);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const localRequire = name => {
      if (name === 'react') return hooks;
      if (name in stubs) return Object.hasOwn(stubs[name], 'default') ? { __esModule: true, ...stubs[name] } : stubs[name];
      if (!name.startsWith('.')) return require(name);
      const base = path.resolve(path.dirname(filename), name);
      const resolved = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (!resolved || /[\\/]firebase\.ts$/.test(resolved)) throw Error(`Unexpected dependency: ${name}`);
      return load(resolved);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, console, setInterval, clearInterval, ...globals }, { filename });
    return module.exports;
  }
  const loaded = load(fileURLToPath(new URL(`../src/${file}`, import.meta.url)));
  return {
    render(props) { cursor = 0; effects.length = 0; return loaded.default(props); },
    effects() { for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } },
    dispose() { for (const cleanup of cleanups.reverse()) cleanup(); },
  };
}
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return React.isValidElement(tree) ? [tree, ...elements(tree.props.children)] : [];
}
const button = (tree, label) => elements(tree).find(element => element.type === 'button' && element.props.children === label);
const form = tree => elements(tree).find(element => element.type === 'form');
const selected = tree => elements(tree).filter(element => element.type === 'select').map(element => element.props.value);
const html = tree => renderToStaticMarkup(tree);
const timestamp = { toDate: () => new Date('2026-11-19T12:00:00Z'), toMillis: () => Date.parse('2026-11-19T12:00:00Z') };
const baseEvent = Object.freeze({ id: 'event', name: 'Event', status: 'draft', startTime: timestamp, endTime: timestamp });
const baseGroup = Object.freeze({ id: 'group', eventId: 'event', name: 'Group', status: 'moving', leaderUserId: 'primary', backupLeaderUserId: 'backup', memberCount: 12 });

function eventHarness(event, requests = []) {
  return harness('pages/EventDetailPage.tsx', {
    'react-router-dom': { Link, useNavigate: () => () => {}, useParams: () => ({ eventId: event.id }) },
    '../lib/records': { useManagedEvent: () => ({ event, loading: false, error: '' }), useEventContacts: () => ({ contacts: {}, loading: false, error: '' }) },
    '../lib/management': { deleteResource: async (...args) => requests.push(args), errorMessage: String },
    './EventForm': { default: component }, './LiveMapPage': { EventLiveMap: component },
  }, { window: { confirm() { throw Error('Locked deletion must not prompt.'); } } });
}
function groupHarness(event, requests = []) {
  return harness('pages/GroupsPage.tsx', {
    'react-router-dom': { Link, useSearchParams: () => [{ get: field => ({ event: event.id, group: baseGroup.id })[field] }] },
    '../lib/records': { useRecords: name => ({ ...empty, items: name === 'events' ? [event] : name === 'groups' ? [baseGroup] : [] }) },
    '../lib/safe_mutations': { deleteDraftGroup: async (...args) => requests.push(args) },
    './GroupForm': { default: component }, './LeaderAssignmentPanel': { default: component }, './GroupStatusOverridePanel': { default: component }, './ArrivalAlertsPanel': { default: component }, './GroupProgressPanel': { default: component },
  }, { window: { confirm() { throw Error('Locked deletion must not prompt.'); } } });
}

for (const status of ['active', 'paused']) {
  test(`${status} event explains disabled deletion and opens the manual editor without changing endTime`, () => {
    const event = Object.freeze({ ...baseEvent, status }), requests = [];
    const h = eventHarness(event, requests);
    let tree = h.render();
    const remove = button(tree, 'Delete event');
    assert.equal(remove.props.disabled, true);
    const help = elements(tree).find(element => element.props.id === remove.props['aria-describedby']);
    assert.ok(help);
    assert.match(html(help), /Edit event.*Completed or Cancelled/);
    assert.match(html(help), /end time does not change the status automatically/);
    remove.props.onClick();
    button(tree, 'Edit event').props.onClick();
    tree = h.render();
    assert.ok(button(tree, 'Close editor'));
    assert.ok(elements(tree).some(element => element.type === component && element.props.initial === event));
    assert.equal(button(tree, 'Delete event').props.disabled, true);
    assert.equal(event.status, status);
    assert.equal(event.endTime, timestamp);
    assert.equal(requests.length, 0);
  });

  test(`${status} group explains disabled deletion with a link to its event and distinguishes release`, () => {
    const requests = [], h = groupHarness({ ...baseEvent, status }, requests);
    const tree = h.render(), remove = button(tree, 'Delete group');
    assert.equal(remove.props.disabled, true);
    const help = elements(tree).find(element => element.props.id === remove.props['aria-describedby']);
    assert.ok(help);
    assert.match(html(help), /href="\/events\/event"/);
    assert.match(html(help), /Edit event.*Completed or Cancelled/);
    assert.match(html(help), /Releasing leaders removes their publishing assignment without deleting the group/);
    remove.props.onClick();
    assert.equal(requests.length, 0);
  });
}

for (const status of ['draft', 'scheduled', 'completed', 'cancelled', 'archived']) {
  test(`${status} event and group keep deletion enabled without a misleading lock explanation`, () => {
    for (const [h, label] of [[eventHarness({ ...baseEvent, status }), 'Delete event'], [groupHarness({ ...baseEvent, status }), 'Delete group']]) {
      const tree = h.render(), remove = button(tree, label);
      assert.equal(remove.props.disabled, false);
      assert.equal(remove.props['aria-describedby'], undefined);
      assert.doesNotMatch(html(tree), /cannot be deleted/);
    }
  });
}

function leaderHarness({ group = baseGroup, confirm = () => true, send = async () => {}, directoryError = '' } = {}) {
  const requests = [], prompts = [];
  const management = {
    async callManagement(name, data) {
      if (name === 'listAssignableLeaders') {
        if (directoryError) throw Error(directoryError);
        return { users: ['primary', 'backup', 'replacement'].map(id => ({ id, displayName: id, role: 'teamLeader', isActive: true })), nextCursor: null };
      }
      requests.push({ name, data });
      return send(name, data);
    },
    errorMessage: reason => reason.message,
  };
  const h = harness('pages/LeaderAssignmentPanel.tsx', {
    '../lib/management': management, './management': management,
  }, { window: { confirm(message) { prompts.push(message); return confirm(message); } } });
  return { ...h, requests, prompts, props: { group } };
}
async function ready(h) {
  h.render(h.props); h.effects(); await flush();
  return h.render(h.props);
}
const submit = { preventDefault() {}, stopPropagation() {} };

test('Release leaders sends the real assignGroupLeader empty-ID payload once, clears local selections and never deletes data', async t => {
  let finish;
  const h = leaderHarness({ send: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => h.dispose());
  let tree = await ready(h);
  const release = button(tree, 'Release leaders');
  assert.equal(release.props.type, 'button');
  release.props.onClick(); release.props.onClick();
  await form(tree).props.onSubmit(submit);
  assert.equal(h.prompts.length, 1);
  assert.match(h.prompts[0], /revokes the primary leader's GPS publishing assignment/);
  assert.match(h.prompts[0], /data will not be deleted/);
  assert.equal(JSON.stringify(h.requests), JSON.stringify([{ name: 'assignGroupLeader', data: { groupId: 'group', leaderUserId: '', backupLeaderUserId: '' } }]));
  tree = h.render(h.props);
  assert.equal(button(tree, 'Release leaders').props.disabled, true);
  assert.equal(button(tree, 'Saving…').props.disabled, true);
  assert.deepEqual(selected(tree), ['primary', 'backup']);
  finish(); await flush();
  tree = h.render(h.props);
  assert.deepEqual(selected(tree), ['', '']);
  assert.equal(button(tree, 'Save leaders').props.disabled, false);
  assert.match(html(tree), /Leaders released\. Their publishing assignment was removed\. The group and its data have not been deleted\./);
  assert.doesNotMatch(html(tree), /GPS publishing has stopped/);
  assert.equal(h.props.group.status, 'moving');
  assert.equal(h.props.group.memberCount, 12);
});

test('cancelling release sends no request, preserves selected IDs and unlocks a later confirmed release', async t => {
  let confirmed = false;
  const h = leaderHarness({ confirm: () => confirmed });
  t.after(() => h.dispose());
  let tree = await ready(h);
  button(tree, 'Release leaders').props.onClick(); await flush();
  tree = h.render(h.props);
  assert.equal(h.requests.length, 0);
  assert.deepEqual(selected(tree), ['primary', 'backup']);
  assert.equal(button(tree, 'Release leaders').props.disabled, false);
  assert.doesNotMatch(html(tree), /Leaders released/);
  confirmed = true;
  button(tree, 'Release leaders').props.onClick(); await flush();
  assert.equal(h.requests.length, 1);
  assert.deepEqual(selected(h.render(h.props)), ['', '']);
});

test('release cannot race an in-flight assignment save', async t => {
  let finish;
  const h = leaderHarness({ send: () => new Promise(resolve => { finish = resolve; }) });
  t.after(() => h.dispose());
  const tree = await ready(h);
  const saving = form(tree).props.onSubmit(submit);
  button(tree, 'Release leaders').props.onClick();
  assert.equal(h.requests.length, 1);
  assert.equal(h.requests[0].data.leaderUserId, 'primary');
  assert.equal(h.requests[0].data.backupLeaderUserId, 'backup');
  assert.equal(h.prompts.length, 0);
  finish(); await saving;
  assert.deepEqual(selected(h.render(h.props)), ['primary', 'backup']);
});

test('a failed release preserves selections, reports the error and permits a retry', async t => {
  let fail = true;
  const h = leaderHarness({ send: async () => { if (fail) throw Error('Release rejected.'); } });
  t.after(() => h.dispose());
  let tree = await ready(h);
  button(tree, 'Release leaders').props.onClick(); await flush();
  tree = h.render(h.props);
  assert.deepEqual(selected(tree), ['primary', 'backup']);
  assert.match(html(tree), /role="alert"[^>]*>Release rejected/);
  assert.doesNotMatch(html(tree), /Leaders released/);
  assert.equal(button(tree, 'Release leaders').props.disabled, false);
  fail = false;
  button(tree, 'Release leaders').props.onClick(); await flush();
  tree = h.render(h.props);
  assert.equal(h.requests.length, 2);
  assert.deepEqual(selected(tree), ['', '']);
  assert.doesNotMatch(html(tree), /Release rejected/);
});

test('release remains available after a leader-directory failure', async t => {
  const h = leaderHarness({ directoryError: 'Directory unavailable.' });
  t.after(() => h.dispose());
  let tree = await ready(h);
  assert.equal(button(tree, 'Save leaders').props.disabled, true);
  assert.equal(button(tree, 'Release leaders').props.disabled, false);
  button(tree, 'Release leaders').props.onClick(); await flush();
  tree = h.render(h.props);
  assert.equal(h.requests.length, 1);
  assert.deepEqual(selected(tree), ['', '']);
  assert.match(html(tree), /Leaders released/);
});

for (const [leaderUserId, backupLeaderUserId] of [['primary', ''], ['', 'backup'], ['', '']]) {
  test(`release visibility follows persisted assignments (${leaderUserId || 'no primary'}, ${backupLeaderUserId || 'no backup'})`, async t => {
    const h = leaderHarness({ group: { ...baseGroup, leaderUserId, backupLeaderUserId } });
    t.after(() => h.dispose());
    let tree = await ready(h);
    assert.equal(!!button(tree, 'Release leaders'), !!(leaderUserId || backupLeaderUserId));
    if (!leaderUserId && !backupLeaderUserId) {
      elements(tree).find(element => element.props.name === 'primaryLeader').props.onChange({ target: { value: 'replacement' } });
      tree = h.render(h.props);
      assert.equal(button(tree, 'Release leaders'), undefined, 'Unsaved selections are not assignments to release.');
    }
    const unassigned = { ...h.props, group: { ...h.props.group, leaderUserId: '', backupLeaderUserId: '' } };
    assert.equal(button(h.render(unassigned), 'Release leaders'), undefined);
  });
}
