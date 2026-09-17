import type { ExpoConfig } from 'expo/config';

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
  updates: {
    fallbackToCacheTimeout: 0,
    url: 'https://u.expo.dev/00000000-0000-0000-0000-000000000000',
  },
  extra: {
    EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
    EXPO_PUBLIC_SENTRY_DSN: process.env.EXPO_PUBLIC_SENTRY_DSN ?? '',
    EXPO_PUBLIC_SENTRY_PII_SCRUBBING: process.env.EXPO_PUBLIC_SENTRY_PII_SCRUBBING ?? 'true',
    eas: { projectId: '00000000-0000-0000-0000-000000000000' },
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'app.quart.mobile',
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
    googleServicesFile: './google-services.json',
    adaptiveIcon: {
      foregroundImage: './assets/images/icon.png',
      backgroundColor: '#FF6B35',
    },
  },
  notification: {
    icon: './assets/icons/notification.png',
    color: '#FF6B35',
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
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
        color: '#FF6B35',
      },
    ],
    'expo-localization',
  ],
  experiments: { typedRoutes: true },
};

export default config;