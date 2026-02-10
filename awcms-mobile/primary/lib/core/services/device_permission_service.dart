/// AWCMS Mobile - Device Permission Service
///
/// Service untuk menangani permintaan izin perangkat (Kamera, Galeri).
library;

import 'dart:io';
import 'package:permission_handler/permission_handler.dart';
import 'package:device_info_plus/device_info_plus.dart';

class DevicePermissionService {
  /// Request camera permission
  Future<bool> requestCameraPermission() async {
    final status = await Permission.camera.request();
    return status.isGranted;
  }

  /// Request photos/gallery permission
  Future<bool> requestPhotosPermission() async {
    if (Platform.isAndroid) {
      final androidInfo = await DeviceInfoPlugin().androidInfo;
      // Android 13+ (API 33+) uses READ_MEDIA_IMAGES
      if (androidInfo.version.sdkInt >= 33) {
        final status = await Permission.photos.request();
        return status.isGranted;
      } else {
        // Android < 13 uses READ_EXTERNAL_STORAGE
        final status = await Permission.storage.request();
        return status.isGranted;
      }
    } else {
      // iOS
      final status = await Permission.photos.request();
      return status.isGranted;
    }
  }

  /// Check current camera permission status
  Future<bool> checkCameraPermission() async {
    return await Permission.camera.isGranted;
  }

  /// Check current photos permission status
  Future<bool> checkPhotosPermission() async {
    if (Platform.isAndroid) {
      final androidInfo = await DeviceInfoPlugin().androidInfo;
      if (androidInfo.version.sdkInt >= 33) {
        return await Permission.photos.isGranted;
      } else {
        return await Permission.storage.isGranted;
      }
    } else {
      return await Permission.photos.isGranted;
    }
  }

  /// Open app settings
  Future<void> openSettings() async {
    await openAppSettings();
  }
}
