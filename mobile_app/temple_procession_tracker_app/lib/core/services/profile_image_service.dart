import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_storage/firebase_storage.dart';
import 'package:flutter/foundation.dart';
import 'package:image_picker/image_picker.dart';

class ProfileImageService {
  static const int maxImageSizeBytes = 5 * 1024 * 1024;

  final FirebaseStorage _storage;
  final ImagePicker _imagePicker;

  ProfileImageService({FirebaseStorage? storage, ImagePicker? imagePicker})
      : _storage = storage ?? FirebaseStorage.instance,
        _imagePicker = imagePicker ?? ImagePicker();

  Future<String?> pickAndUploadProfileImage({required String userId}) async {
    final XFile? image = await _imagePicker.pickImage(
      source: ImageSource.gallery,
      maxWidth: 1024,
      maxHeight: 1024,
      imageQuality: 85,
    );

    if (image == null) {
      debugPrint('PROFILE UPLOAD DEBUG: Image selection cancelled.');
      return null;
    }

    final bytes = await image.readAsBytes();

    if (bytes.lengthInBytes > maxImageSizeBytes) {
      throw StateError('The selected image is larger than 5 MB.');
    }

    final String? authUid = FirebaseAuth.instance.currentUser?.uid;
    final String storagePath = 'profile_images/$userId/avatar';

    final Reference reference = _storage.ref(storagePath);

    final String contentType = image.mimeType != null && image.mimeType!.startsWith('image/')
        ? image.mimeType!
        : 'image/jpeg';

    debugPrint('========== PROFILE UPLOAD DEBUG ==========');
    debugPrint('Firebase Auth UID: $authUid');
    debugPrint('Profile userId: $userId');
    debugPrint('UIDs match: ${authUid == userId}');
    debugPrint('Storage bucket: ${_storage.bucket}');
    debugPrint('Storage path: $storagePath');
    debugPrint('Image bytes: ${bytes.lengthInBytes}');
    debugPrint('Image MIME type: ${image.mimeType}');
    debugPrint('Upload content type: $contentType');
    debugPrint('==========================================');

    if (authUid == null) {
      throw StateError('No authenticated Firebase user is available.');
    }

    if (authUid != userId) {
      throw StateError('Profile user ID does not match Firebase Authentication UID.');
    }

    try {
      debugPrint('PROFILE UPLOAD: Starting Firebase Storage upload...');

      await reference.putData(
        bytes,
        SettableMetadata(contentType: contentType),
      );

      debugPrint('PROFILE UPLOAD: File uploaded successfully.');

      final String downloadUrl = await reference.getDownloadURL();

      debugPrint('PROFILE UPLOAD: Download URL retrieved successfully.');

      return downloadUrl;
    } on FirebaseException catch (error) {
      debugPrint('========== FIREBASE STORAGE ERROR ==========');
      debugPrint('Error code: ${error.code}');
      debugPrint('Error message: ${error.message}');
      debugPrint('Error plugin: ${error.plugin}');
      debugPrint('============================================');

      rethrow;
    } catch (error) {
      debugPrint('PROFILE UPLOAD ERROR: $error');
      rethrow;
    }
  }
}