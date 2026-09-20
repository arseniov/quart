// app/(auth)/__tests__/signup.test.tsx
// GH #35: happy path + 401/422 surface. Mirrors the phone-otp test stub
// pattern: real react-query drives mutation state, only apiClient +
// saveTokens + register are mocked. i18n is loaded so the screen sees
// the en keys.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import React from 'react';
import { Alert } from 'react-native';

import SignupScreen from '../signup';

import { ApiError } from '@/api/client';
import i18n from '@/i18n';

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, push: jest.fn() };

// ponytail: real react-query drives the mutation state; only apiClient +
//        saveTokens + register are stubbed. Mirrors the login screen wiring
//        so the verify hook's side effects don't leak into the screen test.
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

describe('SignupScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });
  let alertSpy: jest.SpyInstance;
  beforeEach(() => {
    mockReplace.mockClear();
    mockPost.mockReset();
    mockSaveTokens.mockReset().mockResolvedValue(undefined);
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
    alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  });
  afterEach(() => {
    alertSpy.mockRestore();
  });

  it('renders the title and the email/password/displayName inputs', () => {
    mockPost.mockResolvedValue({ status: 200, data: { access_token: 'a', refresh_token: 'r' } });
    const { getByText, getByLabelText } = render(<SignupScreen />, { wrapper: makeWrapper() });
    expect(getByText('Create account')).toBeTruthy();
    expect(getByLabelText('Email')).toBeTruthy();
    expect(getByLabelText('Password')).toBeTruthy();
    expect(getByLabelText('Display name')).toBeTruthy();
  });

  it('happy path: posts the signup body, persists tokens, and routes to /', async () => {
    mockPost.mockResolvedValue({ status: 200, data: { access_token: 'a', refresh_token: 'r' } });
    const { getByLabelText, getByText } = render(<SignupScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'new@example.com');
    fireEvent.changeText(getByLabelText('Password'), 'p4ssword!');
    fireEvent.changeText(getByLabelText('Display name'), 'New');
    fireEvent.press(getByText('Sign up'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/sign-up',
        { email: 'new@example.com', password: 'p4ssword!', display_name: 'New', device_fingerprint: 'fp' },
        { skipAuth: true },
      ),
    );
    await waitFor(() =>
      expect(mockSaveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' }),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('happy path: NotificationsPermissionError from register is swallowed — user is still routed to /', async () => {
    const { NotificationsPermissionError } = jest.requireMock('@/api/hooks/useRegisterDevice');
    mockRegisterMutateAsync.mockReset().mockRejectedValueOnce(
      new NotificationsPermissionError('denied'),
    );
    mockPost.mockResolvedValue({ status: 200, data: { access_token: 'a', refresh_token: 'r' } });
    const { getByLabelText, getByText } = render(<SignupScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'new@example.com');
    fireEvent.changeText(getByLabelText('Password'), 'p4ssword!');
    fireEvent.changeText(getByLabelText('Display name'), 'New');
    fireEvent.press(getByText('Sign up'));
    await waitFor(() => expect(mockSaveTokens).toHaveBeenCalled());
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('422 validation: error is surfaced and tokens are NOT persisted', async () => {
    mockPost.mockRejectedValue(new ApiError(422, 'invalid_payload', 'bad shape'));
    const { getByLabelText, getByText } = render(<SignupScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'new@example.com');
    fireEvent.changeText(getByLabelText('Password'), 'p4ssword!');
    fireEvent.changeText(getByLabelText('Display name'), 'New');
    fireEvent.press(getByText('Sign up'));
    await waitFor(() => expect(getByText('Something went wrong.')).toBeTruthy());
    expect(mockSaveTokens).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalledWith('/');
  });

  it('401 unauthorized: error is surfaced via Alert and tokens are NOT persisted', async () => {
    mockPost.mockRejectedValue(new ApiError(401, 'unauthorized', 'Email already registered'));
    const { getByLabelText, getByText } = render(<SignupScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'taken@example.com');
    fireEvent.changeText(getByLabelText('Password'), 'p4ssword!');
    fireEvent.changeText(getByLabelText('Display name'), 'Taken');
    fireEvent.press(getByText('Sign up'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Email already registered'));
    expect(mockSaveTokens).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalledWith('/');
  });

  it('client-side: short password blocks the POST and surfaces a zod error', async () => {
    const { getByLabelText, getByText } = render(<SignupScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'new@example.com');
    fireEvent.changeText(getByLabelText('Password'), 'short');
    fireEvent.changeText(getByLabelText('Display name'), 'New');
    fireEvent.press(getByText('Sign up'));
    await waitFor(() => expect(getByText(/at least 8|min/i)).toBeTruthy());
    expect(mockPost).not.toHaveBeenCalled();
    expect(mockSaveTokens).not.toHaveBeenCalled();
  });
});