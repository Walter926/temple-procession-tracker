// Local demo only. Real browser -> Firebase callable HTTP -> local database.
// Start/seed the four demo emulators first. Never point this at a live project.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
const require = createRequire(new URL('../functions/package.json', import.meta.url));
for (const [key, port] of [['FIRESTORE_EMULATOR_HOST', 8080], ['FIREBASE_AUTH_EMULATOR_HOST', 9099], ['FIREBASE_DATABASE_EMULATOR_HOST', 9000]]) {
  assert.equal(process.env[key], `127.0.0.1:${port}`, 'Only the fixed local demo emulators are supported.');
}
assert.equal(process.env.GCLOUD_PROJECT, 'demo-temple-procession');
Object.assign(process.env, {
  VITE_FIREBASE_PROJECT_ID: 'demo-temple-procession', VITE_FIREBASE_API_KEY: 'demo-key',
  VITE_FIREBASE_APP_ID: 'demo-app', VITE_FIREBASE_AUTH_DOMAIN: 'demo-temple-procession.firebaseapp.com',
  VITE_FIREBASE_DATABASE_URL: 'https://demo-temple-procession-default-rtdb.firebaseio.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '123456789', VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_EMULATOR_HOST: '127.0.0.1', VITE_FUNCTIONS_REGION: 'us-central1',
  VITE_RECAPTCHA_ENTERPRISE_SITE_KEY: '',
});
if (process.argv.includes('--no-maps')) process.env.VITE_GOOGLE_MAPS_BROWSER_KEY = '';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const { createServer } = await import('../admin_dashboard/node_modules/vite/dist/node/index.js');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({ projectId: 'demo-temple-procession' }), db = getFirestore(app);
const { decodeRoute } = require('../functions/lib/event_management.js');
const vite = await createServer({ root: fileURLToPath(new URL('../admin_dashboard', import.meta.url)), server: { host: '127.0.0.1', port: 5175, strictPort: true } });
let browser;
const actions = [], consoleProblems = [];
const base = 'http://127.0.0.1:5175';
try {
  await vite.listen();
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.setDefaultTimeout(30000);
  page.on('console', message => {
    if (/same key|unique .key.|not focusable/i.test(message.text())) consoleProblems.push(message.text());
  });
  page.on('response', response => {
    const url = new URL(response.url());
    if (url.hostname !== '127.0.0.1' || url.port !== '5001' || response.request().method() !== 'POST') return;
    const payload = response.request().postDataJSON()?.data;
    actions.push({ endpoint: url.pathname.split('/').at(-1), status: response.status(), payload });
  });
  const callable = name => page.waitForResponse(response => new URL(response.url()).port === '5001' && response.url().endsWith(`/${name}`) && response.request().method() === 'POST');
  await page.goto(`${base}/login`);
  await page.getByLabel('Email', { exact: true }).fill('demo-owner@example.test');
  await page.getByLabel('Password', { exact: true }).fill('EmulatorOnly!2026');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.waitForURL('**/events');
  await page.getByRole('button', { name: '+ Create Event', exact: true }).click();
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  await page.locator('#eventName-error').waitFor();
  assert.equal(actions.filter(action => action.endpoint === 'manageEvent').length, 0, 'Invalid event must not send a callable.');
  const name = `Repair acceptance ${Date.now()}`;
  await page.locator('[name="eventName"]').fill(name);
  await page.locator('[name="mainTempleName"]').fill('Acceptance temple');
  await page.locator('[name="cityRegion"]').fill('Local emulator');
  await page.locator('[name="startTime"]').fill(new Date(Date.now() + 3600000).toISOString().slice(0, 16));
  const eventResponse = callable('manageEvent');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  assert.equal((await eventResponse).status(), 200);
  await page.waitForURL(/\/events\/[^/]+$/);
  const eventId = new URL(page.url()).pathname.split('/').at(-1);
  const readiness = callable('validateEvent');
  await page.getByRole('button', { name: 'Check readiness', exact: true }).click();
  const validationResponse = await readiness;
  assert.equal(validationResponse.status(), 200);
  const validation = (await validationResponse.json()).result;
  assert.equal(validation.valid, false);
  assert.ok(validation.errors.some(error => /primary route/i.test(error)));
  await page.getByRole('link', { name: 'Manage routes', exact: true }).click();
  await page.getByRole('button', { name: '+ Create Route', exact: true }).click();
  const editor = page.getByRole('heading', { name: 'Create route', exact: true }).locator('..');
  await editor.locator('[name="routeName"]').fill('Seven-point acceptance');
  await editor.locator('[name="routeDescription"]').fill('Original description');
  await editor.locator('[name="routeDuration"]').fill('34');
  await editor.locator('[name="routeColor"]').fill('#1278ab');
  let inputMode = 'seven sequential Google Map clicks';
  if (!process.argv.includes('--no-maps')) {
    const map = editor.locator('.map');
    await map.locator('.gm-style').waitFor();
    await map.scrollIntoViewIfNeeded();
    let count = 0;
    // Keep clicks off Google's place labels and existing draggable marker hit boxes.
    for (const [x, y] of [[80, 80], [170, 100], [260, 120], [100, 190], [190, 210], [80, 280], [180, 300]]) {
      // Google Maps suppresses single-click handlers during its double-click window.
      await page.waitForTimeout(600);
      await map.click({ position: { x, y }, delay: 100 });
      count += 1;
      try { await editor.getByText(new RegExp(`^${count} points`)).waitFor({ timeout: 5000 }); }
      catch (error) {
        console.log(JSON.stringify({ step: 'map click', expectedPoints: count, actual: await editor.locator('output').textContent() }));
        await page.screenshot({ path: fileURLToPath(new URL('../.tmp/browser-repair-failure.png', import.meta.url)), fullPage: true });
        throw error;
      }
    }
    await editor.getByText(/^7 points/).waitFor();
  } else {
    inputMode = 'seven-point encoded import (native/Google tiles not certified)';
    const { encodePolyline } = await import('../admin_dashboard/src/lib/polyline.ts');
    const points = Array.from({ length: 7 }, (_, index) => ({ lat: 49.2827 + index * 0.00017, lng: -123.1207 + index * 0.00023 }));
    await editor.locator('summary').click();
    await editor.getByLabel('Import encoded polyline', { exact: true }).fill(encodePolyline(points));
    await editor.getByRole('button', { name: 'Import geometry', exact: true }).click();
    await editor.locator('summary').click();
  }
  const saveRoute = callable('manageEvent');
  await editor.getByRole('button', { name: 'Save route', exact: true }).click();
  const createResponse = await saveRoute;
  assert.equal(createResponse.status(), 200);
  const routeId = (await createResponse.json()).result.id;
  const initial = (await db.doc(`routes/${routeId}`).get()).data();
  assert.equal(decodeRoute(initial.encodedPolyline).length, 7);
  assert.equal(initial.estimatedDurationMinutes, 34);
  assert.equal(initial.color, '#1278ab');
  assert.equal(initial.description, 'Original description');
  assert.ok(initial.totalDistanceMeters > 0);
  await page.reload();
  await page.locator('.item').filter({ hasText: 'Seven-point acceptance' }).getByRole('button', { name: 'Open', exact: true }).click();
  await page.getByRole('button', { name: 'Edit Route', exact: true }).click();
  const edit = page.getByRole('heading', { name: 'Edit route', exact: true }).locator('..');
  await edit.locator('[name="routeName"]').fill('Seven-point acceptance edited');
  await edit.locator('[name="routeDescription"]').fill('Persisted edited description');
  await edit.locator('[name="routeDuration"]').fill('47');
  await edit.locator('summary').click();
  assert.equal(await edit.locator('.point-row').count(), 7);
  const latitude = edit.locator('.point-row').first().getByLabel('Latitude', { exact: true });
  await latitude.fill(String(Number(await latitude.inputValue()) + 0.0002));
  await edit.locator('summary').click();
  const updateRoute = callable('manageEvent');
  await edit.getByRole('button', { name: 'Save route', exact: true }).click();
  assert.equal((await updateRoute).status(), 200);
  await page.reload();
  await page.locator('.item').filter({ hasText: 'Seven-point acceptance edited' }).getByRole('button', { name: 'Open', exact: true }).click();
  const final = (await db.doc(`routes/${routeId}`).get()).data();
  assert.equal(final.createdAt.toMillis(), initial.createdAt.toMillis());
  assert.equal(final.name, 'Seven-point acceptance edited');
  assert.equal(final.color, '#1278ab');
  assert.equal(final.estimatedDurationMinutes, 47);
  assert.equal(final.description, 'Persisted edited description');
  assert.notEqual(final.encodedPolyline, initial.encodedPolyline);
  assert.equal(decodeRoute(final.encodedPolyline).length, 7);
  assert.equal((await db.collection('routes').where('eventId', '==', eventId).get()).size, 1);
  await page.goto(`${base}/groups?event=demo-festival&group=demo-group-a`);
  await page.locator('[name="primaryLeader"] option').filter({ hasText: 'North Group Leader' }).waitFor({ state: 'attached' });
  assert.equal(await page.locator('[name="primaryLeader"]').inputValue(), 'demo-leader-a');
  await page.goto(`${base}/access-codes`);
  await page.locator('[name="codeEvent"] option[value="demo-festival"]').waitFor({ state: 'attached' });
  await page.locator('[name="codeEvent"]').selectOption('demo-festival');
  const newCode = callable('createAccessCode');
  await page.getByRole('button', { name: 'Generate 24-hour code', exact: true }).click();
  const codeResponse = await newCode;
  assert.equal(codeResponse.status(), 200);
  const issued = (await codeResponse.json()).result;
  assert.match(issued.code, /^[0-9]{6}$/);
  const storedCode = (await db.doc(`accessCodes/${issued.id}`).get()).data();
  assert.equal(storedCode.maxUses, 1000);
  assert.equal(storedCode.expiresAt.toMillis(), issued.expiresAtMs);
  assert.ok(Math.abs(storedCode.expiresAt.toMillis() - storedCode.createdAt.toMillis() - 86400000) < 5000);
  // Close the demo event before deleting; never bypass the active-event guard.
  await page.goto(`${base}/events/demo-festival`);
  await page.getByRole('button', { name: 'Edit event', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Delete event', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: 'Edit event', exact: true }).click();
  await page.locator('[name="eventStatus"]').selectOption('completed');
  const closeEvent = callable('manageEvent');
  await page.getByRole('button', { name: 'Save event', exact: true }).click();
  assert.equal((await closeEvent).status(), 200);
  await page.goto(`${base}/groups?event=demo-festival&group=demo-group-a`);
  const releaseButton = page.getByRole('button', { name: 'Release leaders', exact: true });
  await releaseButton.waitFor();
  const beforeRelease = (await db.doc('groups/demo-group-a').get()).data();
  page.once('dialog', dialog => dialog.accept());
  const released = callable('assignGroupLeader');
  await releaseButton.click();
  assert.equal((await released).status(), 200);
  await page.getByRole('button', { name: 'Delete group', exact: true }).waitFor();
  const afterRelease = (await db.doc('groups/demo-group-a').get()).data();
  assert.equal(afterRelease.leaderUserId, '');
  assert.equal(afterRelease.backupLeaderUserId, '');
  assert.equal(afterRelease.status, beforeRelease.status);
  assert.equal((await db.doc('users/demo-leader-a').get()).data().assignedGroupId, '');
  assert.equal((await db.doc('events/demo-festival').get()).data().status, 'completed');
  page.once('dialog', dialog => dialog.accept());
  const deletedGroup = callable('manageEvent');
  await page.getByRole('button', { name: 'Delete group', exact: true }).click();
  assert.equal((await deletedGroup).status(), 200);
  assert.equal((await db.doc('groups/demo-group-a').get()).exists, false);
  // The remaining group's leader is released by cascading event deletion.
  await page.goto(`${base}/events/demo-festival`);
  await page.getByRole('button', { name: 'Delete event', exact: true }).waitFor();
  page.once('dialog', dialog => dialog.accept());
  const deletedEvent = callable('manageEvent');
  await page.getByRole('button', { name: 'Delete event', exact: true }).click();
  assert.equal((await deletedEvent).status(), 200);
  await page.waitForURL('**/events');
  assert.equal((await db.doc('events/demo-festival').get()).exists, false);
  assert.equal((await db.doc('groups/demo-group-b').get()).exists, false);
  assert.equal((await db.doc('users/demo-leader-b').get()).data().assignedGroupId, '');
  assert.equal((await db.doc(`events/${eventId}`).get()).exists, true, 'Unrelated event must survive.');
  assert.deepEqual(consoleProblems, []);
  const routeActions = actions.filter(action => action.endpoint === 'manageEvent' && action.payload.resource === 'route');
  assert.deepEqual(routeActions.map(action => [action.payload.operation, action.payload.id, action.status]), [['create', routeId, 200], ['update', routeId, 200]]);
  console.log(JSON.stringify({ passed: true, project: 'demo-temple-procession', inputMode, routeCount: 1, routePoints: 7,
    checks: ['invalid event stays inline', 'event create HTTP 200', 'readiness HTTP 200 with actionable errors', 'route create/reload/edit/reload', 'unchanged route ID/createdAt', 'leader name', 'code default/expiry', 'active deletion disabled', 'close event then release leaders without deleting history', 'group/event delete frees remaining leaders', 'unrelated event survives', 'no duplicate-key/hidden-control errors'],
    callables: actions.map(({ endpoint, status, payload }) => ({ endpoint, status, operation: payload?.operation, resource: payload?.resource })) }, null, 2));
} finally {
  if (browser) await browser.close();
  await vite.close();
  await db.terminate();
  await deleteApp(app);
}
