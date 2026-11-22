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
import { encodePolyline } from '../src/lib/polyline.ts';

const require = createRequire(import.meta.url);
const empty = { items: [], loading: false, loadingMore: false, error: '', hasMore: false };
const component = () => null;
// Small hook harness for exercising real handlers/element trees without a DOM,
// network or Firebase. It does not claim browser or emulator coverage.
function harness(file, stubs = {}, globals = {}) {
  const states = [], effects = [], cleanups = [], cache = new Map();
  let cursor = 0;
  const hooks = { ...React,
    useState(initial) { const index = cursor++; if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial; return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value; }]; },
    useRef(initial) { const index = cursor++; return states[index] ??= { current: initial }; },
    useEffect(callback) { effects.push(callback); },
  };
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const module = { exports: {} }; cache.set(filename, module.exports);
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
    const localRequire = name => {
      if (name === 'react') return hooks;
      if (name in stubs) return Object.hasOwn(stubs[name], 'default') ? { __esModule: true, ...stubs[name] } : stubs[name];
      if (!name.startsWith('.')) return require(name);
      const base = path.resolve(path.dirname(filename), name), resolved = [base, `${base}.ts`, `${base}.tsx`].find(existsSync);
      if (!resolved || /[\\/]firebase\.ts$/.test(resolved)) throw Error(`Unexpected dependency: ${name}`);
      return load(resolved);
    };
    vm.runInNewContext(code, { module, exports: module.exports, require: localRequire, console, crypto: globalThis.crypto, setInterval, clearInterval, ...globals }, { filename });
    return module.exports;
  }
  const loaded = load(fileURLToPath(new URL(`../src/${file}`, import.meta.url)));
  return {
    exports: loaded,
    render(props, target = loaded.default) { cursor = 0; effects.length = 0; return target(props); },
    effects() { for (const effect of effects.splice(0)) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } },
    dispose() { for (const cleanup of cleanups.reverse()) cleanup(); },
  };
}
function elements(tree) {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return React.isValidElement(tree) ? [tree, ...elements(tree.props.children)] : [];
}
const find = (tree, type) => elements(tree).find(element => element.type === type);
const text = element => renderToStaticMarkup(element);
const timestamp = { toDate: () => new Date('2026-11-20T12:00:00Z'), toMillis: () => 1 };
const event = { id: 'event', name: 'Event', description: '', status: 'draft', startTime: timestamp, endTime: null, mainTempleName: 'Temple', cityRegion: 'City', isPublic: false };

test('route/stop maps are outside submission forms; required controls are named and native hidden-field validation is disabled', () => {
  const route = { id: 'route', eventId: 'event', name: 'Route', color: '#123456', description: '', estimatedDurationMinutes: 34, encodedPolyline: encodePolyline([{ lat: 1, lng: 1 }, { lat: 1.001, lng: 1.001 }]) };
  for (const [file, props] of [['pages/RouteForm.tsx', { eventId: 'event', initial: route }], ['pages/StopForm.tsx', { route, existingStops: [] }]]) {
    const h = harness(file, { '../components/MapCanvas': { default: component }, '../lib/management': { errorMessage: String, saveResource: async () => 'stop' }, '../lib/useResourceWriter': { useResourceWriter: () => async () => 'route' } });
    const tree = h.render({ ...props, onSaved() {}, onCancel() {} }), form = find(tree, 'form');
    assert.equal(form.props.noValidate, true);
    assert.equal(elements(form).some(element => element.type === component), false, 'Map controls must not belong to the save form');
    for (const input of elements(form).filter(element => element.props.required)) assert.ok(input.props.name);
    assert.equal(elements(tree).filter(element => element.type === 'form').length, 1);
  }
});

test('invalid route fields render inline without sending a callable', async () => {
  let calls = 0;
  const h = harness('pages/RouteForm.tsx', { '../components/MapCanvas': { default: component }, '../lib/management': { errorMessage: String }, '../lib/useResourceWriter': { useResourceWriter: () => async () => { calls++; return 'route'; } } });
  let tree = h.render({ eventId: 'event', onSaved() {}, onCancel() {} });
  await find(tree, 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} });
  tree = h.render({ eventId: 'event', onSaved() {}, onCancel() {} });
  assert.equal(calls, 0);
  assert.match(text(tree), /Route name must contain/); assert.match(text(tree), /distinct route points/);
});

test('event editor sends one aligned payload on double submission and reports invalid fields', async () => {
  let calls = 0, payload, finish;
  const h = harness('pages/EventForm.tsx', { '../lib/management': { errorMessage: String }, '../lib/useResourceWriter': { useResourceWriter: () => async data => { calls++; payload = data; await new Promise(resolve => { finish = resolve; }); return 'event'; } } });
  const props = { initial: event, onSaved() {}, onCancel() {} };
  let tree = h.render(props), form = find(tree, 'form');
  const submit = { preventDefault() {}, stopPropagation() {} };
  const first = form.props.onSubmit(submit), second = form.props.onSubmit(submit);
  assert.equal(calls, 1); finish(); await first; await second;
  assert.equal(payload.endTimeMs, null); assert.equal(typeof payload.startTimeMs, 'number'); assert.equal('startTime' in payload, false);
  find(tree, 'input').props.onChange({ target: { value: '' } });
  tree = h.render(props); await find(tree, 'form').props.onSubmit(submit);
  assert.equal(calls, 1); assert.match(text(h.render(props)), /Event name must contain/);
});

test('access-code generation sends default 1000 once and a history failure is never rendered as no codes', async () => {
  const requests = [];
  const h = harness('pages/AccessCodesPage.tsx', {
    '../context/AuthContext': { useSession: () => ({ user: { uid: 'owner' }, role: 'organizer', isActive: true }) },
    '../lib/useAssignedCodeScope': { useAssignedCodeScope: () => ({ loading: false, error: '' }) },
    '../lib/records': { useManagedEvents: () => ({ ...empty, items: [event] }), useRecords: collection => collection === 'accessCodes' ? { ...empty, error: 'The query requires an index.' } : empty },
    '../lib/management': { callManagement: async (name, data) => { requests.push({ name, data }); return { id: 'code-id', code: '513684' }; }, errorMessage: String },
  });
  let tree = h.render();
  elements(tree).find(element => element.type === 'select' && element.props.name === 'codeEvent').props.onChange({ target: { value: 'event' } });
  tree = h.render();
  const submit = { preventDefault() {}, stopPropagation() {} }, form = find(tree, 'form');
  await Promise.all([form.props.onSubmit(submit), form.props.onSubmit(submit)]);
  assert.equal(requests.length, 1); assert.equal(requests[0].name, 'createAccessCode'); assert.equal(requests[0].data.maxUses, 1000);
  assert.ok(requests[0].data.expiresAtMs > Date.now() + 23 * 3600000);
  const html = text(h.render());
  assert.match(html, /The query requires an index/); assert.doesNotMatch(html, /No codes issued/); assert.match(html, /Access code generated/);
  assert.match(html, /Six digits/); assert.match(html, /513684/);
});

test('assigned leaders issue only group codes and lose displayed plaintext when their assignment changes', async () => {
  const requests = [], reads = [];
  let assignment = { event, group: { id: 'group', name: 'My group', eventId: 'event' }, loading: false, error: '' };
  const h = harness('pages/AccessCodesPage.tsx', {
    '../context/AuthContext': { useSession: () => ({ user: { uid: 'leader' }, role: 'teamLeader', isActive: true }) },
    '../lib/useAssignedCodeScope': { useAssignedCodeScope: () => assignment },
    '../lib/records': { useManagedEvents: () => empty, useRecords: (...args) => { reads.push(args); return empty; } },
    '../lib/management': { callManagement: async (name, data) => { requests.push({ name, data }); return { id: 'hash', code: '000042' }; }, errorMessage: String },
  });
  let tree = h.render();
  assert.doesNotMatch(text(tree), /Event membership \(no group\)/);
  for (const select of elements(tree).filter(element => element.type === 'select')) assert.equal(select.props.disabled, true);
  await find(tree, 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} });
  assert.equal(requests[0].data.groupId, 'group'); assert.equal(requests[0].data.scope, 'group');
  assert.ok(reads.some(([name, field, id]) => name === 'accessCodes' && field === 'groupId' && id === 'group'));
  assert.match(text(h.render()), /000042/);
  assignment = { loading: false, error: 'Assignment removed.' };
  tree = h.render(); assert.doesNotMatch(text(tree), /000042/); assert.match(text(tree), /Assignment removed/);
  const generate = elements(tree).find(element => element.type === 'button' && element.props.children === 'Generate 24-hour code');
  assert.equal(generate.props.disabled, true);
  await find(tree, 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} });
  assert.equal(requests.length, 1);
});

test('missing history index selects a scoped fallback instead of blocking code generation', () => {
  const options = [];
  const h = harness('pages/AccessCodesPage.tsx', {
    '../context/AuthContext': { useSession: () => ({ user: { uid: 'owner' }, role: 'organizer', isActive: true }) },
    '../lib/useAssignedCodeScope': { useAssignedCodeScope: () => ({ loading: false, error: '' }) },
    '../lib/records': { useManagedEvents: () => ({ ...empty, items: [event] }), useRecords: (collection, field, id, settings) => {
      if (collection !== 'accessCodes') return empty;
      options.push({ field, id, ...settings });
      return { ...empty, error: id && !settings.indexFree ? 'The query requires an index.' : '' };
    } },
    '../lib/management': { errorMessage: String },
  });
  let tree = h.render();
  elements(tree).find(element => element.props.name === 'codeEvent').props.onChange({ target: { value: 'event' } });
  h.render(); h.effects(); tree = h.render();
  assert.deepEqual(JSON.parse(JSON.stringify(options.at(-1))), { field: 'eventId', id: 'event', indexFree: true });
  assert.match(text(tree), /index-free pages by code ID/); assert.doesNotMatch(text(tree), /The query requires an index/);
  h.dispose();
});

test('new numeric codes retain leading zeros when displayed and copied', async () => {
  const copied = [];
  const h = harness('pages/AccessCodesPage.tsx', {
    '../context/AuthContext': { useSession: () => ({ user: { uid: 'owner' }, role: 'organizer', isActive: true }) },
    '../lib/useAssignedCodeScope': { useAssignedCodeScope: () => ({ loading: false, error: '' }) },
    '../lib/records': { useManagedEvents: () => ({ ...empty, items: [event] }), useRecords: () => empty },
    '../lib/management': { callManagement: async () => ({ id: 'hash', code: '000042' }), errorMessage: String },
  }, { navigator: { clipboard: { writeText: async code => { copied.push(code); } } } });
  let tree = h.render();
  elements(tree).find(element => element.props.name === 'codeEvent').props.onChange({ target: { value: 'event' } });
  await find(h.render(), 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} });
  tree = h.render();
  assert.match(text(tree), /000042/);
  await elements(tree).find(element => element.type === 'button' && element.props.children === 'Copy code').props.onClick();
  assert.deepEqual(copied, ['000042']);
});

test('old or missing issuance responses require backend deployment and never appear as shareable new codes', async t => {
  const responses = ['AB12CD', 'ABCD-1234-EFAB-5678-90CD', 'ABCD1234EFAB567890CD'].map(code => ({ id: 'hash', code }));
  for (const response of [...responses, null, undefined]) {
    await t.test(response?.code ?? String(response), async () => {
      const h = harness('pages/AccessCodesPage.tsx', {
        '../context/AuthContext': { useSession: () => ({ user: { uid: 'owner' }, role: 'organizer', isActive: true }) },
        '../lib/useAssignedCodeScope': { useAssignedCodeScope: () => ({ loading: false, error: '' }) },
        '../lib/records': { useManagedEvents: () => ({ ...empty, items: [event] }), useRecords: () => empty },
        '../lib/management': { callManagement: async () => response, errorMessage: String },
      });
      const tree = h.render();
      elements(tree).find(element => element.props.name === 'codeEvent').props.onChange({ target: { value: 'event' } });
      await find(h.render(), 'form').props.onSubmit({ preventDefault() {}, stopPropagation() {} });
      const result = h.render(), html = text(result);
      assert.match(html, /role="alert"/); assert.match(html, /Backend deployment needed/);
      assert.match(html, /deploy the updated access-code functions/); assert.match(html, /exactly six digits/);
      if (response) assert.equal(html.includes(response.code), false);
      assert.doesNotMatch(html, /Share this code|Copy code|Access code generated/);
      assert.equal(find(result, 'code'), undefined);
    });
  }
});

test('leader dashboard guard permits only the code route and redirects away from management', () => {
  const Outlet = () => null, Navigate = () => null;
  const h = harness('components/RequireManagement.tsx', {
    '../context/AuthContext': { useSession: () => ({ user: { uid: 'leader' }, role: 'teamLeader', isActive: true, loading: false }) },
    '../lib/firebase': { auth: {} }, 'firebase/auth': { signOut() {} }, 'react-router-dom': { Outlet, Navigate },
  });
  assert.equal(h.render({ accessCodesOnly: true }, h.exports.RequireManagement).type, Outlet);
  const redirect = h.render({}, h.exports.RequireManagement); assert.equal(redirect.type, Navigate); assert.equal(redirect.props.to, '/access-codes');
});

test('leader scope verifies both assignment sides, disposes listeners and ignores revoked or late event snapshots', () => {
  const watches = [];
  let session = { user: { uid: 'leader' }, role: 'teamLeader', isActive: true, assignedGroupId: 'group' };
  const h = harness('lib/useAssignedCodeScope.ts', {
    '../context/AuthContext': { useSession: () => session }, './firebase': { db: {} },
    'firebase/firestore': { doc: (_db, collection, id) => `${collection}/${id}`, onSnapshot: (ref, next, failed) => {
      const watch = { ref, next, failed, stopped: false }; watches.push(watch); return () => { watch.stopped = true; };
    } },
  });
  const render = () => h.render(undefined, h.exports.useAssignedCodeScope);
  const snapshot = (id, data) => ({ id, data: () => data });
  assert.equal(render().loading, true); h.effects();
  assert.deepEqual(watches.map(w => w.ref), ['groups/group']);
  watches[0].next(snapshot('group', { eventId: 'event', leaderUserId: 'someone-else' }));
  assert.match(render().error, /primary leader/); assert.equal(watches.length, 1);
  watches[0].next(snapshot('group', { eventId: 'event', leaderUserId: 'leader' }));
  watches[1].next(snapshot('event', { name: 'Event', status: 'active' }));
  assert.equal(render().group.id, 'group'); assert.equal(render().event.id, 'event');
  watches[0].next(snapshot('group', { eventId: 'event', leaderUserId: 'replacement' }));
  assert.equal(watches[1].stopped, true);
  watches[1].next(snapshot('event', { name: 'Late event', status: 'active' }));
  assert.equal(render().group, undefined); assert.match(render().error, /primary leader/);
  session = { ...session, assignedGroupId: 'new-group' };
  assert.equal(render().loading, true); assert.equal(render().event, undefined);
  h.dispose(); assert.equal(watches[0].stopped, true);
});

test('arrival/index failure never renders a successful empty state', () => {
  for (const failure of ['The query requires an index.', 'Missing or insufficient permissions.']) {
    const h = harness('pages/ArrivalAlertsPanel.tsx', { '../lib/records': { useRecords: () => ({ ...empty, error: failure }) } });
    const html = text(h.render({ eventId: 'event' }));
    assert.ok(html.includes(failure)); assert.doesNotMatch(html, /No confirmed arrivals/);
  }
  const h = harness('pages/ArrivalAlertsPanel.tsx', { '../lib/records': { useRecords: () => empty } });
  assert.match(text(h.render({ eventId: 'event' })), /No confirmed arrivals/);
});

test('distinct event panels have distinct stable sibling keys', () => {
  const h = harness('pages/EventDetailPage.tsx', {
    'react-router-dom': { Link: component, useNavigate: () => () => {}, useParams: () => ({ eventId: 'event' }) },
    '../lib/records': { useManagedEvent: () => ({ event, loading: false, error: '' }), useEventContacts: () => ({ contacts: {}, loading: false, error: '' }) },
    '../lib/management': {}, './EventForm': { default: component }, './LiveMapPage': { EventLiveMap: component },
  });
  let tree = h.render();
  elements(tree).find(e => e.type === 'button' && e.props.children === 'Edit event').props.onClick();
  tree = h.render();
  const keys = tree.props.children.filter(React.isValidElement).map(element => element.key).filter(Boolean);
  assert.equal(keys.length, new Set(keys).size); assert.ok(keys.includes('editor:event')); assert.ok(keys.includes('map:event'));
});

test('leader/status panels retain distinct stable keys for the same group', () => {
  const group = { id: 'group', eventId: 'event', name: 'Group', status: 'waiting' };
  const h = harness('pages/GroupsPage.tsx', {
    'react-router-dom': { useSearchParams: () => [{ get: field => ({ event: 'event', group: 'group' })[field] }] },
    '../lib/records': { useRecords: name => ({ ...empty, items: name === 'events' ? [event] : name === 'groups' ? [group] : [] }) },
    '../lib/safe_mutations': {}, './GroupForm': { default: component }, './LeaderAssignmentPanel': { default: component }, './GroupStatusOverridePanel': { default: component }, './ArrivalAlertsPanel': { default: component }, './GroupProgressPanel': { default: component },
  });
  const panels = elements(h.render()).filter(element => element.type === component && element.key);
  assert.deepEqual(panels.map(element => element.key), ['leaders:group', 'status:group']);
});

test('segment submit is single-flight and cannot resubmit a saved order while waiting for its live list', async () => {
  let calls = 0, finish;
  const h = harness('pages/SegmentForm.tsx', { '../lib/management': { errorMessage: String, saveResource: async () => { calls++; await new Promise(resolve => { finish = resolve; }); } } });
  const props = { eventId: 'event', routeId: 'route', nextOrder: 1 };
  let tree = h.render(props);
  for (const [name, value] of [['segmentStartLat', '0'], ['segmentStartLng', '0'], ['segmentEndLat', '0.01'], ['segmentEndLng', '0.01']]) elements(tree).find(element => element.props.name === name).props.onChange({ target: { value } });
  tree = h.render(props); const submit = { preventDefault() {}, stopPropagation() {} }, form = find(tree, 'form');
  const first = form.props.onSubmit(submit), second = form.props.onSubmit(submit);
  assert.equal(calls, 1); finish(); await first; await second;
  tree = h.render(props); await find(tree, 'form').props.onSubmit(submit);
  assert.equal(calls, 1); assert.equal(find(tree, 'button').props.disabled, true);
  assert.equal(find(h.render({ ...props, nextOrder: 2 }), 'button').props.disabled, false);
});

test('leader directory merges current ineligible profiles but never offers them as new assignments', async () => {
  const users = [{ id: 'current-private-uid', fullName: 'Current full name', role: 'teamLeader', isActive: false, isEligible: false }, { id: 'eligible-private-uid', fullName: 'Available full name', role: 'teamLeader', isActive: true, isEligible: true }];
  const h = harness('pages/LeaderAssignmentPanel.tsx', { '../lib/management': { callManagement: async () => ({ users, nextCursor: null }), errorMessage: String }, '../lib/leader_assignments': {} });
  const props = { group: { id: 'group', eventId: 'event', leaderUserId: 'current-private-uid', backupLeaderUserId: '' } };
  h.render(props); h.effects(); await Promise.resolve(); await Promise.resolve();
  const tree = h.render(props), html = text(tree), selects = elements(tree).filter(element => element.type === 'select');
  assert.match(html, /Current full name/); assert.match(html, /Available full name/);
  const visible = html.replace(/value="[^"]*"/g, '');
  assert.doesNotMatch(visible, /current-private-uid|eligible-private-uid/);
  assert.equal(elements(selects[1]).some(element => element.type === 'option' && element.props.value === 'current-private-uid'), false);
  assert.equal(selects[0].props.value, 'current-private-uid'); h.dispose();
});

test('advanced marker drag/click handlers use current positions and dispose listeners/map ownership', () => {
  let marker;
  class FakeMarker {
    constructor(options) { Object.assign(this, options); this.style = {}; this.listeners = new Map(); marker = this; }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name) { this.listeners.delete(name); }
    replaceChildren(...nodes) { this.nodes = nodes; }
  }
  const map = {}, moved = [], clicks = [];
  const h = harness('components/MapMarker.tsx', { '@react-google-maps/api': { useGoogleMap: () => map } }, { google: { maps: { marker: { AdvancedMarkerElement: FakeMarker, PinElement: class {} } } } });
  const props = { advanced: true, position: { lat: 1, lng: 2 }, title: 'Route point', draggable: true, onMove: point => moved.push(point), onClick: () => clicks.push(1) };
  const advancedComponent = h.render(props).type;
  h.render(props, advancedComponent); h.effects();
  assert.equal(marker.gmpDraggable, true); marker.position = { lat: 3, lng: 4 }; marker.listeners.get('gmp-dragend')(); marker.listeners.get('gmp-click')();
  assert.equal(JSON.stringify(moved), JSON.stringify([{ lat: 3, lng: 4 }])); assert.equal(clicks.length, 1);
  h.dispose(); assert.equal(marker.map, null); assert.equal(marker.listeners.size, 0);
});
