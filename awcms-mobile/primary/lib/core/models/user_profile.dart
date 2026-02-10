/// AWCMS Mobile - User Profile Model
///
/// Model untuk data profil pengguna yang diambil dari tabel 'users'.
library;

class UserProfile {
  final String id;
  final String? fullName;
  final String? avatarUrl;
  final String? email;
  final String? role;

  const UserProfile({
    required this.id,
    this.fullName,
    this.avatarUrl,
    this.email,
    this.role,
  });

  factory UserProfile.fromJson(Map<String, dynamic> json) {
    return UserProfile(
      id: json['id'] as String,
      fullName: json['full_name'] as String?,
      avatarUrl: json['avatar_url'] as String?,
      email: json['email'] as String?,
      // Note: Role fetching strategy might need adjustment depending on
      // whether we join with a roles table or just read a field.
      // Based on React app: role comes from a joined 'roles' table or 'role' field.
      // We'll keep it simple for now and map what we can.
      role: json['role'] as String?,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'full_name': fullName,
      'avatar_url': avatarUrl,
      'email': email,
      'role': role,
    };
  }

  UserProfile copyWith({
    String? fullName,
    String? avatarUrl,
    String? email,
    String? role,
  }) {
    return UserProfile(
      id: id,
      fullName: fullName ?? this.fullName,
      avatarUrl: avatarUrl ?? this.avatarUrl,
      email: email ?? this.email,
      role: role ?? this.role,
    );
  }
}
