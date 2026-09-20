// app/(auth)/__tests__/phone-otp.test.tsx
// GH #29 + GH #30: happy path (verify issues session → routes to '/') +
// 422 invalid code + 401 session-expired + offline UX + missing-phone
// redirect + array-phone redirect.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
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

// ponytail: default fixture returns a valid phone param. Individual tests
//        override `useLocalSearchParams` via the module mock when they need
//        a missing/array-shaped param.
const mockUseLocalSearchParams = jest.fn<{ phone?: string | string[] }, []>(
  () => ({ phone: '+15551234567' }),
);
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  useLocalSearchParams: () => mockUseLocalSearchParams(),
  Stack: { Screen: () => null },
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
    mockSaveTokens.mockReset().mockResolvedValue(undefined);
    mockRegisterMutateAsync.mockReset().mockResolvedValue(undefined);
    mockUseLocalSearchParams.mockReset();
    mockUseLocalSearchParams.mockReturnValue({ phone: '+15551234567' });
  });

  it('renders the title and triggers POST /auth/phone/request on mount', async () => {
    mockPost.mockResolvedValue({ status: 200, data: { ok: true } });
    const { getByText } = render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    expect(getByText('Verify phone')).toBeTruthy();
    await waitFor(() =>
      expect(mockPost).toHaveBeenCalledWith(
        '/auth/phone/request',
        { phoneNumber: '+15551234567' },
        { skipAuth: true },
      ),
    );
  });

  it('happy path: types a 6-digit code, submits, persists tokens, routes to /', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/auth/phone/request') return { status: 200, data: { ok: true } };
      if (path === '/auth/phone/verify') {
        return {
          status: 200,
          data: {
            access_token: 'a',
            refresh_token: 'r',
            refresh_expires_at: '2030-01-01T00:00:00.000Z',
            user: { id: 'u', handle: 'h', display_name: 'd' },
          },
        };
      }
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
        { phoneNumber: '+15551234567', code: '123456', device_fingerprint: 'fp' },
        { skipAuth: true },
      ),
    );
    await waitFor(() => expect(mockSaveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('happy path: NotificationsPermissionError from register is swallowed — user is still routed to /', async () => {
    const { NotificationsPermissionError } = jest.requireMock('@/api/hooks/useRegisterDevice');
    mockRegisterMutateAsync.mockReset().mockRejectedValueOnce(
      new NotificationsPermissionError('denied'),
    );
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/auth/phone/request') return { status: 200, data: { ok: true } };
      if (path === '/auth/phone/verify') {
        return {
          status: 200,
          data: {
            access_token: 'a',
            refresh_token: 'r',
            refresh_expires_at: '2030-01-01T00:00:00.000Z',
            user: { id: 'u', handle: 'h', display_name: 'd' },
          },
        };
      }
      throw new Error(`unexpected path ${path}`);
    });
    const { getByLabelText, getByText } = render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    for (let i = 1; i <= 6; i++) {
      typeCell(getByLabelText, `Verification code digit ${i}`, String(i));
    }
    fireEvent.press(getByText('Verify'));
    await waitFor(() => expect(mockSaveTokens).toHaveBeenCalledWith({ accessToken: 'a', refreshToken: 'r' }));
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/'));
  });

  it('422 invalid code surfaces the inline error and does not navigate', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/auth/phone/request') return { status: 200, data: { ok: true } };
      throw new ApiError(422, 'invalid_code', 'bad otp');
    });
    const { getByLabelText, getByText } = render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    for (let i = 1; i <= 6; i++) {
      typeCell(getByLabelText, `Verification code digit ${i}`, '0');
    }
    fireEvent.press(getByText('Verify'));
    await waitFor(() => expect(getByText("That code didn't work. Try again.")).toBeTruthy());
    expect(mockSaveTokens).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalledWith('/');
  });

  it('401 unknown-user surfaces the inline error and does not navigate', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/auth/phone/request') return { status: 200, data: { ok: true } };
      throw new ApiError(401, 'unknown_user', 'no account');
    });
    const { getByLabelText, getByText } = render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    for (let i = 1; i <= 6; i++) {
      typeCell(getByLabelText, `Verification code digit ${i}`, '1');
    }
    fireEvent.press(getByText('Verify'));
    await waitFor(() => expect(getByText('Session expired. Restart and try again.')).toBeTruthy());
    expect(mockSaveTokens).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalledWith('/');
  });

  it('offline behaviour: a generic network error surfaces "Something went wrong." copy', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/auth/phone/request') return { status: 200, data: { ok: true } };
      throw new ApiError(0, 'network', 'Network request failed');
    });
    const { getByLabelText, getByText } = render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    for (let i = 1; i <= 6; i++) {
      typeCell(getByLabelText, `Verification code digit ${i}`, '2');
    }
    fireEvent.press(getByText('Verify'));
    await waitFor(() => expect(getByText('Something went wrong.')).toBeTruthy());
    expect(mockReplace).not.toHaveBeenCalledWith('/');
  });

  it('missing phone param redirects to /login', async () => {
    mockUseLocalSearchParams.mockReturnValue({});
    mockPost.mockResolvedValue({ status: 200, data: { ok: true } });
    render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('array-shaped phone param redirects to /login', async () => {
    mockUseLocalSearchParams.mockReturnValue({ phone: ['+15551234567', '+15559876543'] });
    mockPost.mockResolvedValue({ status: 200, data: { ok: true } });
    render(<PhoneOtpScreen />, { wrapper: makeWrapper() });
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/login'));
    expect(mockPost).not.toHaveBeenCalled();
  });
});
