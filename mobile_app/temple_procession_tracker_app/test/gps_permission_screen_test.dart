import 'dart:async';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:geolocator/geolocator.dart';
import 'package:temple_procession_tracker_app/core/services/gps_permission_service.dart';
import 'package:temple_procession_tracker_app/features/tracking/gps_permission_screen.dart';

class GpsChecks extends GpsPermissionService {
  bool enabled = true, connected = true;
  LocationPermission permission = LocationPermission.whileInUse;
  Object? error;
  int reads = 0;
  @override
  Future<bool> locationServicesEnabled() async => enabled;
  @override
  Future<bool> hasConnection() async => connected;
  @override
  Future<LocationPermission> requestForeground() async => permission;
  @override
  Future<Position> readPosition() async {
    reads++;
    if (error != null) throw error!;
    return Position(
      latitude: 49,
      longitude: -123,
      timestamp: DateTime.now(),
      accuracy: 8,
      altitude: 0,
      altitudeAccuracy: 0,
      heading: 0,
      headingAccuracy: 0,
      speed: 0,
      speedAccuracy: 1,
    );
  }
}

void main() {
  Future<void> show(WidgetTester tester, GpsChecks service) => tester
      .pumpWidget(MaterialApp(home: GpsPermissionScreen(service: service)));
  Future<void> check(WidgetTester tester) async {
    await tester.tap(find.text('Allow Location and Check GPS'));
    await tester.pumpAndSettle();
  }

  ElevatedButton proceed(WidgetTester tester) => tester.widget<ElevatedButton>(
    find.widgetWithText(ElevatedButton, 'Continue to Tracking'),
  );
  testWidgets('Location Services off is not a permission denial', (
    tester,
  ) async {
    final service = GpsChecks()..enabled = false;
    await show(tester, service);
    await check(tester);
    expect(
      find.textContaining('Device Location Services are off'),
      findsOneWidget,
    );
    expect(find.text('Permission: whileInUse'), findsOneWidget);
    expect(find.textContaining('permission is denied'), findsNothing);
    expect(service.reads, 0);
    expect(proceed(tester).onPressed, isNull);
  });
  testWidgets('permanently denied permission needs settings, not a GPS read', (
    tester,
  ) async {
    final service = GpsChecks()..permission = LocationPermission.deniedForever;
    await show(tester, service);
    await check(tester);
    expect(find.text('Open App Settings'), findsOneWidget);
    expect(service.reads, 0);
    expect(proceed(tester).onPressed, isNull);
  });
  testWidgets('failed recheck clears the previous fix and disables Continue', (
    tester,
  ) async {
    final service = GpsChecks();
    await show(tester, service);
    await check(tester);
    expect(proceed(tester).onPressed, isNotNull);
    service.error = TimeoutException('No GPS fix');
    await check(tester);
    expect(find.textContaining('GPS error:'), findsOneWidget);
    expect(find.textContaining('Latitude:'), findsNothing);
    expect(proceed(tester).onPressed, isNull);
  });
  testWidgets('DNS probe failure does not masquerade as GPS or RTDB failure', (
    tester,
  ) async {
    final service = GpsChecks()..connected = false;
    await show(tester, service);
    await check(tester);
    expect(
      find.textContaining('tracking will check the actual live connection'),
      findsOneWidget,
    );
    expect(proceed(tester).onPressed, isNotNull);
  });
}
