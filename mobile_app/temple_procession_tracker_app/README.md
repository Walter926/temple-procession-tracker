# Temple Procession Tracker — Android app

See the [root setup and permission policy](../../README.md), latest [bug repair report](../../docs/BUG_FIX_REPORT.md), earlier [upgrade status](../../docs/UPGRADE_STATUS.md) and [operations/field-test runbook](../../docs/OPERATIONS.md).

Validated baseline: Flutter 3.44.2 or 3.44.9 / Dart 3.12.2, Java 21 and Android platform 36. Latest analysis is clean and all 90 tests pass. Run `flutter pub get`, `flutter analyze`, `flutter test`, then `flutter build apk --debug`. Windows desktop plugin setup can require Developer Mode; Android checks may use `--no-pub` after package resolution. Do not upgrade Gradle/Flutter/plugins independently.

Android builds require a non-placeholder Maps key in the ignored local secrets file. The explicit `-PallowUnconfiguredMaps=true` Gradle switch is only for compile-only debug CI, never device acceptance or releases. A valid-looking key does not prove Google Cloud package/certificate restrictions are correct. Blank native tiles remain a physical-device release blocker described in the repair report.

Supply Android local Maps secrets before using native maps and local signing properties before a release. Real Firebase config must match the backend project and `us-central1`. Optional App Check uses `--dart-define=ENABLE_APP_CHECK=true` after enrollment.

Tracking survives app-page navigation through the root-owned service. It does not implement reliable screen-off background tracking. iOS release and physical 2–4-phone acceptance remain separate gates. Current local verification: 62 tests and clean analysis on the pinned Flutter baseline; Android build evidence is in the upgrade status. No signed release or real-device certification.
