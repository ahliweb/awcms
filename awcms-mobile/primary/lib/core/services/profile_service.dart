/// AWCMS Mobile - Profile Service
///
/// Service untuk mengelola data profil pengguna.
library;

import 'dart:io';
import 'package:supabase_flutter/supabase_flutter.dart';
import 'package:image_picker/image_picker.dart';
import '../models/user_profile.dart';

class ProfileService {
  final SupabaseClient _supabase = Supabase.instance.client;
  final ImagePicker _picker = ImagePicker();

  /// Get current user profile
  Future<UserProfile?> getProfile() async {
    final user = _supabase.auth.currentUser;
    if (user == null) return null;

    try {
      // Fetch from 'users' table
      final data = await _supabase
          .from('users')
          .select('id, full_name, avatar_url, email')
          .eq('id', user.id)
          .maybeSingle();

      if (data == null) return null;

      // Note: 'email' might not be in the public 'users' table depending on RLS/Schema
      // If it's missing, we fall back to the auth user email
      final profileData = Map<String, dynamic>.from(data);
      if (profileData['email'] == null) {
        profileData['email'] = user.email;
      }

      // Fetch role separately if not joined, or handle roles table logic here
      // For now, simple implementation based on existing auth service logic or data

      return UserProfile.fromJson(profileData);
    } catch (e) {
      throw Exception('Failed to fetch profile: $e');
    }
  }

  /// Update user profile (name)
  Future<void> updateProfile({String? fullName}) async {
    final user = _supabase.auth.currentUser;
    if (user == null) throw Exception('No user logged in');

    final updates = <String, dynamic>{
      'updated_at': DateTime.now().toIso8601String(),
    };

    if (fullName != null) updates['full_name'] = fullName;

    try {
      // 1. Update public.users table
      await _supabase.from('users').update(updates).eq('id', user.id);

      // 2. Update Auth Metadata (optional, but good for sync)
      if (fullName != null) {
        await _supabase.auth.updateUser(
          UserAttributes(data: {'full_name': fullName}),
        );
      }
    } catch (e) {
      throw Exception('Failed to update profile: $e');
    }
  }

  /// Update password
  Future<void> updatePassword(String newPassword) async {
    try {
      await _supabase.auth.updateUser(UserAttributes(password: newPassword));
    } catch (e) {
      throw Exception('Failed to update password: $e');
    }
  }

  /// Upload avatar
  Future<String?> uploadAvatar({
    ImageSource source = ImageSource.gallery,
  }) async {
    final user = _supabase.auth.currentUser;
    if (user == null) throw Exception('No user logged in');

    try {
      // Pick image
      final XFile? image = await _picker.pickImage(
        source: source,
        maxWidth: 1024,
        maxHeight: 1024,
        imageQuality: 80,
      );

      if (image == null) return null;

      final file = File(image.path);
      final fileExt = image.path.split('.').last;
      final fileName =
          '${user.id}/${DateTime.now().millisecondsSinceEpoch}.$fileExt';
      final filePath = fileName;

      // Upload to 'avatars' bucket
      await _supabase.storage
          .from('avatars')
          .upload(
            filePath,
            file,
            fileOptions: const FileOptions(cacheControl: '3600', upsert: false),
          );

      // Get public URL
      final imageUrl = _supabase.storage.from('avatars').getPublicUrl(filePath);

      // Update profile with new avatar URL
      await _supabase
          .from('users')
          .update({
            'avatar_url': imageUrl,
            'updated_at': DateTime.now().toIso8601String(),
          })
          .eq('id', user.id);

      // Update auth metadata
      await _supabase.auth.updateUser(
        UserAttributes(data: {'avatar_url': imageUrl}),
      );

      return imageUrl;
    } catch (e) {
      throw Exception('Failed to upload avatar: $e');
    }
  }
}
