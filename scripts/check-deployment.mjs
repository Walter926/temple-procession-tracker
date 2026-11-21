import { readFile, readdir, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (relative) => readFile(path.join(root, relative), 'utf8');
let failures = 0;
function check(condition, description) {
  console.log(`${condition ? 'PASS' : 'FAIL'} ${description}`);
  if (!condition) failures++;
}
async function exists(relative) {
  try { await access(path.join(root, relative)); return true; } catch { return false; }
}
async function sourceFiles(relative) {
  const result = [];
  for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(child));
    else if (/\.(tsx?|dart)$/.test(entry.name)) result.push(child);
  }
  return result;
}

const firebase = JSON.parse(await read('firebase.json'));
const project = JSON.parse(await read('.firebaserc')).projects.default;
const mobileConfig = JSON.parse(await read('mobile_app/temple_procession_tracker_app/android/app/google-services.json'));
check(mobileConfig.project_info.project_id === project, 'Android and Firebase CLI target the same project');
check((await read('mobile_app/temple_procession_tracker_app/lib/firebase_options.dart')).includes(`projectId: '${project}'`), 'Flutter Firebase options match the project');
check(firebase.functions[0].source === 'functions', 'Functions deploy from the tested source folder');
check(firebase.hosting.public === 'admin_dashboard/dist', 'Hosting deploys the dashboard build output');
check((await read('functions/src/index.ts')).includes("region: 'us-central1'"), 'Functions region is explicitly us-central1');
for (const [name, relative] of Object.entries({
  'Firestore rules': firebase.firestore.rules,
  'Firestore indexes': firebase.firestore.indexes,
  'RTDB rules': firebase.database.rules,
  'Storage rules': firebase.storage.rules,
  'Dashboard favicon': 'admin_dashboard/public/favicon.png',
  'Android launcher icon': 'mobile_app/temple_procession_tracker_app/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png',
})) check(await exists(relative), `${name} exists`);

const exported = new Set();
const index = await read('functions/src/index.ts');
for (const match of index.matchAll(/export\s*\{([^}]+)\}/g)) {
  for (const identifier of match[1].split(',')) exported.add(identifier.trim());
}
const missing = new Map();
for (const file of [...await sourceFiles('admin_dashboard/src'), ...await sourceFiles('mobile_app/temple_procession_tracker_app/lib')]) {
  const source = await read(file);
  const calls = source.matchAll(/(?:httpsCallable(?:<[^;\n]+?>)?|callManagement(?:<[^;\n]+?>)?)\(\s*['"]([A-Za-z][A-Za-z0-9]+)['"]/g);
  for (const [, name] of calls) if (!exported.has(name)) missing.set(name, file);
}
check(missing.size === 0, 'Every statically named client callable has a local entry-point export (deployment not checked)');
for (const [name, file] of missing) console.log(`  Missing export: ${name} (${file})`);
const requiredWorkers = ['continueAnnouncementFanout', 'retryNotificationDeliveries', 'reconcileTrackingMirrors',
  'reconcileTrackingHeartbeats', 'reconcileGroupCollisions', 'expireOperationalMessages', 'cleanupRetention',
  'registerLiveLocationRetention', 'discoverLiveLocationRetention'];
check(requiredWorkers.every(name => exported.has(name)), 'Recovery, continuation and retention workers are exported');
const indexes = JSON.parse(await read(firebase.firestore.indexes)).indexes;
const requiredIndexes = [
  ['publicEvents', 'isPublic:ASCENDING', 'status:ASCENDING'],
  ['notifications', 'uid:ASCENDING', 'createdAt:DESCENDING'],
  ['collisionWarnings', 'uid:ASCENDING', 'state:ASCENDING', 'createdAt:DESCENDING'],
  ['routeInstructions', 'uid:ASCENDING', 'state:ASCENDING', 'createdAt:DESCENDING'],
  ['accessCodes', 'eventId:ASCENDING', 'createdAt:DESCENDING'],
  ['announcements', 'eventId:ASCENDING', 'createdAt:DESCENDING'],
  ['arrivalNotifications', 'eventId:ASCENDING', 'createdAt:DESCENDING'],
  ['collisionAlerts', 'eventId:ASCENDING', 'status:ASCENDING'],
  ['collisionAlerts', 'eventId:ASCENDING', 'status:ASCENDING', 'createdAt:DESCENDING'],
  ['collisionAlerts', 'status:ASCENDING', 'resolvedAt:ASCENDING'],
  ['routeSuggestions', 'eventId:ASCENDING', 'createdAt:DESCENDING'],
  ['routeSuggestions', 'eventId:ASCENDING', 'status:ASCENDING', 'createdAt:DESCENDING'],
  ['memberships', 'eventId:ASCENDING', 'groupId:ASCENDING'],
];
check(requiredIndexes.every(([collection, ...fields]) => indexes.some(index => index.collectionGroup === collection &&
  index.queryScope === 'COLLECTION' && JSON.stringify(index.fields.map(field => `${field.fieldPath}:${field.order}`)) === JSON.stringify(fields))),
  'Optimized feed, fan-out, collision and retention composite indexes are present');
const realtimeRules = JSON.parse(await read(firebase.database.rules));
check(realtimeRules.rules.liveLocations.$eventId['.indexOn']?.includes('recordedAt'), 'RTDB precise-location retention has a recordedAt index');

if (process.argv.includes('--release')) {
  check(await exists('admin_dashboard/dist/index.html'), 'Dashboard production bundle has been built');
  check(await exists('admin_dashboard/.env.local'), 'Dashboard local Firebase/Maps configuration is present');
  check(await exists('mobile_app/temple_procession_tracker_app/android/secrets.properties'), 'Android local Maps configuration is present');
  if (await exists('mobile_app/temple_procession_tracker_app/android/secrets.properties')) {
    const maps = await read('mobile_app/temple_procession_tracker_app/android/secrets.properties');
    const key = maps.match(/^MAPS_API_KEY\s*=\s*(.*)$/m)?.[1].trim() ?? '';
    check(key.length >= 20 && !/YOUR_|PLACEHOLDER/.test(key), 'Android Maps configuration is not an empty or placeholder key (restrictions still require verification)');
  }
  check(await exists('mobile_app/temple_procession_tracker_app/android/key.properties'), 'Android release signing configuration is present');
  const functionsEnv = `functions/.env.${project}`;
  check(await exists(functionsEnv), 'Functions deployment environment exists');
  if (await exists(functionsEnv)) {
    const env = await read(functionsEnv);
    const databaseUrl = env.match(/^RTDB_URL\s*=\s*["']?([^\s"']+)/m)?.[1];
    check(Boolean(databaseUrl?.startsWith('https://') && new URL(databaseUrl).hostname.startsWith(`${project}-`)), 'RTDB_URL belongs to the configured Firebase project');
  }
}
console.log(`Preflight complete: ${failures} failure(s). No resources were deployed or changed.`);
process.exitCode = failures ? 1 : 0;
