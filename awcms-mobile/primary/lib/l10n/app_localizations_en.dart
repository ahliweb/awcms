// ignore: unused_import
import 'package:intl/intl.dart' as intl;
import 'app_localizations.dart';

// ignore_for_file: type=lint

/// The translations for English (`en`).
class AppLocalizationsEn extends AppLocalizations {
  AppLocalizationsEn([String locale = 'en']) : super(locale);

  @override
  String get appTitle => 'AWCMS Mobile';

  @override
  String get home => 'Home';

  @override
  String get dashboard => 'Dashboard';

  @override
  String get profile => 'Profile';

  @override
  String get settings => 'Settings';

  @override
  String get notifications => 'Notifications';

  @override
  String get login => 'Login';

  @override
  String get logout => 'Logout';

  @override
  String get register => 'Register';

  @override
  String get email => 'Email';

  @override
  String get password => 'Password';

  @override
  String get forgotPassword => 'Forgot Password?';

  @override
  String get loginButton => 'Sign In';

  @override
  String get registerButton => 'Create Account';

  @override
  String get loading => 'Loading...';

  @override
  String get error => 'Error';

  @override
  String get success => 'Success';

  @override
  String get retry => 'Retry';

  @override
  String get cancel => 'Cancel';

  @override
  String get save => 'Save';

  @override
  String get delete => 'Delete';

  @override
  String get edit => 'Edit';

  @override
  String get confirm => 'Confirm';

  @override
  String get back => 'Back';

  @override
  String get next => 'Next';

  @override
  String get done => 'Done';

  @override
  String get close => 'Close';

  @override
  String get noData => 'No data available';

  @override
  String get noConnection => 'No internet connection';

  @override
  String get connectionRestored => 'Connection restored';

  @override
  String get offlineMode => 'Offline Mode';

  @override
  String get syncingData => 'Syncing data...';

  @override
  String get syncComplete => 'Sync complete';

  @override
  String get blogs => 'Blogs';

  @override
  String get readMore => 'Read More';

  @override
  String get postedOn => 'Posted on';

  @override
  String get byAuthor => 'by';

  @override
  String get portfolio => 'Portfolio';

  @override
  String get viewProject => 'View Project';

  @override
  String get contact => 'Contact';

  @override
  String get sendMessage => 'Send Message';

  @override
  String get messageSent => 'Message sent successfully';

  @override
  String get language => 'Language';

  @override
  String get selectLanguage => 'Select Language';

  @override
  String get english => 'English';

  @override
  String get indonesian => 'Bahasa Indonesia';

  @override
  String get darkMode => 'Dark Mode';

  @override
  String get lightMode => 'Light Mode';

  @override
  String get systemTheme => 'System Theme';

  @override
  String get aboutApp => 'About App';

  @override
  String get version => 'Version';

  @override
  String get termsOfService => 'Terms of Service';

  @override
  String get privacyPolicy => 'Privacy Policy';

  @override
  String get location => 'Location';

  @override
  String get gettingLocation => 'Getting your location...';

  @override
  String get locationPermissionDenied => 'Location permission denied';

  @override
  String get camera => 'Camera';

  @override
  String get gallery => 'Gallery';

  @override
  String get uploadImage => 'Upload Image';

  @override
  String get pushNotifications => 'Push Notifications';

  @override
  String get enableNotifications => 'Enable Notifications';

  @override
  String get notificationSettings => 'Notification Settings';

  @override
  String get welcome => 'Welcome!';

  @override
  String get menu => 'Menu';

  @override
  String get seeAllBlogs => 'See all blogs';

  @override
  String get viewPhotosVideos => 'Photos & Videos';

  @override
  String get products => 'Products';

  @override
  String get productCatalog => 'Product Catalog';

  @override
  String get appInfo => 'App Info';

  @override
  String get comingSoon => 'Coming soon!';

  @override
  String get copyright => '© 2024 AhliWeb.com\nAll rights reserved.';

  @override
  String welcomeUser(Object name) {
    return 'Welcome, $name!';
  }

  @override
  String itemsPendingSync(Object count) {
    return '$count items pending sync';
  }

  @override
  String get dataSynced => 'Data synced';

  @override
  String lastSync(Object time) {
    return 'Last sync: $time';
  }

  @override
  String get justNow => 'Just now';

  @override
  String minAgo(Object count) {
    return '$count min ago';
  }

  @override
  String hoursAgo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count hours ago',
      one: '1 hour ago',
    );
    return '$_temp0';
  }

  @override
  String daysAgo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count days ago',
      one: '1 day ago',
    );
    return '$_temp0';
  }

  @override
  String get insecureDevice => 'Insecure Device';

  @override
  String get insecureDeviceMessage =>
      'Login cannot be performed on a rooted or jailbroken device for security reasons.';

  @override
  String get understand => 'Understand';

  @override
  String get loginSubtitle => 'Sign in with your AWCMS account';

  @override
  String get emailRequired => 'Email is required';

  @override
  String get emailInvalid => 'Invalid email';

  @override
  String get passwordRequired => 'Password is required';

  @override
  String get passwordMinLength => 'Password must be at least 6 characters';

  @override
  String get backToHome => 'Back to Home';

  @override
  String get contactAdminToRegister => 'Contact admin to create an account';

  @override
  String get noBlogs => 'No blogs yet';

  @override
  String get pullToRefresh => 'Pull to refresh to update';

  @override
  String get failedToLoadBlogs => 'Failed to load blogs';

  @override
  String get blogNotFound => 'Blog not found';

  @override
  String get syncing => 'Syncing...';

  @override
  String get markAll => 'Mark All';

  @override
  String get emptyNotifications => 'No notifications';

  @override
  String get emptyNotificationsDesc => 'Notifications will appear here';

  @override
  String minutesAgo(int count) {
    String _temp0 = intl.Intl.pluralLogic(
      count,
      locale: localeName,
      other: '$count minutes ago',
      one: '1 minute ago',
    );
    return '$_temp0';
  }

  @override
  String get accessRestricted => 'Access Restricted';

  @override
  String get webDashboardOnly =>
      'This feature is only available on the web dashboard for security and governance. Please use web admin to perform this action.';

  @override
  String get understood => 'Understood';

  @override
  String get roleOwner => 'OWNER';

  @override
  String get roleSuperAdmin => 'SUPER ADMIN';

  @override
  String get roleAdmin => 'ADMIN';

  @override
  String get roleEditor => 'EDITOR';

  @override
  String get roleAuthor => 'AUTHOR';

  @override
  String get roleMember => 'MEMBER';

  @override
  String get roleSubscriber => 'SUBSCRIBER';

  @override
  String get rolePublic => 'PUBLIC';

  @override
  String get featureImageUpload => 'Image Upload';

  @override
  String get featureFileDownload => 'File Download';

  @override
  String get featurePdfView => 'PDF View';

  @override
  String get featureMediaGallery => 'Media Gallery';

  @override
  String get featureStorageAccess => 'Storage Access';

  @override
  String featureNotAvailableOffline(String feature) {
    return '$feature is not available offline';
  }

  @override
  String get connectToInternet => 'Connect to internet to access this feature.';

  @override
  String get locationActive => 'GPS Active';

  @override
  String get locationFake => 'Fake GPS!';

  @override
  String get locationDisabled => 'GPS Disabled';

  @override
  String get gps => 'GPS';

  @override
  String get fakeLocationDetected => 'Fake Location Detected';

  @override
  String get fakeLocationMessage => 'Fake GPS application detected';

  @override
  String get locationPermissionRequired => 'Location Permission Required';

  @override
  String get locationPermissionExplanation =>
      'App requires location access for this feature. Please enable location in settings.';

  @override
  String get openSettings => 'Open Settings';

  @override
  String get locationGPS => 'GPS Location';

  @override
  String get invalidLocation => 'Invalid Location';

  @override
  String get locationObtained => 'Location obtained successfully';

  @override
  String get locationError => 'Failed to get location';

  @override
  String get locationServiceDisabled => 'GPS service is disabled';

  @override
  String get noLocation => 'No location yet';

  @override
  String get latitude => 'Latitude';

  @override
  String get longitude => 'Longitude';

  @override
  String get accuracy => 'Accuracy';

  @override
  String get meters => 'meters';

  @override
  String get checkingDeviceSecurity => 'Checking device security...';

  @override
  String get deviceRootedMessage =>
      'App cannot run on rooted or jailbroken devices.';

  @override
  String get deviceModifiedMessage =>
      'For your data security, this app does not support modified devices.';

  @override
  String get checkConnection => 'Check your connection and try again';

  @override
  String get serverError => 'Server error occurred';

  @override
  String get tryAgainLater => 'Please try again later';
}
