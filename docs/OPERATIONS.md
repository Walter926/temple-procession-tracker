# Operations, migration and acceptance

## Deployment safety

No production resources were changed during this implementation. Firebase CLI currently requires login. Before any deployment, confirm the project, database URL, region, bucket, Auth providers, billing/IAM and Android app identity with the project owner. Avoid mixing emulator environment variables with a production CLI session.

After local/field gates pass, an authorized operator can run the repository preflight and deploy the named services using the project-explicit Firebase CLI. Build the dashboard first. Deploy indexes and wait for readiness before switching clients to new queries. Deploy current Functions/rules as one coordinated rollout; old clients that wrote management/notification records directly will be denied by the new rules. Do not loosen production rules to accommodate old clients.

`node scripts/check-deployment.mjs --release` checks file presence, project alignment, callable exports and RTDB URL. It does not authenticate, deploy, validate secret values, test Maps restrictions or prove deployed versions. Never infer those checks from its success.

## Migration checklist

1. Export/back up Firestore and RTDB and record deployed versions. First rehearse in a staging project with de-identified fixtures. The demo seeder is local-only and is not a production migration.
2. Inventory profiles: canonical roles are `admin`, `organizer`, `teamLeader`, `teamMember`; `isActive` must be boolean. Repair missing/invalid profiles through trusted administration. Do not infer GPS rights from a role alone.
3. Confirm each event has a valid owning organizer. Events whose owner is removed remain admin-managed; deleting an organizer does not silently delete their event. Resolve orphan ownership before assigning a new responsible organizer operationally.
4. Validate routes/geometry and stop ordering/geofences, group route/start/end references, primary/backup profile pointers, unique memberships (`eventId_uid`) and exact group counts. Existing joins represented only by profile pointers must be audited and migrated to real membership records; they are not trusted grants.
5. Replace legacy access codes: the current protocol accepts exactly six alphanumeric characters and stores only a SHA-256 hash as document ID. Revoke old plaintext/variable-length codes. Codes are shown once and cannot be recovered from their hash.
6. Translate legacy notification/suggestion schemas only after validating recipients and lifecycle. Do not copy old profile-derived audiences or resend old instructions as current. Legacy timestamps must become Firestore Timestamps or numeric epoch milliseconds as appropriate. Legacy ISO-string precise-history records will not be swept by Timestamp range cleanup until migrated.
7. Deploy/verify composite indexes from the rules directory. Run readiness validation on events before activation. Repair publication and RTDB permission mirrors with the source-reading scheduled reconcilers; verify private-event grants and tombstones before opening traffic.
8. Enable maintenance schedules, verify the Firebase default Storage bucket is supplied to Functions, and check deletion jobs. Without a configured bucket, an account erasure remains `storage-pending`, not falsely complete.
9. Upgrade clients during the coordinated rules change. Verify owner/member/leader/visitor reads and an old authenticated session after deactivation. Roll back to a known secure coordinated version if needed; never restore broad authenticated-user GPS access.

## Schema and behavior

Firestore is canonical for profiles, events, groups, routes, stops, memberships and decisions. Server-owned RTDB projections are `accountStates`, `eventStates`, `trackingAssignments` and `eventAccess`. Clients may write only authorized primary GPS/heartbeat fields and narrowly permitted profile/group status fields. Source rereads and monotonic revisions fence unordered/duplicate Firebase triggers, as required by [Firebase's event delivery semantics](https://firebase.google.com/docs/functions/firestore-events).

Firestore operational times are Timestamps; callable input times use `...Ms`; RTDB observation/heartbeat times are epoch milliseconds. Distances/radii are meters, speed is meters/second, planned duration is minutes. GPS observation time is never replaced by receipt time. New history records include `eventId`, `groupId`, `routeId`, `userId`, coordinates, accuracy and `recordedAt`; the user field permits erasure lookup.

Membership is one record per event/user. Event-only membership has empty `groupId`; joining a group upgrades it once. Joining another group in the same event requires an owner/admin transfer. Removing/deactivating/changing the role of an account clears its assignments, memberships and active profile pointers, revokes its codes and removes device tokens; this is intentionally not reversible by merely reactivating the profile. Regenerate codes/rejoin/reassign explicitly. Removing a group downgrades surviving event membership to event-only membership. Admin account operations cannot remove the acting admin's own access.

An active collision automatically creates scoped primary-leader warnings and pending advice. Operator approval creates a separate primary-leader instruction; rejection does not. Manual operator instructions are also supported. Read status does not acknowledge an instruction. Expiry, source incident resolution, reassignment and supersession prevent old advice from remaining actionable. Owning organizers may decide, not only admins. The system is advisory and is not an emergency dispatch guarantee.

## Retention and limits

| Data | Policy |
| --- | --- |
| Precise Firestore history and last RTDB GPS | Seven days; every-minute indexed cleanup with bounded pages/cursors, including deleted-event RTDB branches. New history at most one sample per group per 15 seconds. |
| Legacy location updates, stop-presence scratch state | One day. |
| Notices, delivery/fan-out records, suggestions, instructions, announcements, arrival notices | 30 days; terminal collision records after 30 days resolved. Active/unresolved incidents are not deleted by retention. |
| Device tokens and ownership markers | 90 days since refresh, plus invalid-token/logout/deactivation/account-deletion cleanup. |
| Access codes | Invalid at exact 24-hour expiry; expired records drained every 15 minutes. |
| Rate-limit and collision scan scratch records | Expiry-based cleanup. |
| Completed/cancelled/archived event metadata and audit records | Retained until explicit administrative handling; no automatic destructive event deletion. Establish an organization-specific audit retention policy before production. |
| Deleted accounts | Access revoked first; draining private-record cleanup, live assigned positions and avatar prefix removed with a retryable job. Auth/profile are erased; minimal audit/job tombstones remain for accountability and retry safety. |

Cleanup is scheduled rather than an exact deletion deadline. Backlogs, failed schedules or unconverted legacy timestamps can delay erasure. Monitor cursor/job age and validate completion. Backups/exports and device screenshots are separate data stores requiring their own retention controls.

Each event supports 20 routes, 100 groups and 400 stops; each route 200 stops/segments and 2,000 geometry points. Account/event atomic deletion safely refuses operations affecting more than 440 records. Large events with accumulated history/notices need an operator-reviewed draining migration before hard deletion; archive and retention cleanup are available meanwhile. The code does not silently partially delete them.

Notification fan-out prioritizes leaders, drains up to 20 pages of 100 memberships/groups immediately within a 40-second budget, and checkpoints each page. A generation-fenced update trigger continues unfinished work; the minute retry worker recovers missed triggers and expired leases. Recipient and device work use bounded concurrency, deterministic IDs and fresh eligibility checks. Group audiences query only their group. Device lists cap at 20 per user. Leader lookup reads 200 directory entries per call with an explicit next cursor/load-more. Dashboard lists keep one live head of 200 records and fetch distinct historical cursor pages; operational advice is server-ordered newest-first and status-filtered before the limit. Historical pages are snapshots, not live listeners. Mobile notices increment to 1,000 with a visible cap. History filters one group/hour (normally at most 240 new samples), caps legacy windows at 1,000 and exposes previous/next-hour paging. No cross-group fictitious polyline is drawn.

Collision processing is coalesced per event at a three-second minimum interval and reconciled every two minutes without new GPS. High group counts still incur substantial per-scan reads; supported caps are not a claim of production load certification.

Collision reconciliation uses six pages of 20 records, four scan slots and a 35-second soft budget. Discovery of active events and unresolved incidents rotates independently from a durable event-job queue under `maintenanceCursors/collisionReconciliation/events`. Cursor advancement and enqueue are atomic; failures back off without blocking later events, and unstarted jobs survive a deadline. Monitor failed-job age and complete cursor-cycle time as well as per-invocation failures; a very large installation can exceed the two-minute repair target.

## Optimization rollout and capacity

Deploy the added Firestore composite indexes and RTDB `recordedAt` index before enabling the new feed and retention queries. The static preflight checks these definitions and the continuation/discovery exports; emulators do not certify production composite-index readiness.

Route geometry uses a process-local immutable LRU cache (64 routes, five-minute TTL) keyed by the parent route document's nanosecond update version. Each lookup rereads that metadata; GPS transactions recheck its version and all current account/event/assignment permissions. Trusted stop/segment edits update the route atomically. Console scripts or migrations that bypass trusted handlers **must also update the parent route in the same transaction/batch**. Never cache authorization with geometry. A cold route loads its stops/segments once per process/version; warm calls do not requery those collections.

Collision publication processes only actual collisions and previously active/suppressed incidents, not a transaction for every empty stop. RTDB collision transactions are event-local, with persistent per-stop clocks under each event. Readers ignore metadata entries. Keep legacy global `_mirrorVersions` tombstones until old Functions instances have drained and their revision floors have been migrated; do not delete them during a rolling deployment. Source revision documents remain authoritative. A newer failed scan does not fence a successfully published older scan.

Retention reserves up to 12 history pages of 400 records per minute (configured ceiling 6.912 million/day) with round-robin service for other collections and a 45-second overall budget. This is above the 576,000 samples/day generated by 100 continuously tracked groups at the 15-second sampling cap, but is a configured work ceiling, **not measured production throughput**. Multiple events, runtime limits, contention and failures reduce headroom. Watch actual removal rate and oldest expired age; scale capacity or use an operator-approved backlog drain before exceeding measured capacity. Cursor checkpoints commit atomically with deletions and records are rechecked before removal. RTDB cleanup queries expired positions per event, using a server-only branch directory, create trigger and hourly shallow-key discovery for orphan/legacy branches. It does not download all active precise positions.

Heartbeat, lifecycle and outbox workers have leased persistent cursors, bounded concurrency and per-run budgets. Failures advance fairly and are revisited after wrap; monitor failure counts and full-cycle age, especially for installations with many events. Mirror repair rotates collection priority every five minutes, pages each source and persists individual retry jobs. Unchanged permission payloads reuse revisions without a clock write, but still retry RTDB application; deletion/revocation increments remain fenced.

Mobile maps cache decoded paths, stop overlays and stationary group markers. Only changed positions animate, and unchanged heartbeats do not restart animation timers. Dashboard/mobile RTDB subscriptions use keyed child changes, preserving unchanged objects; stale clocks remain independent of incoming GPS. These changes have regression coverage but do not establish native frame-rate or battery results.

## App Check, Maps and signing

Roll out [App Check for callable Functions](https://firebase.google.com/docs/app-check/cloud-functions) in observation mode first. Register Play Integrity for signed Android builds and reCAPTCHA Enterprise for dashboard domains. Flutter uses `--dart-define=ENABLE_APP_CHECK=true`; dashboard uses its public Enterprise site key. Backend `ENFORCE_APP_CHECK=true` is independent and should be enabled only after legitimate client metrics are healthy. Register local debug tokens manually; do not commit them. RTDB/Firestore enforcement is a separate Firebase-console rollout, not implied by the callable flag.

Use separate Android and browser Maps keys. Verify Android package plus debug/release signing SHA fingerprints, browser HTTP referrers, enabled APIs, quotas and billing in the Google console. Follow the [Maps secrets plugin](https://developers.google.com/maps/documentation/android-sdk/secrets-gradle-plugin) and [Flutter Android release guidance](https://docs.flutter.dev/deployment/android). A successful debug build with a placeholder key does not certify map rendering. Current dependency KGP warnings are nonfatal on the validated Flutter baseline but require a coordinated future plugin/Gradle upgrade.

## Monitoring and cost checklist

- Alert on Function errors/retry growth, oldest `notificationDeliveries.nextAttemptAt`, terminal failed deliveries, `notificationFanouts` backlog, account deletion `pending`/`storage-pending` age, and maintenance cursor age. Delivery retry is bounded to eight claims with exponential backoff; investigate terminal failures rather than assuming push succeeded.
- Verify one-minute heartbeat/message/outbox/retention schedules, two-minute collision repair, five-minute mirror repair, 15-minute code/account jobs, 30-minute publication repair and hourly live-location discovery are actually deployed and running. Inspect Firebase/Cloud Logging without logging precise coordinates, passwords, push tokens or full messages.
- Monitor `maintenanceCursors` processed/removed/failed counts, `hasMore`, oldest expired/backlog age and last successful run, plus `mirrorRepairJobs` age. Configured page capacity is not a retention SLA. Alert if expired history grows faster than deletion or a cursor stops making a full cycle.
- Review Firestore read/write counts, RTDB download bandwidth/connections, Cloud Functions invocations/runtime and Maps API usage. Collision scans, subscriptions and fan-out are the main variable costs. Use project budget alerts and console API quota alerts before field testing. No billing alert or dashboard was provisioned by this code change.
- Keep audit records for sensitive account/assignment/event operations and verify only trusted admin tooling can access internal collections. Restrict operational service-account/IAM permissions.

## Physical-device acceptance (release blocking)

Use two primary leaders plus one member and one organizer on 2–4 Android phones; keep a separate admin dashboard session. Record model/Android/app versions, network, permission states, battery baseline and expected/actual results.

1. Create a private event from each management interface, draw/edit geometry and stops, assign leaders, validate and activate. Confirm another organizer cannot read/manage it and assignment never publishes it. Then explicitly publish/unpublish and change the primary route; verify visitor discovery and stale projection repair.
2. Generate group/event codes on both interfaces. Redeem concurrently, repeat, transfer/remove, expire/revoke and attempt from inactive accounts. Check displayed memberships, active selection and exact counts immediately.
3. Start tracking, navigate to another page, pause/resume and attempt repeated starts. Walk the same route and stay inside a stop for at least 20 seconds. Verify original sample age, progress, one arrival, sampled history and independent pan/zoom. An organizer/member “You” action must not upload their GPS.
4. Create, clear and recur a two-group collision at the same stop. Race owner/admin approvals and an opposite rejection. Verify one decision, only current relevant instructions, fresh recurring advice, leader read/acknowledged/expired/superseded states and separate manual instructions.
5. Send private event/group and public announcements. Verify no unrelated recipient; test foreground/background notification presentation, tap navigation, unread/read, token refresh, logout/account switch, deactivation, denied notification permission and real FCM retries. In-app records must survive unavailable push.
6. Enable airplane mode/drop connectivity; wait beyond 45 seconds. Check aging/disconnection without new GPS, reconnect backoff and rejection of queued old observations. Reassign, deactivate, end the event or revoke location while tracking; old phones must lose publishing rights.
7. Test small screens, font scaling, Android navigation modes, keyboard/bottom sheets, denied/permanently denied location, disabled GPS and low battery. Record battery drain over a realistic procession interval. Lock-screen/background behavior must be documented as unsupported until separately implemented and validated.
8. Capture real phone footage, review failure/backlog/cost metrics, then build a signed candidate. Do not tag/publish a release until every critical acceptance issue is resolved.
