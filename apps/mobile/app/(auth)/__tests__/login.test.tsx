// app/(auth)/__tests__/login.test.tsx
// GH #46: login screen drives useLogin end-to-end against BA's
// /auth/sign-in/email. Mirrors signup.test.tsx — real react-query, only
// apiClient + saveTokens + register are stubbed. i18n is loaded so the
// screen sees the en keys.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';

import LoginScreen from '../login';

import i18n from '@/i18n';

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, push: jest.fn() };

const mockPost = jest.fn();
const mockSaveTokens = jest.fn();
const mockRegisterMutateAsync = jest.fn();
jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, apiClient: { post: (...args: unknown[]) => mockPost(...args) } };
});
jest.mock('@/lib/auth', () => ({
  saveTokens: (...args: unknown[]) => mockSaveTokens(...args),
  clearTokens: jest.fn(),
  loadTokens: jest.fn(),
}));
jest.mock('@/lib/device-fingerprint', () => ({ deviceFingerprint: jest.fn().mockResolvedValue('fp') }));
jest.mock('@/api/hooks/useRegisterDevice', () => ({
  useRegisterDevice: () => ({ mutateAsync: (...args: unknown[]) => mockRegisterMutateAsync(...args) }),
  NotificationsPermissionError: class extends Error {},
}));

jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  // ponytail: login.tsx renders <Link href="/signup">; stub it so the screen
  //        mounts without dragging the full expo-router runtime in.
  Link: ({ children }: { children: React.ReactNode }) => children,
  Stack: { Screen: () => null },
}));

// ponytail: native bridge modules aren't registered under jest-expo's
//        jsdom-less env — stub them so the screen's import-time calls
//        to configure() resolve without crashing the suite.
jest.mock('expo-apple-authentication', () => ({
  AppleAuthentication: { FULL_NAME: 0, EMAIL: 1 },
  AppleAuthenticationScope: { FULL_NAME: 'fullName', EMAIL: 'email' },
  signInAsync: jest.fn(),
}));
jest.mock('@react-native-google-signin/google-signin', () => ({
  GoogleSignin: { configure: jest.fn(), hasPlayServices: jest.fn(), signIn: jest.fn() },
}));


function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function okSignInHeaders() {
  const h = new Headers();
  h.append('set-cookie', 'better-auth.session_token=ba-session-tok.abc; HttpOnly; Path=/');
  return h;
}

describe('LoginScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });
  beforeEach(() => {
    mockReplace.mockClear();
    mockPost.mockReset();
    mockSaveTokens.mockReset();
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
  });

  it('happy path: posts to /auth/sign-in/email, persists the BA session cookie, and routes to /', async () => {
    mockPost.mockResolvedValue({
      status: 200,
      data: {
        user: { id: 'u', email: 'a@b.com', name: 'A', emailVerified: false, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        redirect: false,
      },
      headers: okSignInHeaders(),
    });
    const { getByLabelText } = render(<LoginScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'a@b.com');
    fireEvent.changeText(getByLabelText('Password'), 'p4ssword!');
    fireEvent.press(getByLabelText('Sign in'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/sign-in/email',
        { email: 'a@b.com', password: 'p4ssword!' },
        { skipAuth: true },
      ),
    );
    await waitFor(() =>
      expect(mockSaveTokens).toHaveBeenCalledWith({ baSessionToken: 'ba-session-tok.abc' }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('401 unauthorized: error is surfaced via the generic error copy and tokens are NOT persisted', async () => {
    const { ApiError } = jest.requireMock('@/api/client');
    mockPost.mockRejectedValue(new ApiError(401, 'unauthorized', 'bad creds'));
    const { getByLabelText, getByText } = render(<LoginScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'a@b.com');
    fireEvent.changeText(getByLabelText('Password'), 'wrongpass1');
    fireEvent.press(getByLabelText('Sign in'));
    await waitFor(() => expect(getByText('Something went wrong.')).toBeTruthy());
    expect(mockSaveTokens).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalledWith('/');
  });

  it('client-side: short password blocks the POST and surfaces a zod error', async () => {
    const { getByLabelText, getByText } = render(<LoginScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'a@b.com');
    fireEvent.changeText(getByLabelText('Password'), 'short');
    fireEvent.press(getByLabelText('Sign in'));
    await waitFor(() => expect(getByText(/at least 8|min/i)).toBeTruthy());
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});