import 'dart:io';

import 'package:firebase_storage/firebase_storage.dart';
import 'package:image_picker/image_picker.dart';

class ProfileImageService {
  final FirebaseStorage _storage;
  final ImagePicker _imagePicker;

  ProfileImageService({
    FirebaseStorage? storage,
    ImagePicker? imagePicker,
  })  : _storage = storage ?? FirebaseStorage.instance,
        _imagePicker = imagePicker ?? ImagePicker();

  Future<XFile?> pickProfileImageFromGallery() async {
    return _imagePicker.pickImage(
      source: ImageSource.gallery,
      imageQuality: 80,
      maxWidth: 800,
    );
  }

  Future<XFile?> takeProfileImageWithCamera() async {
    return _imagePicker.pickImage(
      source: ImageSource.camera,
      imageQuality: 80,
      maxWidth: 800,
    );
  }

  Future<String> uploadProfileImage({
    required String userId,
    required XFile image,
  }) async {
    final file = File(image.path);
    final reference = _storage.ref().child('profile_images/$userId.jpg');

    await reference.putFile(file);

    return reference.getDownloadURL();
  }
}