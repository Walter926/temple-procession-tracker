// Read-only project diagnostics. Reuse Firebase CLI authentication without printing credentials.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const auth = require('firebase-tools/lib/auth');
const { requireAuth } = require('firebase-tools/lib/requireAuth');
const { getAccessToken } = require('firebase-tools/lib/apiv2');
const project = 'temple-procession-walter', projectDir = fileURLToPath(new URL('../', import.meta.url));
const options = { project, projectDir };
const account = auth.getProjectDefaultAccount(projectDir);
if (account) auth.setActiveAccount(options, account);
await requireAuth(options);
const token = await getAccessToken();
async function read(url, body) {
  const response = await fetch(url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
  const value = await response.json();
  if (!response.ok) throw new Error(`Read-only API ${new URL(url).hostname} returned ${response.status} ${value.error?.status ?? ''}`);
  return value;
}
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)`;
const scalar = value => value?.stringValue ?? value?.timestampValue ?? value?.booleanValue ?? value?.integerValue ?? null;
const fields = doc => Object.fromEntries(Object.entries(doc.fields ?? {}).map(([key, value]) => [key, scalar(value)]));
const functions = (await read(`https://cloudfunctions.googleapis.com/v2/projects/${project}/locations/us-central1/functions`)).functions ?? [];
const deployed = new Set(functions.map(fn => fn.name.split('/').at(-1)));
const source = await readFile(new URL('../functions/src/index.ts', import.meta.url), 'utf8');
const expected = [...source.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(match => match[1].split(',').map(name => name.trim()));
console.log(JSON.stringify({ project, checkedAt: new Date().toISOString(), deployedFunctions: [...deployed].sort(), missingLocalExports: expected.filter(name => !deployed.has(name)) }, null, 2));
const indexes = (await read(`${base}/collectionGroups/-/indexes`)).indexes ?? [];
console.log(JSON.stringify({ deployedIndexes: indexes.map(index => ({ collection: index.name.split('/collectionGroups/')[1]?.split('/')[0], state: index.state,
  fields: index.fields.filter(field => field.fieldPath !== '__name__').map(field => `${field.fieldPath}:${field.order ?? field.arrayConfig}`) })) }, null, 2));
const eventQuery = await read(`${base}/documents:runQuery`, { structuredQuery: { from: [{ collectionId: 'events' }],
  where: { fieldFilter: { field: { fieldPath: 'name' }, op: 'EQUAL', value: { stringValue: 'test' } } }, limit: 10 } });
for (const row of eventQuery) {
  if (!row.document) continue;
  const eventId = row.document.name.split('/').at(-1), event = fields(row.document);
  const routes = await read(`${base}/documents:runQuery`, { structuredQuery: { from: [{ collectionId: 'routes' }],
    where: { fieldFilter: { field: { fieldPath: 'eventId' }, op: 'EQUAL', value: { stringValue: eventId } } }, limit: 21 } });
  const routeRows = routes.filter(row => row.document).map(row => ({ id: row.document.name.split('/').at(-1), createdAt: fields(row.document).createdAt,
    hasGeometry: Boolean(fields(row.document).encodedPolyline), deleting: fields(row.document).deleting === true }));
  const publicSnapshot = await fetch(`${base}/documents/publicEvents/${eventId}`, { headers: { Authorization: `Bearer ${token}` } });
  const published = publicSnapshot.ok ? fields(await publicSnapshot.json()) : null;
  console.log(JSON.stringify({ eventId, status: event.status, endTime: event.endTime, routeId: event.routeId, primaryRouteMode: event.primaryRouteMode,
    publicRouteId: published?.routeId ?? null, routeCount: routeRows.length, routes: routeRows }, null, 2));
}
const scheduler = await read(`https://cloudscheduler.googleapis.com/v1/projects/${project}/locations/us-central1/jobs/firebase-schedule-reconcilePublicEvents-us-central1`);
console.log(JSON.stringify({ scheduler: { state: scheduler.state, schedule: scheduler.schedule, timeZone: scheduler.timeZone,
  lastAttemptTime: scheduler.lastAttemptTime, lastStatusCode: scheduler.status?.code ?? 0 } }, null, 2));
if (process.argv.includes('--rules')) {
  const normalize = text => text.replaceAll('\r\n', '\n').trim();
  try {
    const release = await read(`https://firebaserules.googleapis.com/v1/projects/${project}/releases/cloud.firestore`);
    const ruleset = await read(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
    const live = ruleset.source.files.find(file => file.name.endsWith('.rules'))?.content ?? ruleset.source.files[0]?.content ?? '';
    const local = await readFile(new URL('../firebase_rules/firestore.rules', import.meta.url), 'utf8');
    console.log(JSON.stringify({ firestoreRules: { matchesLocal: normalize(live) === normalize(local), releasedAt: release.updateTime,
      hasMembershipPolicy: live.includes('memberships'), hasNotificationUidPolicy: /resource\.data\.uid/.test(live) } }, null, 2));
    if (process.argv.includes('--show-rule-policy')) console.log(live);
  } catch (error) { console.log(JSON.stringify({ firestoreRules: { verificationError: error.message } })); }
  try {
    const live = await read(`https://${project}-default-rtdb.firebaseio.com/.settings/rules.json`);
    const local = JSON.parse(await readFile(new URL('../firebase_rules/database.rules.json', import.meta.url), 'utf8'));
    console.log(JSON.stringify({ realtimeRules: { matchesLocal: JSON.stringify(live) === JSON.stringify(local),
      requiresAccountMirror: JSON.stringify(live).includes('accountStates'), requiresEventAccessMirror: JSON.stringify(live).includes('eventAccess'),
      rootRead: live.rules?.['.read'], rootWrite: live.rules?.['.write'] } }, null, 2));
  } catch (error) { console.log(JSON.stringify({ realtimeRules: { verificationError: error.message } })); }
}
if (process.argv.includes('--maps')) {
  try {
    const properties = await readFile(new URL('../mobile_app/temple_procession_tracker_app/android/secrets.properties', import.meta.url), 'utf8');
    const key = properties.match(/^MAPS_API_KEY\s*=\s*(.+)$/m)?.[1].trim();
    if (!key || /YOUR_|REPLACE|PLACEHOLDER/.test(key)) throw Error('Android Maps key is absent or a placeholder.');
    const lookup = await read(`https://apikeys.googleapis.com/v2/keys:lookupKey?keyString=${encodeURIComponent(key)}`);
    const config = await read(`https://apikeys.googleapis.com/v2/${lookup.name}`);
    console.log(JSON.stringify({ androidMaps: { keyBelongsToExpectedProject: lookup.parent?.includes('/354671670812/'),
      restrictions: config.restrictions ?? {}, deleted: Boolean(config.deleteTime) } }, null, 2));
  } catch (error) { console.log(JSON.stringify({ androidMaps: { verificationError: error.message } })); }
  for (const [label, url] of [
    ['mapsAndroidService', 'https://serviceusage.googleapis.com/v1/projects/354671670812/services/maps-android-backend.googleapis.com'],
    ['billing', `https://cloudbilling.googleapis.com/v1/projects/${project}/billingInfo`],
  ]) {
    try { const value = await read(url); console.log(JSON.stringify({ [label]: label === 'billing' ? { billingEnabled: value.billingEnabled } : { state: value.state } })); }
    catch (error) { console.log(JSON.stringify({ [label]: { verificationError: error.message } })); }
  }
}
