# Temple Procession Tracker bug repairs and deployment plan

Verified 21 November 2026 UTC, during the local 20 November session. The code repairs pass 284 automated tests and a real browser callable-HTTP acceptance flow. The Android debug update is installed on the Samsung A16 without removing app data. This is not a production-complete release: native Maps authorization, missing deployed indexes/callables, and tracking access remain release gates.

No production deployment, rules replacement, manual data repair, account change, or live GPS publishing was performed. Existing unrelated worktree changes are preserved. The supplied attachment was read without editing it.

## Results for all fourteen bugs

“Fixed locally” means the implementation and specified local regression pass; it does not imply production rollout. Production findings below come from authenticated read-only inspection and the physical phone.

| Bug | Cause and repair | Verification and status |
| --- | --- | --- |
| 1 Route persistence | Stable client IDs now make event/route create retries idempotent. The original request fingerprint is retained after ambiguous failures; corrected fields follow as an update. Double submission is guarded. Hidden geometry inputs no longer participate in native form validation. See [route form](../admin_dashboard/src/pages/RouteForm.tsx), [request writer](../admin_dashboard/src/lib/management_requests.ts), and [server mutations](../functions/src/event_management.ts). | **Fixed locally.** Real browser: seven separate Google Map clicks, create HTTP 200, refresh, open, edit name/description/duration/geometry, update HTTP 200, refresh. Exactly one route, seven points, unchanged ID and createdAt; color/distance/metadata checked against Firestore. |
| 2 Primary route | Existing auto/manual policy was retained and strengthened: newest created route, never updatedAt; timestamp precision and deterministic ID ties; manual selection preserved; deleted selection falls back to newest; last route clears primary. Closed events stay closed on deletion. Reconciliation skips unchanged projections. See [selection and publication](../functions/src/event_management.ts) and [regressions](../functions/src/primary_route_selection.test.ts). | **Fixed locally; production legacy repair observed.** Handler tests cover A/B/C, manual A, new D, editing B, deletion, concurrency and repeat reconciliation. The already-deployed scheduler repaired the live `test` event without our writing production data. |
| 3 Blank Android Maps | The updated app produces a fresh native **Authorization failure**. Manifest key is present, non-placeholder, and matches the ignored local Android key. Package and certificate are confirmed. Android Maps SDK is enabled and billing is enabled in the configured Firebase project, but key ownership/restrictions lookup returns 403. Added a build-time missing/placeholder-key guard in [Android build configuration](../mobile_app/temple_procession_tracker_app/android/app/build.gradle.kts). | **Blocked on Maps key authorization.** Physical public map still has a beige canvas with Google logo/controls after the update. Exact restriction/key-project mismatch cannot be identified with current read permissions. Do not mark tiles, all map screens, or native Fit/You acceptance as passed. |
| 4 Arrival query index | Production has no composite index for arrivalNotifications eventId ASC + createdAt DESC. The correct definition already exists in [indexes](../firebase_rules/firestore.indexes.json). [Arrival UI](../admin_dashboard/src/pages/ArrivalAlertsPanel.tsx) no longer presents a query failure as successful empty data. | **Partially fixed.** Rendered error regression passes. Requires approved index deployment, READY state and production query retest. |
| 5 Access codes | New maxUses is an integer 1..1000, default 1000, rather than silently replacing it with unlimited. New codes retain six characters and 24-hour validity. Legacy stored zero/missing unlimited limits and larger valid limits remain accepted; malformed limits fail closed. Historical repository 20-hex redemption input is accepted through the existing hash lookup. See [backend](../functions/src/access_codes.ts), [web contract](../admin_dashboard/src/lib/access_code_contract.ts), and [mobile service](../mobile_app/temple_procession_tracker_app/lib/core/services/access_code_service.dart). | **Fixed locally; production rollout pending.** Browser generation HTTP 200, six characters, stored maxUses 1000 and expected expiry. Emulator tests cover limits, expiry, revocation, permissions, duplicate/concurrent joins, history compatibility and counters. accessCodes index is locally declared but absent live. No production code format was inferred from local Git history; no hashes/expiry were migrated. |
| 6 Leader labels | Directory projection now includes displayName/fullName/email and current assigned profiles. Labels use those fields, then a non-UID fallback. Missing/inactive current assignments remain identifiable but cannot be newly selected. See [directory](../functions/src/account_management.ts) and [leader panel](../admin_dashboard/src/pages/LeaderAssignmentPanel.tsx). | **Fixed locally.** Real browser displayed North Group Leader as the selected leader; field masking, pagination, ownership and missing/inactive fixtures pass. Callable deployment is still required. |
| 7 Leader internal error | listAssignableLeaders is absent from production. Its local handler now uses a bounded, field-masked directory query and explicit failed-precondition/unavailable errors instead of leaking an opaque internal result. No arbitrary user-read permission was added. | **Partially fixed.** Actual local callable HTTP 200 and handler tests pass. The exact historical internal [0] stack is not correlated to a specific production request, so a missing endpoint is not claimed to explain every occurrence. Deploy the directory/assignment endpoints and retest the affected account. |
| 8 Validation CORS report | validateEvent is exported locally but missing in the deployed function inventory. That is verified endpoint drift; changing browser CORS headers would not create the callable. Existing Firebase callable SDK/auth flow is retained. See [validator](../functions/src/event_management.ts) and [error presentation](../admin_dashboard/src/lib/management_errors.ts). | **Partially fixed.** Browser callable HTTP 200, valid=false and actionable missing-primary errors on the new draft. Requires approved deployment and production readiness retest. |
| 9 Repeated manageEvent 400 | Client/server fields, IDs, millisecond dates, supported operations and validation were aligned. Active/paused geometry remains intentionally locked, with explicit UI guidance. Field-specific errors replace generic validation failures. | **Partially fixed.** Local real HTTP event create, route create and route update all returned 200; invalid field handler tests pass. No action-correlated historical production payload/log establishes the original 400 cause. Retest after deployment and capture endpoint/resource/operation/error code without tokens or private payloads. Do not claim an unproven cause. |
| 10 Hidden invalid controls | Management forms use explicit inline validation/noValidate and named inputs. Route map/coordinate details sit outside the submit form, avoiding hidden numeric controls blocking submission. See [route](../admin_dashboard/src/pages/RouteForm.tsx), [event](../admin_dashboard/src/pages/EventForm.tsx), and [form regressions](../admin_dashboard/tests/). | **Fixed locally.** Rendered invalid forms send no callable. Real browser saves a seven-point route and edits a fractional coordinate with details collapsed; no non-focusable control error. |
| 11 Duplicate React keys | Distinct event editor/map and group leader/status siblings use semantic key prefixes rather than the same event/group ID. See [event detail](../admin_dashboard/src/pages/EventDetailPage.tsx) and [groups](../admin_dashboard/src/pages/GroupsPage.tsx). | **Fixed locally.** Rendered sibling-key tests and actual browser event/group navigation report no duplicate-key warnings. |
| 12 Tracking errors | Connection/service/permission/GPS failures no longer masquerade as active tracking or retain accepted fixes. Instruction queries use recipient UID/state/time and display actionable errors/retry. Only the assigned primary can publish. Anonymous public viewing remains supported; permission-gated “You” is device-only and never starts uploads. See [tracking](../mobile_app/temple_procession_tracker_app/lib/core/services/tracking_service.dart), [instructions](../mobile_app/temple_procession_tracker_app/lib/core/services/instruction_service.dart), and [map](../mobile_app/temple_procession_tracker_app/lib/features/map/event_map_screen.dart). | **Partially fixed.** Mobile/rules tests pass, including reconnect, denied permission, GPS errors and anonymous local recenter. Phone logs confirm production trackingStatus permission_denied; the new UI correctly explains unavailable access. Deployed RTDB rules could not be read (401), and account/membership mirror workers are missing. No rules were loosened. Real tracking recovery remains gated on access/mirror audit and an approved field test. |
| 13 Old active event | Source policy is explicitly manual lifecycle, not auto-completion at endTime. Kept that policy and added overdue-active warnings and guidance in [event pages](../admin_dashboard/src/pages/EventsPage.tsx). Primary repair does not expire an active event. | **Fixed clarification; policy preserved.** Regression verifies expired endTime does not change active status. The live `test` event remains active with its past endTime. Changing that business policy needs a separate decision. |
| 14 Marker deprecation | Added optional AdvancedMarkerElement mode with marker-library loading and listener/map cleanup in [marker component](../admin_dashboard/src/components/MapMarker.tsx). It requires a real VITE_GOOGLE_MAPS_MAP_ID. Existing deployments without one retain legacy markers. | **Partially fixed by staged migration.** Drag/click/cleanup regression passes. Browser acceptance used the legacy fallback and still emits Google's deprecation warning; no configured production map ID or native Maps fix is claimed. |

## Verification evidence

| Check | Result |
| --- | --- |
| Backend Node 24.22.1 | ESLint/build pass; **150 tests**, zero failures/skips, serial unit + real Auth/Firestore/RTDB emulator handlers/rules/workflows. |
| Dashboard | ESLint/TypeScript/production build pass; **44 tests**, zero failures. |
| Mobile Flutter 3.44.2 and 3.44.9 with Dart 3.12.2 | Clean analysis; **90 tests** pass, including permission, tracking, feed and mocked native-map states. |
| Actual browser | [Repeatable acceptance script](../scripts/verify-repairs-browser.mjs) runs the dashboard against four local demo emulators. No handler mocks. Event create, readiness, route create/update, directory and code generation all return HTTP 200. Seven map clicks and both refreshes pass. |
| Android | ARM64 debug build succeeds on Flutter 3.44.2/Java 21/platform 36. Source/test/Android/lockfile hashes match the isolated build copy, except local SDK/JDK paths. In-place install and authenticated launch succeed on Samsung A16, Android 16/API 36. Native tiles fail authorization. |
| Deployment checks | Local preflight passes. Release preflight has **one failure: missing release signing configuration**. A debug build is not a signed release. |

APK: [app-debug.apk](../mobile_app/temple_procession_tracker_app/build/app/outputs/flutter-apk/app-debug.apk), 93,054,691 bytes. SHA-256: `BB83D8970E3CDD381134748924DA6CF4B29AC1AF2127447F7C0C727FF88EA558`.

The build emits existing Kotlin-plugin migration, Java 8 compatibility, and SDK XML tooling warnings. A coordinated Flutter/AGP/plugin migration is separate work; no dependency-validation bypass or global SDK change was used.

## Confirmed production state

The configured project is `temple-procession-walter`, region `us-central1`. [Read-only diagnostics](../scripts/diagnose-live.mjs) found 31 deployed functions and 30 local exports missing from that deployment. In particular validateEvent, listAssignableLeaders and assignGroupLeader are absent. Only the publicAnnouncements(eventId ASC, isActive ASC) composite index is READY; the other locally declared composites are absent.

For live event `test` (`YYZY6idyfgr9N0079YXK`), the initial event/public routeId was null despite route `NOCbh1WY9iE7RCt79MJu`. The existing every-30-minutes scheduler subsequently completed successfully at 2026-11-21 02:26 UTC and both references became that route, in auto mode. This was an independent scheduled repair, not an agent-triggered write. Do not redeploy unchanged reconciliation simply to repeat that repair.

Released Firestore rules differ from the local tighter policy; the live release timestamp is 2026-11-06 23:56 UTC. RTDB rules inspection returned 401. Replacing either rule set without reviewing current grants and populating canonical mirrors could break access. No security rule files were changed in this repair pass, and no broad permissions are proposed.

## Native Maps authorization action

The Google SDK itself logs the following required Android application tuple:

- Package: `com.walter.templeprocessiontracker`
- Installed/debug certificate SHA-1: `46:27:9E:62:16:29:6B:8C:0A:08:02:63:0D:24:59:19:B0:27:79:FF`

The key owner must inspect the Android key identified in the ignored local secrets file, confirm its owning Cloud project, enable Maps SDK for Android and billing in that project, and verify the Android application restriction includes this exact package/SHA-1 tuple. API restrictions must permit Maps SDK for Android. Preserve any legitimate existing restrictions; do not make the key unrestricted or put a privileged/server key in the app. Release signing needs its own certificate restriction.

The native key differs from the working browser key and Firebase client key. API Keys inspection is forbidden for the current authenticated principal, so key ownership and the exact rejected restriction remain unverified. After the owner corrects authorization, reopen the app and verify actual tiles on public/group/event/tracking maps, route/stops, Fit Route, and permission-gated local You. Browser tile success does not certify Android tiles.

## Selective deployment plan for approval

These are proposed **cmd.exe** commands, not executed deployments. Review the working diff and record deployed revisions/data backups first. Keep Firebase CLI on Node 24. Do not use a broad Functions deployment, force deletion, or a combined rules deployment: live legacy functions exist which are not current local exports.

### Local preparation

```bat
cd /d C:\Users\olive\Downloads\temple-procession-tracker
set PATH=C:\Users\olive\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;%PATH%
node --version
npm --prefix functions run lint
npm --prefix functions run build
npm --prefix admin_dashboard run lint
npm --prefix admin_dashboard test
npm --prefix admin_dashboard run build
node scripts/check-deployment.mjs
node scripts/diagnose-live.mjs --maps --rules
```

The source preflight's export check means an entry point exists locally, not that it is deployed. Inspect the separate live diagnostic for deployment state. Confirm the ignored Functions project environment has the correct production RTDB_URL and reviewed App Check setting; it exists and passes the project check. Do not enable App Check enforcement until legitimate clients are registered.

### First deployment scope

After explicit approval, deploy the declared indexes, wait until the required composites are READY, then deploy only these seven callable functions. This updates the repaired mutations/codes and creates the missing validator/directory/assignment endpoints.

```bat
firebase deploy --only firestore:indexes --project temple-procession-walter
firebase deploy --only "functions:manageEvent,functions:validateEvent,functions:deleteRoute,functions:createAccessCode,functions:redeemAccessCode,functions:listAssignableLeaders,functions:assignGroupLeader" --project temple-procession-walter
```

Index deployment includes the existing live publicAnnouncements definition. Stop if Firebase proposes an unexpected deletion; do not force it. There are 23 local composite definitions, including the two missing arrival/code history indexes and recipient instruction indexes. Wait for build completion in the console or diagnostics before enabling the updated dashboard.

Check HTTP/IAM availability of the newly created callables, authenticated owner/admin access, cross-owner rejection, readiness responses, code defaults/history, and leader names. Preserve existing App Check/IAM protections. A missing endpoint or invocation permission problem is not repaired by bypassing the Firebase callable client.

After backend and index acceptance, approve the dashboard separately:

```bat
firebase deploy --only hosting --project temple-procession-walter
```

The existing production primary reconciliation does not need another deploy to repair the already-corrected `test` event. If approving this pass's additional precise-ordering/no-op publication changes as well, their affected entry points are explicit:

```bat
firebase deploy --only "functions:mirrorPublicEvent,functions:mirrorPublicRoute,functions:reconcilePublicEvents" --project temple-procession-walter
```

### Separate tracking and release gate

The first scope is not a complete rollout of the 30 missing exports. In particular, account/membership mirrors, tracking reconciliation, route-instruction acknowledgement and newer notification workers are missing. Audit live RTDB rules and existing canonical data before choosing that migration. See [operations](OPERATIONS.md) for mirror/backfill, notification, retention and field-test gates. No speculative mirror backfill, blanket rules replacement, production GPS test, or full Functions deployment is authorized by this report.

Once that audit/backfill plan is approved, the relevant tracking worker deployment scope is:

```bat
firebase deploy --only "functions:mirrorAccountState,functions:mirrorMembershipAccess,functions:reconcileTrackingMirrors,functions:mirrorEventState,functions:mirrorGroupAssignment,functions:acknowledgeRouteInstruction,functions:reconcileTrackingHeartbeats" --project temple-procession-walter
```

Do not execute that command in isolation as a guaranteed permission fix. Rules/mirrors must agree, existing records need a reviewed backfill/reconciliation, and a real assigned-primary field test must prove recovery. Public visitors and backups must still be denied raw GPS/publishing. Release signing configuration is also required before building/distributing a production APK.

## Reproduce local acceptance

Use separate cmd.exe terminals, with Node 24, Java 21 and the locked dependencies installed. The full workflow suite resets the local demo dataset; do not share it with the browser demonstration.

```bat
cd /d C:\Users\olive\Downloads\temple-procession-tracker\functions
npm run test:rules
```

For the browser flow, the ignored local [demo parameter file](../functions/.env.demo-temple-procession) sets RTDB_URL to `http://127.0.0.1:9000?ns=demo-temple-procession-default-rtdb`; the Functions emulator requires this project parameter file in addition to shell environment variables. Start all four emulators:

```bat
cd /d C:\Users\olive\Downloads\temple-procession-tracker\functions
set RTDB_URL=http://127.0.0.1:9000?ns=demo-temple-procession-default-rtdb
npx firebase emulators:start --config ../firebase.json --project demo-temple-procession --only auth,firestore,database,functions
```

In the second terminal:

```bat
cd /d C:\Users\olive\Downloads\temple-procession-tracker
set FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
set FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
set FIREBASE_DATABASE_EMULATOR_HOST=127.0.0.1:9000
set GCLOUD_PROJECT=demo-temple-procession
set RTDB_URL=http://127.0.0.1:9000?ns=demo-temple-procession-default-rtdb
node scripts/seed-demo.mjs
node scripts/verify-repairs-browser.mjs
```

The script requires an installed Playwright/Chromium, or PLAYWRIGHT_MODULE pointing to an existing Playwright module. It starts and closes its own Vite server and browser, forces Firebase to the fixed local demo project, and never prints authentication headers or plaintext codes. Default mode uses the configured browser Maps key for seven physical clicks. `--no-maps` instead verifies seven imported points, not tiles or map clicks. No Playwright package was added to the application's dependency tree.

## Approval needed

Approve the first selective index/seven-callable deployment and subsequent hosting step, or specify a narrower scope. Native Maps key authorization needs the key owner. Tracking rules/mirror migration and production field testing remain separate approvals. No claim is made that all fourteen production symptoms are resolved before those gates pass.
