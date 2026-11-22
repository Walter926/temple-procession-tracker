# Temple Procession Tracker — Android app

An Android app for joining procession events, coordinating assigned groups, and following live event activity. Built with Flutter and Firebase, with Google Maps for route and group visualization.

## Features

- Role-aware event access for organizers, leaders, members, and public visitors.
- Event, route, stop, and group management for authorized event managers.
- Six-digit membership codes, valid for 24 hours, with event or group scope.
- Route maps, group positions, arrival updates, and foreground leader tracking.
- Announcements, an in-app notification inbox, and instruction acknowledgements.

## Setup

Use Flutter 3.44.2 or 3.44.9 with Dart 3.12.2, Java 21, and Android platform 36. Keep Flutter, Gradle, and plugin versions aligned with the repository's lockfiles and Android configuration.

From this directory:

```sh
flutter doctor -v
flutter pub get
```

Match Firebase configuration to the backend project and Functions region `us-central1`. Follow the [shared setup guide](../../README.md#setup) for Firebase registration, roles, and environment settings.

## Google Maps

Create the ignored local file `android/secrets.properties` containing `MAPS_API_KEY=...`. Use the project's Android Maps key, enable Maps SDK for Android, and authorize:

- Package name: `com.walter.templeprocessiontracker`.
- The SHA-1 signing certificate for each debug or release build that uses the key.

Keep existing authorized certificates and restrict the key to Maps SDK for Android. Use a separate HTTP-referrer-restricted key for the web dashboard. Check billing and key authorization when map tiles fail to load on a device.

The Gradle switch `-PallowUnconfiguredMaps=true` is reserved for compile-only debug CI. Device builds use a configured Maps key.

## Run and verify

```sh
flutter analyze
flutter test
flutter devices
flutter run -d <android-device-id>
flutter build apk --debug
```

The debug APK is written to `build/app/outputs/flutter-apk/app-debug.apk`. After dependency resolution, add `--no-pub` to verification/build commands when appropriate. On Windows, desktop-plugin symlink setup can require Developer Mode.

## Permissions and tracking

Enable foreground location permission for leader tracking and notification permission on Android 13+. Only the active assigned primary leader publishes a group's GPS. Tracking continues across app-page navigation while the app stays in the foreground; keep the app visible during active tracking.

New codes contain six numeric digits, including leading zeros. Existing six-character or 20-hex invitations can be redeemed through “Use an older code” until their recorded expiry. Codes grant membership, not GPS publishing rights.

Optional App Check uses `--dart-define=ENABLE_APP_CHECK=true` after enrollment. For signed release builds, supply the ignored local `android/key.properties` signing configuration. Keep signing material and private credentials out of Git.

See the [main README](../../README.md), [operations runbook](../../docs/OPERATIONS.md), and [verification and deployment report](../../docs/BUG_FIX_REPORT.md) for shared configuration and operational procedures.
