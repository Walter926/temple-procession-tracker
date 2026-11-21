# Temple Tracker management dashboard

React 19, TypeScript, Vite and Firebase. This interface supports active administrators and organizers; organizer event selectors query only `organizerId == currentUser.uid`. Every related subscription is constrained by the selected event or route. Backend rules and callables enforce the same boundary.

## Local setup

Use Node 24 or a compatible Node version supported by the installed Vite release. Install the locked dependencies with `npm ci`, copy [.env.example](./.env.example) to a local environment file, and set the Firebase web configuration and restricted browser Maps key. Start the development server with `npm run dev`.

All Firebase services must use the same project and database. Functions default to `us-central1`; override `VITE_FUNCTIONS_REGION` only when the backend is configured in that region.

Optional App Check: set `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` to initialize a reCAPTCHA Enterprise provider with automatic token refresh. Leave it empty until the site/domain registration is ready. Backend enforcement is an independent rollout using `ENFORCE_APP_CHECK=true`; that flag is not a browser variable. No debug tokens are bundled.

For local integration, set `VITE_USE_FIREBASE_EMULATORS=true` and optionally `VITE_FIREBASE_EMULATOR_HOST`. Auth uses 9099, Firestore 8080, RTDB 9000 and Functions 5001. Start and seed those emulators separately; emulator mode never starts services automatically.

## Implemented workflows

- Events: create drafts; edit visibility, contacts and status; check readiness; select primary routes; view all groups live; validated related-record deletion.
- Routes: click/tap points, drag/edit coordinates, undo, clear, preview, import an existing encoded polyline, automatic encoded geometry and path distance. Unedited legacy encodings are preserved.
- Stops: map selection with a visible selected marker, coordinate editing, unique ordering, geofence/capacity/time validation.
- Groups: route-bound ordered start/end stops, owner-authorized leader lookup and assignment, group status and progress, safe server-owned membership cleanup on deletion.
- Codes: six alphanumeric characters, server-defined 24-hour expiry, default 1000 uses, copy-once display, revocation and live expired/exhausted labels. Event membership is distinct from group membership. Assigned leaders generate group codes in the mobile app. Existing unlimited codes are not rewritten.
- Live map: all event routes, stops, group positions, collisions, tracking status and aging GPS/heartbeat labels. Panning is not overridden by new samples. Fit and permission-triggered browser-only “You” recenter controls are explicit.
- Recorded paths: manager-only, per-group one-hour history windows with previous/next/latest paging, seven-day retention, initial camera fit and explicit recenter. The subscription starts only when the history panel is opened.
- Route suggestions: event-scoped collision advice, current/expired/decided states, owner approve/reject actions, server-authoritative atomic decisions and queued leader delivery. Advice coordinates movement; it does not silently rewrite geometry.
- Announcements: explicit private event, private group or public audience. Stable request IDs make retries safe. Server-owned fan-out rechecks eligible recipients.
- Users: admin-only create/edit/activate/deactivate/delete through Auth-aware backend account operations. Organizers never load the Users collection or see its navigation item.
- Gray glass-style responsive layout, keyboard focus and skip link, touch-size controls, readable disabled states, reduced-motion/transparency support. Parent-provided public temple and favicon images are referenced without binary edits.
- Settings is removed from navigation; old settings URLs redirect to Events. Unused placeholder and duplicate leader-panel sources were removed.

Supported backend sizes are shown on event details: 20 routes, 100 groups and 400 stops per event; 200 stops/segments per route and 2000 geometry points per route. Event lists and operational histories use bounded queries with load-more controls. Geometry/groups are editable while draft or scheduled; group status updates remain a separate operation. Deletions are disabled while active or paused. Backend errors are surfaced without pretending an operation succeeded.

## Contracts and ownership

See [CONTRACTS.md](./CONTRACTS.md) for exact callable payloads and responses. All writes go through trusted callables. The client never writes Auth profiles, assignment pointers, counters, memberships, notifications, publication mirrors or RTDB GPS. Event contacts are private and separate from public projections.

The dashboard exports `firebaseApp`, `auth`, `db`, `rtdb` and region-configured `functions`. Its management adapter exposes `callManagement`, `saveResource`, `deleteResource` and `errorMessage`. Data hooks expose bounded `useRecords`, `useManagedEvents`, direct scoped `useManagedEvent`, `useEventContacts`, `useLiveEvent` and `useRouteStops`.

## Verification

Run:

```text
npm test
npm run lint
npm run build
```

The Node test suite checks the reference encoded-polyline round trip, path distance along multiple legs, malformed/invalid/zero-length geometry, stop ordering/geofence/coordinate/capacity constraints, and tracking state aging without a new sample.

Local verification: TypeScript, ESLint, production build and all 44 tests pass, including rendered form validation, duplicate submission/retry handling, leader directory states, query failures, stable sibling keys and optional advanced-marker listener cleanup. Route pages load lazily and Firebase/React vendor code is split for caching. Nothing was deployed or committed.

Set optional `VITE_GOOGLE_MAPS_MAP_ID` to a real map ID to use AdvancedMarkerElement. The marker library is loaded only in that mode; existing deployments without a map ID retain their legacy markers. Native Android tiles are independent of this browser setting. See the latest [bug repair report](../docs/BUG_FIX_REPORT.md) for current HTTP acceptance and verified production drift.

The parent integration pass additionally verified cross-role Auth/Firestore/RTDB emulator workflows and real browser sign-in, suggestions, history empty states, organizer redirection away from Users and a 390px layout. See [the full status](../docs/UPGRADE_STATUS.md). Real reCAPTCHA/Maps configuration, deployed project verification, real push delivery and multi-phone tracking/network-loss tests remain release gates.
