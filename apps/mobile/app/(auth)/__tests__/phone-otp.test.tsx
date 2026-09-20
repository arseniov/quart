// app/(auth)/__tests__/phone-otp.test.tsx
// GH #29 — happy path + 422 invalid code + 401 session-expired + offline UX.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, push: jest.fn() };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => ({ phone: '+15551234567' }),
  Stack: { Screen: () => null },
}));

// ponytail: real react-query drives the mutation state; only apiClient + the
//        post-auth side effects are stubbed (matches useUser.test.ts shape).
const mockPost = jest.fn();
jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, apiClient: { post: (...args: unknown[]) => mockPost(...args) } };
});
jest.mock('@/lib/auth', () => ({
  saveTokens: jest.fn().mockResolvedValue(undefined),
  clearTokens: jest.fn(),
  loadTokens: jest.fn(),
}));
jest.mock('@/lib/device-fingerprint', () => ({
  deviceFingerprint: jest.fn().mockResolvedValue('fp'),
}));
jest.mock('@/api/hooks/useRegisterDevice', () => ({
  useRegisterDevice: () => ({
    mutateAsync: jest.fn().mockResolvedValue(undefined),
  }),
  NotificationsPermissionError: class extends Error {},
}));

import { ApiError } from '@/api/client';
import PhoneOtpScreen from '../phone-otp';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

function typeCell(getByLabelText: (l: string) => React.ElementType, label: string, ch: string) {
  fireEvent.changeText(getByLabelText(label), ch);
}

describe('PhoneOtpScreen', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en');
  });
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });
  beforeEach(() => {
    mockReplace.mockClear();
    mockPost.mockReset();
  });

  it('renders the title and triggers POST /auth/phone/start on mount', async () => {
    mockPost.mockResolvedValue({ status: 200, data: {} });
    const { getByText } = render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    expect(getByText('Verify phone')).toBeTruthy();
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/phone/start',
        { phone: '+15551234567' },
        { skipAuth: true },
      ),
    );
  });

  it('happy path: types a 6-digit code, submits, saves tokens, replaces /', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/auth/phone/start') return { status: 200, data: {} };
      if (path === '/auth/phone/verify') return { status: 200, data: { access_token: 'a', refresh_token: 'r' } };
      throw new Error(`unexpected path ${path}`);
    });
    const { getByLabelText, getByText } = render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    for (let i = 1; i <= 6; i++) {
      typeCell(getByLabelText, `Verification code digit ${i}`, String(i));
    }
    fireEvent.press(getByText('Verify'));
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/phone/verify',
        { phone: '+15551234567', code: '123456' },
        { skipAuth: true },
      ),
    );
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('422 invalid code surfaces the inline error and does not navigate', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/auth/phone/start') return { status: 200, data: {} };
      throw new ApiError(422, 'invalid_code', 'bad otp');
    });
    const { getByLabelText, getByText } = render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    for (let i = 1; i <= 6; i++) {
      typeCell(getByLabelText, `Verification code digit ${i}`, '0');
    }
    fireEvent.press(getByText('Verify'));
    await waitFor(() => expect(getByText("That code didn't work. Try again.")).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('401 session-expired surfaces the inline error and does not navigate', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/auth/phone/start') return { status: 200, data: {} };
      throw new ApiError(401, 'unauthenticated', 'expired');
    });
    const { getByLabelText, getByText } = render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    for (let i = 1; i <= 6; i++) {
      typeCell(getByLabelText, `Verification code digit ${i}`, '1');
    }
    fireEvent.press(getByText('Verify'));
    await waitFor(() => expect(getByText('Session expired. Restart and try again.')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('offline behaviour: a generic network error surfaces "Something went wrong." copy', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/auth/phone/start') return { status: 200, data: {} };
      throw new ApiError(0, 'network', 'Network request failed');
    });
    const { getByLabelText, getByText } = render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    for (let i = 1; i <= 6; i++) {
      typeCell(getByLabelText, `Verification code digit ${i}`, '2');
    }
    fireEvent.press(getByText('Verify'));
    await waitFor(() => expect(getByText('Something went wrong.')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
