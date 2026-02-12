/// AWCMS Mobile - Profile Screen
///
/// Halaman profil pengguna untuk melihat dan mengubah informasi profil.
library;

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:cached_network_image/cached_network_image.dart';
import '../../../core/services/profile_service.dart';
import 'package:image_picker/image_picker.dart';
import '../../../core/services/device_permission_service.dart';

import '../../../core/models/user_profile.dart';
import '../../../core/extensions/context_extensions.dart';
import '../../../core/providers/locale_provider.dart';
import '../../../core/providers/theme_provider.dart';

// Provider state for profile screen
final profileProvider = FutureProvider.autoDispose<UserProfile?>((ref) async {
  final service = ProfileService();
  return service.getProfile();
});

class ProfileScreen extends ConsumerStatefulWidget {
  const ProfileScreen({super.key});

  @override
  ConsumerState<ProfileScreen> createState() => _ProfileScreenState();
}

class _ProfileScreenState extends ConsumerState<ProfileScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _emailController = TextEditingController(); // Read-only for now
  final _passwordController = TextEditingController();
  final _confirmPasswordController = TextEditingController();

  bool _isLoading = false;
  bool _isPasswordVisible = false;

  final _profileService = ProfileService();

  @override
  void dispose() {
    _nameController.dispose();
    _emailController.dispose();
    _passwordController.dispose();
    _confirmPasswordController.dispose();
    super.dispose();
  }

  Future<void> _loadProfileData(UserProfile profile) async {
    _nameController.text = profile.fullName ?? '';
    _emailController.text = profile.email ?? '';
  }

  Future<void> _updateProfile() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    try {
      // Update Name if changed
      // Note: In real app, we should check against original value
      await _profileService.updateProfile(fullName: _nameController.text);

      // Update Password if provided
      if (_passwordController.text.isNotEmpty) {
        if (_passwordController.text != _confirmPasswordController.text) {
          throw Exception('Passwords do not match');
        }
        await _profileService.updatePassword(_passwordController.text);
      }

      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Profile updated successfully')),
        );
        // Refresh provider
        ref.invalidate(profileProvider);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Error: $e'), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  Future<void> _uploadAvatar() async {
    final ImageSource? source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (context) => SafeArea(
        child: Wrap(
          children: [
            ListTile(
              leading: const Icon(Icons.camera_alt),
              title: Text(context.l10n.camera),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library),
              title: Text(context.l10n.gallery),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );

    if (source == null) return;

    // Check permissions
    final permissionService = DevicePermissionService();
    bool hasPermission = false;

    if (source == ImageSource.camera) {
      hasPermission = await permissionService.requestCameraPermission();
    } else {
      hasPermission = await permissionService.requestPhotosPermission();
    }

    if (!hasPermission && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(context.l10n.permissionDenied),
          action: SnackBarAction(
            label: context.l10n.openSettings,
            onPressed: () => permissionService.openSettings(),
          ),
        ),
      );
      return;
    }

    try {
      setState(() => _isLoading = true);
      final newUrl = await _profileService.uploadAvatar(source: source);
      if (newUrl != null && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Avatar updated successfully')),
        );
        ref.invalidate(profileProvider);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error uploading avatar: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profileAsync = ref.watch(profileProvider);
    final currentLocale = ref.watch(localeProvider);
    final currentTheme = ref.watch(themeProvider);

    return Scaffold(
      appBar: AppBar(title: Text(context.l10n.profile)),
      body: profileAsync.when(
        data: (profile) {
          if (profile == null) {
            return const Center(child: Text('User not found'));
          }

          // Populate controllers if empty (first load)
          if (_nameController.text.isEmpty) _loadProfileData(profile);

          return SingleChildScrollView(
            padding: const EdgeInsets.all(16.0),
            child: Form(
              key: _formKey,
              child: Column(
                children: [
                  // Avatar Section
                  Center(
                    child: Stack(
                      children: [
                        CircleAvatar(
                          radius: 50,
                          backgroundColor: Theme.of(
                            context,
                          ).colorScheme.surfaceContainerHighest,
                          backgroundImage: profile.avatarUrl != null
                              ? CachedNetworkImageProvider(profile.avatarUrl!)
                              : null,
                          child: profile.avatarUrl == null
                              ? Icon(
                                  Icons.person,
                                  size: 50,
                                  color: Theme.of(
                                    context,
                                  ).colorScheme.onSurfaceVariant,
                                )
                              : null,
                        ),
                        Positioned(
                          bottom: 0,
                          right: 0,
                          child: GestureDetector(
                            onTap: _isLoading ? null : _uploadAvatar,
                            child: CircleAvatar(
                              radius: 18,
                              backgroundColor: Theme.of(
                                context,
                              ).colorScheme.primary,
                              child: const Icon(
                                Icons.camera_alt,
                                size: 18,
                                color: Colors.white,
                              ),
                            ),
                          ),
                        ),
                      ],
                    ),
                  ),

                  const SizedBox(height: 24),

                  // Personal Info Section
                  _buildSectionHeader(
                    context,
                    'Personal Information',
                    Icons.person,
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _nameController,
                    decoration: const InputDecoration(
                      labelText: 'Full Name',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.badge),
                    ),
                    validator: (value) => value == null || value.isEmpty
                        ? 'Please enter your name'
                        : null,
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _emailController,
                    readOnly:
                        true, // Email change usually requires re-verification flow
                    decoration: const InputDecoration(
                      labelText: 'Email',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.email),
                      helperText: 'Email cannot be changed directly.',
                    ),
                  ),

                  const SizedBox(height: 24),

                  // Language Section
                  _buildSectionHeader(
                    context,
                    context.l10n.language,
                    Icons.language,
                  ),
                  const SizedBox(height: 16),

                  DropdownButtonFormField<Locale>(
                    initialValue: currentLocale,
                    decoration: InputDecoration(
                      labelText:
                          context.l10n.selectLanguage, // "Select Language"
                      border: const OutlineInputBorder(),
                      prefixIcon: const Icon(Icons.translate),
                    ),
                    items: [
                      DropdownMenuItem(
                        value: const Locale('en'),
                        child: Text(context.l10n.english),
                      ),
                      DropdownMenuItem(
                        value: const Locale('id'),
                        child: Text(context.l10n.indonesian),
                      ),
                    ],
                    onChanged: (Locale? newLocale) {
                      if (newLocale != null) {
                        ref.read(localeProvider.notifier).setLocale(newLocale);
                      }
                    },
                  ),

                  const SizedBox(height: 24),

                  // Theme Section
                  // Theme Section
                  _buildSectionHeader(
                    context,
                    context.l10n.theme,
                    Icons.brightness_6,
                  ),
                  const SizedBox(height: 16),

                  DropdownButtonFormField<ThemeMode>(
                    key: ValueKey(currentTheme),
                    initialValue: currentTheme,
                    decoration: InputDecoration(
                      labelText: context.l10n.selectTheme,
                      border: const OutlineInputBorder(),
                      prefixIcon: const Icon(Icons.palette),
                    ),
                    items: [
                      DropdownMenuItem(
                        value: ThemeMode.system,
                        child: Text(context.l10n.systemTheme),
                      ),
                      DropdownMenuItem(
                        value: ThemeMode.light,
                        child: Text(context.l10n.lightMode),
                      ),
                      DropdownMenuItem(
                        value: ThemeMode.dark,
                        child: Text(context.l10n.darkMode),
                      ),
                    ],
                    onChanged: (ThemeMode? newMode) {
                      if (newMode != null) {
                        ref.read(themeProvider.notifier).setThemeMode(newMode);
                      }
                    },
                  ),

                  const SizedBox(height: 24),

                  // Security Section
                  _buildSectionHeader(context, 'Security', Icons.lock),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _passwordController,
                    obscureText: !_isPasswordVisible,
                    decoration: InputDecoration(
                      labelText: 'New Password',
                      border: const OutlineInputBorder(),
                      prefixIcon: const Icon(Icons.key),
                      suffixIcon: IconButton(
                        icon: Icon(
                          _isPasswordVisible
                              ? Icons.visibility
                              : Icons.visibility_off,
                        ),
                        onPressed: () => setState(
                          () => _isPasswordVisible = !_isPasswordVisible,
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _confirmPasswordController,
                    obscureText: !_isPasswordVisible,
                    decoration: const InputDecoration(
                      labelText: 'Confirm New Password',
                      border: OutlineInputBorder(),
                      prefixIcon: Icon(Icons.key),
                    ),
                    validator: (value) {
                      if (_passwordController.text.isNotEmpty &&
                          value != _passwordController.text) {
                        return 'Passwords do not match';
                      }
                      return null;
                    },
                  ),

                  const SizedBox(height: 32),

                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      onPressed: _isLoading ? null : _updateProfile,
                      child: _isLoading
                          ? const CircularProgressIndicator(color: Colors.white)
                          : const Text('Save Changes'),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (err, stack) => Center(child: Text('Error: $err')),
      ),
    );
  }

  Widget _buildSectionHeader(
    BuildContext context,
    String title,
    IconData icon,
  ) {
    return Row(
      children: [
        Icon(icon, color: Theme.of(context).colorScheme.primary),
        const SizedBox(width: 8),
        Text(
          title,
          style: Theme.of(
            context,
          ).textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
        ),
      ],
    );
  }
}
