# Temple Procession Tracker — Web dashboard

A role-aware web dashboard for planning processions, coordinating groups, and following event activity. Built with React, TypeScript, Vite, and Firebase.

## Features

- Event, route, stop, and group management.
- Leader assignments, six-digit membership codes, and event/group announcements.
- Live maps, recorded paths, collision alerts, and route suggestions.
- Administrator account management and organizer-owned event access.
- An access-code page scoped to the assigned primary leader's own group.

## Setup

Use Node.js 24 and the checked-in lockfile. From this directory:

```sh
npm ci
```

Copy [.env.example](.env.example) to `.env.local` and fill in the Firebase web configuration, Realtime Database URL, and browser Maps key. Match the Firebase project and Functions region to the [root configuration](../README.md#setup); the configured region is `us-central1`.

Enable Maps JavaScript API and restrict the browser key to the dashboard's approved HTTP referrers, including the development origin when testing locally. Use a separate Android-restricted key for the mobile app. Keep service-account credentials out of browser configuration.

Start the development server:

```sh
npm run dev
```

Open the address printed by Vite and sign in with an active account. Admins manage all events, organizers manage their own events, and assigned primary leaders use the access-code page for their group.

## Verification and build

```sh
npm run lint
npm test
npm run build
npm run preview
```

The production bundle is written to `dist/`. Firebase Hosting uses this directory, as configured in [firebase.json](../firebase.json). Review the [operations runbook](../docs/OPERATIONS.md) before publishing to the configured project.

## Local emulators

Set `VITE_USE_FIREBASE_EMULATORS=true` and use the demo project configuration from the [local demonstration guide](../README.md#local-demonstration). Start the Auth, Firestore, Realtime Database, and Functions emulators before using dashboard actions. Keep demo data separate from the live Firebase project.

See the [main README](../README.md) for the shared permission policy, configuration, and operating guidance.
