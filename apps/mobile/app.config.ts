import type { ExpoConfig } from 'expo/config';

const BRAND_COLOR = '#D44E15'; // GH #13: brand color finalized during Phase 2 (was #FF6B35 in plan); tokens + Android adaptive icon + notification accent now aligned.

// ponytail: GH #24 — Android Google Sign-In reads google-services.json via the
//        Expo config plugin. Default to a local file; EAS secrets override via
//        GOOGLE_SERVICES_JSON_FILE (build env). See .easignore for which files
//        stay out of the upload payload.
const GOOGLE_SERVICES_FILE = process.env.GOOGLE_SERVICES_JSON_FILE || './google-services.json';

const config: ExpoConfig = {
  name: 'Quart',
  slug: 'quart',
  version: '0.0.1',
  scheme: ['quart', 'https'],
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,
  owner: 'quart-app',
  runtimeVersion: { policy: 'appVersion' },
  // ponytail: GH #24 — Android google-services.json path. Plugin reads this
  //          when bundling the Android project. File is git-ignored via
  //          .gitignore; .easignore keeps it out of EAS upload.
  googleServicesFile: GOOGLE_SERVICES_FILE,
  updates: {
    fallbackToCacheTimeout: 0,
    url: 'https://u.expo.dev/00000000-0000-0000-0000-000000000000',
  },
  extra: {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    EXPO_PUBLIC_SENTRY_PII_SCRUBBING: process.env.EXPO_PUBLIC_SENTRY_PII_SCRUBBING ?? 'true',
    EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '',
    EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '',
    EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '',
    eas: { projectId: '00000000-0000-0000-0000-000000000000' },
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.quart.mobile',
    // ponytail: Universal Links for quart.app per spec §11.
    associatedDomains: ['applinks:quart.app'],
    infoPlist: {
      NSLocationWhenInUseUsageDescription: 'Used to mark issues on the map.',
      NSCameraUsageDescription: 'Used to take photos of issues you report.',
      NSPhotoLibraryUsageDescription: 'Used to attach existing photos to your reports.',
      NSPhotoLibraryAddUsageDescription: 'Used to save photos you take within Quart.',
      ITSAppUsesNonExemptEncryption: false,
      CFBundleAllowMixedLocalizations: true,
    },
    config: {
      usesNonExemptEncryption: false,
    },
  },
  android: {
    package: 'app.quart.mobile',
    // ponytail: spec §14 — Min API 24 (Android 7.0) covers >97% of devices.
    minSdkVersion: 24,
    // ponytail: intentFilters for https://quart.app deep links per spec §11.
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: [{ scheme: 'https', host: 'quart.app' }],
      },
    ],
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'CAMERA',
      'READ_MEDIA_IMAGES',
      'READ_EXTERNAL_STORAGE',
      'WRITE_EXTERNAL_STORAGE',
      'POST_NOTIFICATIONS',
      'VIBRATE',
    ],
    adaptiveIcon: {
      foregroundImage: './assets/images/icon.png',
      backgroundColor: BRAND_COLOR,
    },
  },
  notification: {
    icon: './assets/icons/notification.png',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    // ponytail: GH #24 — Google Sign-In plugin reads googleServicesFile above
    //          and wires the iOS URL scheme + Android Gradle plugin at prebuild.
    '@react-native-google-signin/google-signin',
    [
      'expo-camera',
      {
        cameraPermission: 'Allow Quart to access your camera to take photos of issues.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Allow access to attach photos to your reports.',
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Used to mark issues on the map.',
      },
    ],
    [
      'expo-notifications',
      {
        color: BRAND_COLOR,
      },
    ],
    'expo-localization',
  ],
  experiments: { typedRoutes: true },
};

export default config;