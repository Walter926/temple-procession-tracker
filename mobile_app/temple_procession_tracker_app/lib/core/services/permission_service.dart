import 'package:permission_handler/permission_handler.dart';

class PermissionService {
  Future<PermissionStatus> requestLocationWhenInUse() async {
    return Permission.locationWhenInUse.request();
  }

  Future<PermissionStatus> requestLocationAlways() async {
    return Permission.locationAlways.request();
  }

  Future<PermissionStatus> requestCamera() async {
    return Permission.camera.request();
  }

  Future<PermissionStatus> requestPhotos() async {
    return Permission.photos.request();
  }

  Future<PermissionStatus> requestNotification() async {
    return Permission.notification.request();
  }

  Future<bool> hasLocationPermission() async {
    final whenInUse = await Permission.locationWhenInUse.status;
    final always = await Permission.locationAlways.status;

    return whenInUse.isGranted || always.isGranted;
  }

  Future<bool> hasCameraPermission() async {
    final status = await Permission.camera.status;

    return status.isGranted;
  }

  Future<bool> hasPhotoPermission() async {
    final status = await Permission.photos.status;

    return status.isGranted;
  }

  Future<bool> hasNotificationPermission() async {
    final status = await Permission.notification.status;

    return status.isGranted;
  }

  Future<void> openAppSettingsPage() async {
    await openAppSettings();
  }
}