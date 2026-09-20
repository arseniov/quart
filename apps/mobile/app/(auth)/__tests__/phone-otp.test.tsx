// app/(auth)/__tests__/phone-otp.test.tsx
// GH #29 — happy path + 422 invalid code + 401 session-expired + offline UX +
// missing-phone redirect + verified-redirect-after-2s + array-phone redirect.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, push: jest.fn() };

// ponytail: real react-query drives the mutation state; only apiClient is
//        stubbed (matches useUser.test.ts shape). Phone-otp no longer
//        persists anything, so device/register mocks are not stubbed here.
const mockPost = jest.fn();
jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, apiClient: { post: (...args: unknown[]) => mockPost(...args) } };
});

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

  it('happy path: types a 6-digit code, submits, shows verified copy, redirects to /login', async () => {
    jest.useFakeTimers();
    try {
      mockPost.mockImplementation(async (path: string) => {
        if (path === '/auth/phone/request') return { status: 200, data: { ok: true } };
        if (path === '/auth/phone/verify') return { status: 200, data: { verified: true } };
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
          { phoneNumber: '+15551234567', code: '123456' },
          { skipAuth: true },
        ),
      );
      await waitFor(() =>
        expect(getByText('Phone verified — please sign in.')).toBeTruthy(),
      );
      // ponytail: 2s grace window then redirect to /login with the phone as a
      //        query param so the login screen can pick it up later.
      act(() => { jest.advanceTimersByTime(2000); });
      expect(mockReplace).toHaveBeenCalledWith('/login?phone=%2B15551234567');
    } finally {
      jest.useRealTimers();
    }
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
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('401 session-expired surfaces the inline error and does not navigate', async () => {
    mockPost.mockImplementation(async (path: string) => {
      if (path === '/auth/phone/request') return { status: 200, data: { ok: true } };
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
      if (path === '/auth/phone/request') return { status: 200, data: { ok: true } };
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