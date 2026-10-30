import 'dart:io';
import 'package:geolocator/geolocator.dart';

class GpsPermissionService {
  Future<bool> hasConnection() async {
    try { return (await InternetAddress.lookup('firestore.googleapis.com').timeout(const Duration(seconds: 4))).isNotEmpty; }
    catch (_) { return false; }
  }

  Future<LocationPermission> requestForeground() async {
    final serviceEnabled = await Geolocator.isLocationServiceEnabled();
    if (!serviceEnabled) return LocationPermission.denied;
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) permission = await Geolocator.requestPermission();
    return permission;
  }

  Future<Position> readPosition() async {
    return Geolocator.getCurrentPosition(locationSettings: const LocationSettings(accuracy: LocationAccuracy.best));
  }

  Future<void> openAppSettings() => Geolocator.openAppSettings();
  Future<void> openLocationSettings() => Geolocator.openLocationSettings();
}