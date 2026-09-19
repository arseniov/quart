// src/lib/env.ts
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra as
  | {
      EXPO_PUBLIC_API_URL?: string;
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID?: string;
      EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID?: string;
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?: string;
      eas?: { projectId?: string };
    }
  | undefined;

export const BASE_URL: string =
  extra?.EXPO_PUBLIC_API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const EAS_PROJECT_ID: string | undefined = extra?.eas?.projectId;

export const GOOGLE_IOS_CLIENT_ID: string =
  extra?.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? '';

export const GOOGLE_ANDROID_CLIENT_ID: string =
  extra?.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID ?? '';

export const GOOGLE_WEB_CLIENT_ID: string =
  extra?.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '';