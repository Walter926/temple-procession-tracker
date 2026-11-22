# Temple Procession Tracker

Temple Procession Tracker brings event planning, group coordination, and live procession tracking together in an Android app, an organizer/admin web dashboard, and a Firebase backend with role-based access.

## Project layout

- [Flutter Android app](mobile_app/temple_procession_tracker_app/): role-aware events, organizer editing, maps, membership, leader tracking, announcements and notifications.
- [React dashboard](admin_dashboard/): event planning, route drawing, stops/groups, live/history maps, codes, suggestions and admin-only accounts.
- [Cloud Functions](functions/src/): authorization, validated management, membership transactions, tracking processing, retryable notifications and scheduled maintenance.
- [Security rules and indexes](firebase_rules/), [verification/branding scripts](scripts/), and [original supplied icon](assets/branding/temple-icon.png).

The stack is Flutter/Dart with Google Maps and Geolocator, React 19/TypeScript/Vite 8, and Firebase Authentication, Firestore, Realtime Database, Cloud Functions v2 (Node.js 24), Cloud Messaging and Storage. The source repository is [Walter926/temple-procession-tracker](https://github.com/Walter926/temple-procession-tracker).

## Features

- Role-aware authentication for event managers, assigned leaders, members, and public visitors.
- Event planning, route drawing, ordered stops, group management, and leader assignments.
- Six-digit membership codes with a 24-hour lifetime and configurable usage limits.
- Live maps, foreground GPS tracking, route progress, arrival updates, approximate ETA, and recorded paths.
- Collision advice, event/group announcements, in-app notifications, and instruction acknowledgements.
- Server-side authorization, membership transactions, retryable notification delivery, and scheduled maintenance.

## Documentation

- [Operations and configuration](docs/OPERATIONS.md)
- [Android app setup](mobile_app/temple_procession_tracker_app/README.md)
- [Dashboard setup](admin_dashboard/README.md)
- [Verification and deployment report](docs/BUG_FIX_REPORT.md)
- [Technical upgrade history](docs/UPGRADE_STATUS.md)

## Setup

Validated with Node 24.22.1, Java 21, Flutter 3.44.2 or 3.44.9/Dart 3.12.2, Android platform 36 and the repository's Gradle/AGP versions. Use the lockfiles. Newer Flutter versions may require a separate Gradle/plugin migration; do not upgrade only one part of that toolchain.

Install Git, Firebase CLI and Android Studio/SDK for local development. Use a Google Play-enabled Android emulator for development and physical phones for GPS, connectivity, and multi-device checks.

Select Flutter **3.44.2 or 3.44.9** explicitly: both use Dart 3.12.2 and pass the verification guard with the existing lockfile. Flutter 3.50 requires newer Gradle and a Material migration and is not the configured Android toolchain. Do not bypass build-dependency validation. The verification script accepts `-FlutterCommand 'C:/path/to/flutter/bin/flutter.bat'`; `-NoPub` is available when dependencies are already resolved (including Windows hosts without desktop-plugin symlink support).

```powershell
cd functions
npm ci
cd ../admin_dashboard
npm ci
cd ../mobile_app/temple_procession_tracker_app
flutter doctor -v
flutter pub get
```

On Windows, Flutter's desktop plugin symlink step can require Developer Mode. After package resolution, Android verification can use `--no-pub`.

1. Check [.firebaserc](.firebaserc), Android Firebase configuration and [Flutter Firebase options](mobile_app/temple_procession_tracker_app/lib/firebase_options.dart). Current target: `temple-procession-walter`, Functions region: `us-central1`.
2. Copy the dashboard [.env.example](admin_dashboard/.env.example) to a local environment file and supply your Firebase web configuration and restricted browser Maps key. Never put service-account credentials in browser variables.
3. Set `RTDB_URL` in the Functions project environment, using [the example](functions/.env.example), and set the dashboard's `VITE_FIREBASE_DATABASE_URL` to the same database URL. All three clients must use the same database/project; verify the URL in Firebase Console.
4. Create Android local `secrets.properties` containing `MAPS_API_KEY=...`. Restrict this key to package `com.walter.templeprocessiontracker` and the correct certificate fingerprints; use a separate HTTP-referrer-restricted browser key.
5. For a signed release, supply Android local `key.properties` with `storeFile`, `storePassword`, `keyAlias`, and `keyPassword`. Release tasks intentionally fail without these values; no debug-signed release fallback exists.
6. Bootstrap the first admin through a trusted Firebase Admin operation. Self-registration permits only organizer, team leader or team member. Do not change client rules to create an admin.

These local environment, Maps and signing files are ignored by Git. Public Firebase client identifiers are not privileged credentials. Enforce security through rules, API restrictions and App Check, not hidden web configuration.

Enable Maps SDK for Android and Maps JavaScript API in the intended Google Cloud project, and verify billing/API availability. Set `VITE_GOOGLE_MAPS_BROWSER_KEY` for the dashboard and restrict it to approved HTTP referrers (including the local development origin if needed). Android uses the Gradle/manifest `MAPS_API_KEY` substitution with a separate Android-restricted key. Authorize the package name and each build's signing certificate so map tiles can load on the device.

Android 13+ notification presentation requires notification permission; leader tracking also requires foreground location permission. Include physical-phone GPS, connectivity, and multi-device checks in event preparation. Never commit private service-account JSON, FCM tokens or signing material.

## Permissions

| Role | Event access | Management | Publish group GPS |
| --- | --- | --- | --- |
| Active admin | All events | Global, including accounts | No |
| Active organizer | Own events; ordinary published-event viewing | Own events and related records | No |
| Assigned primary leader | Assigned private event and published events | Own-group codes/announcements, status, acknowledgements | Only own group in an active event |
| Assigned backup leader | Assigned event | Read/receive group notices; requires promotion for primary actions | No |
| Active member | Joined private events and published events | Explicit active membership and own profile | No |
| Signed-out visitor | Published primary route/stops and public announcements | None | No |

Inactive accounts cannot use event data or tracking, even with an existing session. They can read their own eligibility profile and unregister an old push token. Private membership/assignment is never a publication instruction. Signed-out visitors do not receive raw live GPS.

## Main workflows

Create a draft event, draw a route, place ordered stops, create groups with valid start/end stops, and assign an active primary leader. Select the primary route and run readiness validation before scheduling/activation. Geometry edits to a scheduled event return it to draft for revalidation. Active/paused event geometry is locked.

New codes contain exactly six digits (including leading zeros), are valid for 24 hours, and default to 1000 uses; the server accepts integer limits from 1 through 1000. Previously issued six-character alphanumeric and 20-hex legacy codes remain redeemable until their recorded expiry, without truncation or migration; legacy stored unlimited limits also remain valid. Only a hash is stored; copy/share the displayed code at creation. If the dashboard reports a backend deployment is needed after creation, deploy the updated access-code functions before issuing another code. Repeated valid joins do not increment counts. Event-only membership is separate from group membership; transfers/removal are trusted operations.

Event end times do not automatically complete events. Owners manage lifecycle status explicitly; overdue active events show a warning. New routes become primary in automatic mode, while explicit manual selection survives later route creation. Editing an older route does not make it newest.

To delete an old active/paused event or one of its groups, edit the event and mark it Completed or Cancelled first. To free leaders without deleting history, use “Release leaders” on group details and confirm. Closed events allow releasing existing leaders, but not assigning replacements or promoting a backup.

Tracking belongs to the authenticated app lifecycle, not the screen. Moving samples upload about every five seconds, stationary samples every ten seconds; heartbeats are ten seconds. Original observation times are preserved. Server quality gates reject samples older than 45 seconds, over 100 m accuracy, or more than five seconds in the future. Arrival dwell is 20 seconds; trusted history is sampled at most once per 15 seconds. Opening a map or showing “You” never starts GPS publishing.

Owning organizers and admins may approve/reject current collision suggestions. Advice is an operational instruction, not automatic route geometry editing. Recurring incidents get fresh IDs. Private announcements reach only current event/group recipients; public announcements are a separate audience. In-app records and push delivery attempts are persisted separately. Read status is not instruction acknowledgement.

## Verify locally

```powershell
# From the repository root, with npm, Flutter, Java and Android SDK available:
./scripts/Verify-Local.ps1 -Rules -Android
node scripts/check-deployment.mjs
node scripts/check-deployment.mjs --release
```

Or run `npm run lint`, `npm test` in each Node project, `npm run build` in the dashboard, and `flutter analyze`, `flutter test`, `flutter build apk --debug` in the app. `npm run test:rules` in Functions starts local Auth/Firestore/RTDB emulators, builds handlers and runs both rules and workflow tests. It uses the fixed **demo** project and resets that demo dataset; do not share it with a running demo preview. Check FCM delivery and Storage access separately in the configured Firebase environment.

Verification records and deployment procedures are documented in [BUG_FIX_REPORT.md](docs/BUG_FIX_REPORT.md). The release preflight checks local prerequisites. Inspect deployed configuration and Google Maps authorization separately with `node scripts/diagnose-live.mjs --maps --rules`; this authenticated, read-only check keeps credentials private and leaves resources unchanged.

For deployment, follow the report's selective rollout plan: confirm the project, review backups and current grants, and wait for required indexes to be READY before enabling new queries. Coordinate tracking mirrors and security rules together, preserve access controls, and follow the runbook's device and operational checks.

## Local demonstration

Start demo emulators from Functions with `npx firebase emulators:start --config ../firebase.json --project demo-temple-procession --only auth,firestore,database`. Build Functions first. In another PowerShell terminal:

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8080'
$env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9099'
$env:FIREBASE_DATABASE_EMULATOR_HOST='127.0.0.1:9000'
$env:GCLOUD_PROJECT='demo-temple-procession'
node scripts/seed-demo.mjs
```

Set dashboard emulator mode and demo Firebase configuration (`VITE_FIREBASE_PROJECT_ID=demo-temple-procession`, database `https://demo-temple-procession-default-rtdb.firebaseio.com`; a nonempty demo API key/app ID suffices for local Auth). Then run `npm run dev`. The seed script refuses production endpoints. Demo-only accounts: `demo-owner@example.test` and `demo-admin@example.test`, password `EmulatorOnly!2026`. These accounts are scoped to the local demo emulators.

The screenshot demonstration uses Auth, Firestore and RTDB emulators. To exercise dashboard callable buttons, also start the Functions emulator on port 5001 with `RTDB_URL` set to the demo database and build handlers first. The automated workflow suite invokes real handlers against these local services.

Dashboard screenshots using disposable emulator data:

![Organizer event list](docs/screenshots/dashboard-events.png)

![Collision route suggestions](docs/screenshots/dashboard-route-suggestions.png)

## Operating guidance

Supported event size: 20 routes, 100 groups, 400 stops; up to 200 stops/segments per route and 2,000 geometry points. Notification fan-out uses cursor pages of 100; leader lookup uses pages of 200. See the runbook for retention and atomic deletion limits.

Performance features include versioned route caching, event-local/sparse collision processing, resumable notification fan-out, indexed retention/maintenance, bounded dashboard cursor pages, and incremental map rendering. Indexes, migration procedures, configured capacity, monitoring, and load/device checks are documented in the [optimization runbook](docs/OPERATIONS.md#optimization-rollout-and-capacity).

Treat stale positions as old observations, not current locations. GPS-derived crowding alerts are advisory, not authoritative occupancy counts or emergency guarantees. FCM is best-effort and must not be the sole channel for urgent instructions. Demo footage and screenshots should use disposable test events and omit private identifiers, access codes, and precise private locations.

GPS publishing runs while the Android app is in the foreground and continues across app-page navigation. Keep the app visible during active tracking; screen-off/background publishing is outside this foreground tracking mode.

Android is the primary mobile target. The iOS project uses a separate platform setup: macOS/Xcode/CocoaPods, Apple signing, Firebase/iOS registration, Maps configuration, platform permissions, and APNs/FCM integration, with simulator and physical-device checks for that configuration.

## License

Licensed under the [MIT License](LICENSE); copyright and exact terms remain in the existing license file.
