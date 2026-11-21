import 'dart:io';
import 'package:geolocator/geolocator.dart';

class GpsPermissionService {
  Future<bool> locationServicesEnabled() =>
      Geolocator.isLocationServiceEnabled();
  Future<bool> hasConnection() async {
    try {
      return (await InternetAddress.lookup(
        'firestore.googleapis.com',
      ).timeout(const Duration(seconds: 4))).isNotEmpty;
    } catch (_) {
      return false;
    }
  }

  Future<LocationPermission> requestForeground() async {
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied &&
        await locationServicesEnabled()) {
      permission = await Geolocator.requestPermission();
    }
    return permission;
  }

  Future<Position> readPosition() async {
    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 15),
      ),
    );
  }

  Future<void> openAppSettings() => Geolocator.openAppSettings();
  Future<void> openLocationSettings() => Geolocator.openLocationSettings();
}
