// src/lib/env.ts
import Constants from 'expo-constants';

const extra = Constants.expoConfig?.extra as { EXPO_PUBLIC_API_URL?: string } | undefined;

export const BASE_URL: string =
  extra?.EXPO_PUBLIC_API_URL ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';