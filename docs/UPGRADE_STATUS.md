# Upgrade status — 2026-11-18 UTC

Historical baseline: the later [bug repair report](BUG_FIX_REPORT.md) supersedes the verification counts, Firebase authentication/deployment findings and phone status below. Keep this earlier implementation inventory for context.

Local implementation and regression verification are complete for the changes listed below. “Implemented” means code is present, not that a production release has passed acceptance. All changes remain uncommitted. Deployment and physical-device acceptance remain open.

## Verification evidence

- Backend: TypeScript build and ESLint; 113 unit/rules/emulator workflow tests, including genuine Auth/Firestore/RTDB operations. No skipped integration tests in the combined run.
- Dashboard: ESLint, TypeScript/production build and 22 geometry/validation/pagination/incremental-stream tests.
- Mobile: Flutter 3.44.9 analysis with no issues and 62 tests. Android ARM64 debug APK rebuilt successfully with Java 21; this is not a signed production APK. Build used an isolated copy with identical Dart sources/tests and the same Android project/lockfile; only local SDK/JDK/CMake paths differed. The verified APK was copied to the normal app build output.
- Static project/region/callable/rules/index/branding preflight passes. Release preflight correctly blocks on three absent local configurations: dashboard Firebase/Maps environment, Android Maps secrets and Android signing properties.
- A read-only attempt to list deployed Functions failed because Firebase CLI authentication is unavailable. Production deployment, IAM, indexes, scheduled jobs and Maps restrictions were not verified.
- Real dashboard screenshots are saved in [screenshots](screenshots/), using seeded local demo data. Basemap rendering and physical-phone footage are not claimed.
- A headless browser verified organizer sign-in/event reads, suggestions, admin-only navigation redirection, the history empty state and no document overflow at 390px. Desktop and narrow-width dashboard screenshots were visually inspected. A second real Firebase/browser check verified the 200-record live head, loading 207 unique records, live status removal and resetting history when filters change. Total automated suite tests: 197 (113 backend + 22 dashboard + 62 Flutter), plus browser smoke checks.
- FCM transport is mocked in automated tests: the real outbox, retry/backoff, recipient authorization and token cleanup are tested, but real push receipt is not. Storage avatar cleanup is implemented and left durably pending when no bucket is configured; no real bucket deletion or Storage emulator test was performed.

## Final optimization pass

All six reviewed areas are implemented, with recovery and authorization regressions included:

| Area | Change and local evidence |
| --- | --- |
| History/maintenance | Every-minute indexed retention, atomic delete/checkpoint, fair leased workers and backlog-age metrics. Emulator removed 4,800 history records in a bounded pass while servicing token cleanup, then drained the remainder. RTDB orphan/legacy branches use directory discovery and indexed expiry pages. |
| GPS route reads | Immutable 64-entry, five-minute route cache keyed by nanosecond route version. Twenty-one unchanged lookups issued only one stop query and one segment query; trusted edits invalidated it. Fresh permission and version checks remain inside processing transactions. |
| Notification latency | Leaders first; immediate multi-page draining, bounded recipient/device concurrency, explicit continuation trigger and durable retry/lease recovery. One invocation handled 1,005 members plus leaders without duplicate notices. Real FCM transport remains unverified. |
| Collision cost/contention | Event-local RTDB transactions and tombstones; sparse atomic publication rather than transactions for empty stops. A 200-stop clean route incurred zero per-stop transactions/reads. Overlap, recurrence, suppressed incidents, failed newer scans and fair resumable reconciliation are tested. |
| Dashboard queries | Bounded live head plus snapshot cursor pages; newest/status ordering on the server. Unit and real-emulator browser checks cover more than 200 records, deduplication, live removal, filter changes and permission failures. Composite index definitions and deployment checks added. |
| Map rendering | Cached decoded geometry/static stops/stationary markers, per-group motion and incremental keyed child subscriptions on both clients. Unchanged heartbeats do not restart animation; stale clocks and permission-cancellation clearing are tested. Native FPS/battery claims require field measurements. |

The dependency lock now matches Flutter 3.44.9/Dart 3.12.2. The Dart SDK range and local verifier guard the documented baseline. An attempted Flutter 3.50 build correctly failed the Gradle minimum-version check; no validation bypass or global SDK migration was applied. Newer Flutter requires a separately coordinated Gradle/plugin/Material upgrade. Windows desktop-plugin symlink setup remains an OS choice, not an Android-code failure; resolved Android dependencies were checked with `--no-pub`.

The final debug build passed. Remaining nonfatal native dependency diagnostics concern legacy KGP usage, Java 8 source/target in plugins, SDK metadata compatibility and plugin deprecations/unchecked operations. They are external toolchain/plugin migration concerns, not hidden by analyzer suppressions. No physical-device installation, Maps rendering, real FCM delivery or signed release is claimed.

Deploy the added indexes before query rollout, verify all new workers are exported and observe backlog/cursor metrics. See [capacity and rollout cautions](OPERATIONS.md#optimization-rollout-and-capacity), especially the route-parent update requirement and legacy collision tombstones. Configured capacities and emulator results are not production load certification.

## Checklist mapping

| # | Area | Local outcome / remaining acceptance |
| --- | --- | --- |
| 1 | Role policy | Shared navigation, server authorization, Firestore/RTDB/Storage policy implemented; role boundary tests. |
| 2 | Organizer ownership | Event and related-record access scoped to owning organizer; cross-owner negative tests. |
| 3 | Registration | Three permitted roles; admin/assignment/membership injection denied; leader role alone cannot publish. |
| 4 | Account management | Trusted admin create/edit/role/activation/delete; Auth metadata saga and retryable private-record/avatar cleanup. Real Storage verification pending. |
| 5 | Session enforcement | Live profile eligibility, app cleanup, server gates and revisioned RTDB capability revocation; deactivation/downgrade tested. |
| 6 | RTDB permissions | Active event/group access and current primary publishing; stale/forged/invalid/replayed writes tested. |
| 7 | Dashboard organizer tools | Owner-authorized event/route/stop/group CRUD and leader assignment. |
| 8 | Mobile organizer tools | Actual editing, route drawing, stop placement, groups, leader assignment and status controls. Native Maps gestures require field acceptance. |
| 9 | Mobile Events | Real role-aware lists/details and loading/empty/error states. |
| 10 | Event maps | Published route discovery and assigned private maps; visitors see route/stops, not raw live GPS. |
| 11 | Public projections | Transactional sync plus source-reading triggers and periodic repair for visibility/status/primary route. |
| 12 | Membership display | Immediate own-membership streams, event-only/group distinction and explicit active selection. |
| 13 | Membership consistency | Atomic counts, repeat-safe joins, owner-authorized transfers/removal and deletion behavior tested. |
| 14 | Route editing | Click/tap creation, editing, undo/clear/preview, encoded geometry and along-path distance; legacy encoding preserved. |
| 15 | Stops/readiness | Coordinates, order, timing, geofence, route/group relationships and active primary leader validated before activation. |
| 16 | Tracking/organizer maps | Routes, stops, group positions/state; organizers view all groups without GPS publish rights. |
| 17 | Own position | Permission-triggered “You” and recenter, device/browser-only. Physical permission UX pending. |
| 18 | Codes | Random six-character hashed codes, collision retry, 24-hour expiry, multi-member reuse, revocation/cleanup. |
| 19 | Leader codes | Primary leader mobile code panel, copy/share and server own-group scope. |
| 20 | Redemption | Current account/code/event/group validation even for repeat joins; persistent attempt throttling. |
| 21 | Announcements | Mobile and dashboard private group/event composer, separate public audience, repeat-safe fan-out. Real-device receipt pending. |
| 22 | Suggestions | Generation, display, feedback, owner/admin decisions and leader outbox implemented/tested. Deployment and real leader receipt pending. |
| 23 | Concurrent decisions | Opposite/concurrent/repeated decisions produce one atomic result without duplicate instructions. |
| 24 | Recurring collisions | New incident generation/IDs at the same stop with fresh notices; emulator regression. |
| 25 | Message lifecycle | Active/acknowledged/resolved/expired/superseded states and relevance checks. Read and acknowledgement remain distinct. |
| 26 | Navigation-safe tracking | Root-owned singleton session, serialized starts/stops and one timer/subscription set; tests pass. Screen-off tracking excluded. |
| 27 | Tracking state | Paused/stopped/error handling, heartbeat aging, disconnect/reassignment/logout/event-end cleanup. Device lifecycle acceptance pending. |
| 28 | Quality/timing | Five/ten-second uploads, ten-second heartbeat, 20-second dwell, 45-second server age/gap, original times, 15-second history sampling. |
| 29 | Reconnect | Bounded backoff, pending-write purge, stale-sample rejection and ordered sample watermarks tested. Airplane-mode field run pending. |
| 30 | Push lifecycle | Root attach/detach, refresh, account switching, deactivation and invalid token cleanup; fake-driver/emulator tests. |
| 31 | Reliable push | Durable delivery records, leases, per-device success, backoff, capped attempts and eligibility recheck; transport mocked. |
| 32 | Notifications | Foreground presentation, tap navigation, unread/read and explicit instruction acknowledgement; phone acceptance pending. |
| 33 | History camera | Accessible manager history views, group/hour paging, first-fit camera and explicit Fit Path; native pan/zoom acceptance pending. |
| 34 | Layout | Safe areas, keyboard-aware sheets, responsive dashboard and touch controls; emulator browser checks plus widget tests, phone matrix pending. |
| 35 | Branding | Supplied DOCX icon extracted into launcher/web/favicon assets; readable gray glass styling. Original document unchanged. |
| 36 | Navigation | Admin-only Users, Settings redirect, actual management screens and removed placeholders. |
| 37 | Deletion/consistency | Transactional related-record checks/cleanup; safe refusal beyond 440 affected records rather than partial deletion. Large-record maintenance migration remains operational work. |
| 38 | Retries/mirrors | Source rereads, transactional watermarks, monotonic revisions, tombstones and scheduled assignment/event/alert reconciliation. |
| 39 | Validation/abuse | Field/type/size/coordinate/relationship checks, code/account/announcement quotas, sensitive audit records and optional App Check initialization. Console enrollment/enforcement pending. |
| 40 | Query performance | Scoped/limited operational queries, load-more controls, group/hour history windows and declared composite indexes. Production index readiness pending. |
| 41 | Scaling | Event caps enforced; fan-out and leader-directory cursors; whole-event collision scans coalesced to at most one per three seconds plus periodic fallback. Load/cost test pending. |
| 42 | Privacy/retention | Scheduled bounded cleanup of precise history/live positions, messages, tokens, codes and retryable account erasure. Completed event metadata retained until explicit admin action. Monitor production job completion. |
| 43 | Cleanup | Legacy client-owned notification/suggestion writers and duplicates removed; timestamps/units/errors reconciled. Dart formatting applied. |
| 44 | Automation | Backend 113, dashboard 22 and Flutter 62 passing tests; lint/build/analyze, ARM64 debug APK and browser checks verified. |
| 45 | Field integration | Local multi-role emulator workflows verified. 2–4-phone GPS/FCM/permission/network/battery suite not run. Release-blocking. |
| 46 | Operations | Configuration preflights, setup/runbook, signing gate, maintenance and outbox telemetry implemented. Firebase login, real configuration, deployment/monitoring/budgets remain operator gates. |
| 47 | Documentation/release | README, schema/migration/permissions/limits, test evidence and real local screenshots added. Signed release/tag and phone footage deliberately deferred until acceptance passes. |

## Release gates — do not mark complete yet

1. Authenticate Firebase CLI and confirm the intended staging/production project. Supply the missing local Maps/environment/signing configuration; verify billing, API restrictions and certificate fingerprints.
2. Back up existing data and perform the staged migration in [OPERATIONS.md](OPERATIONS.md). Deploy tested Functions/rules/indexes together in a maintenance window; verify index readiness and scheduled jobs before enabling traffic.
3. Run the complete physical-phone acceptance matrix, including real notification delivery. Record devices, Android versions, expected/actual results, timestamps and battery measurements. Attach real phone screenshots/footage.
4. Review logs, failed deliveries/deletion jobs, App Check metrics and spending alerts. Create a signed release only when these gates pass. Do not interpret the debug APK or static preflight as production acceptance.
