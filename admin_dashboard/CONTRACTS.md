# Dashboard cross-scope integration

Dashboard-only work. No deployment or commits. Backend-owned membership, notification, Auth, and assignment records are never mutated directly.

Callable contracts verified against backend source and index exports (region `us-central1`, override `VITE_FUNCTIONS_REGION`):

| Callable | Request | Response |
| --- | --- | --- |
| `manageEvent` | `{ operation: 'create'|'update'|'delete', resource: 'event'|'route'|'stop'|'group'|'segment', eventId, id?, data? }` | `{ id }` |
| `validateEvent` | `{ eventId }` | `{ valid, errors: string[] }` |
| `assignGroupLeader` | `{ groupId, leaderUserId, backupLeaderUserId }` (empty IDs unassign) | success |
| `listAssignableLeaders` | `{ eventId, groupId, cursor? }` | `{ users: [{ id, displayName, fullName, email, role, isActive, assignedGroupId, isEligible, profileMissing? }], nextCursor: string|null }` (200 directory profiles plus current assigned profiles) |
| `manageAccount` | `{ operation: 'create'|'update'|'delete', uid?, email?, password?, displayName?, role?, isActive? }` | `{ uid }` |
| `sendAnnouncement` | `{ eventId, groupId?, audience: 'event'|'group'|'public', message, requestId }` | `{ ok, announcementId }` |
| `decideRouteSuggestion` | `{ suggestionId, decision: 'approved'|'rejected' }` | `{ ok, status, instructionId? }` |
| `createAccessCode` | `{ eventId, groupId, scope: 'event'|'group', grantedRole: 'teamMember', enabled: true, maxUses: 1000 }` | `{ id, code, expiresAtMs, maxUses }` (6 alphanumeric, fixed 24 hours; integer maxUses 1..1000, default 1000) |
| `revokeAccessCode` | `{ id }` | `{ revoked: true }` |

Deletion is intentionally disabled for active/paused events and their groups. Owners must explicitly mark the event completed or cancelled first; an elapsed end time does not change its status. “Release leaders” calls `assignGroupLeader` with both leader IDs empty, after confirmation, without deleting the event/group or its history. Closed events permit removal or same-slot retention of existing leaders, never new assignments or backup promotion; releasing them preserves historical group status and only clears profile pointers still belonging to that group.

`manageEvent` serializes event dates as `startTimeMs/endTimeMs`, stop dates as `expectedArrivalTimeMs/expectedDepartureTimeMs`, not client Timestamp objects. Server assigns immutable ownership, created/updated timestamps, member counters, membership/assignment cleanup, route stop/segment references, and public projections. New dashboard event/route creates send a stable client `id`; event create uses that same `eventId`. Ambiguous retries replay the original payload before applying later edits as an update. Legacy ID-less creates remain accepted but cannot deduplicate retries. Event update supports `routeId` for manual primary selection and validates activation. All operations require admin or owning organizer. Deletions reject unsafe relationships or clean related records atomically.

Directory labels prefer display name, full name, email, then a non-UID fallback. Current assigned inactive or missing profiles are included for display only, not new assignment eligibility. Historical repository 20-hex code input is accepted on redemption using existing hash/expiry/eligibility checks; no production code-format claim or hash migration is implied. Stored legacy missing/zero maxUses remain unlimited without rewriting codes.

Leader lookup must authorize against event/group and return a limited active leader directory rather than expose arbitrary users to organizers. Suggestion decisions must be atomic, owner-authorized, repeat-safe, revalidate the incident, and persist/deliver leader instructions once. Suggestions read `routeSuggestions` by `eventId`, including `status`, `reason`, `groupId`, `suggestedRouteSegmentIds`, `createdAt`, optional `expiresAt` and `incidentId`.

Announcements read `announcements` and `publicAnnouncements` by `eventId`; private fan-out and eligibility belong to `sendAnnouncement`. RTDB reads: `liveLocations/{eventId}`, `trackingStatus/{eventId}`, `activeCollisionAlerts/{eventId}`. Tracking status contains `{ state, updatedAt, userId }` per group.

These are source-level contracts, not claims of deployment. Authenticated cross-role emulator tests, reCAPTCHA configuration, Maps restrictions and real-device field testing remain release requirements owned by the parent. No dashboard blocker remains in source-level callable alignment.
