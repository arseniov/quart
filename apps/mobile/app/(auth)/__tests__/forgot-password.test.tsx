// app/(auth)/__tests__/forgot-password.test.tsx
// GH #29 — happy path + 422 invalid email + network error.
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockRouter = { replace: mockReplace, push: mockPush };
jest.mock('expo-router', () => ({
  useRouter: () => mockRouter,
  Stack: { Screen: () => null },
}));

// ponytail: real react-query drives the mutation state; only apiClient is stubbed
//        (matches useUser.test.ts shape).
const mockPost = jest.fn();
jest.mock('@/api/client', () => {
  const actual = jest.requireActual('@/api/client');
  return { ...actual, apiClient: { post: (...args: unknown[]) => mockPost(...args) } };
});

import { ApiError } from '@/api/client';
import ForgotPasswordScreen from '../forgot-password';

function makeWrapper() {
  const qc = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('ForgotPasswordScreen', () => {
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

  it('renders the title and the email input', () => {
    mockPost.mockResolvedValue({ status: 200, data: {} });
    const { getByText, getByLabelText } = render(<ForgotPasswordScreen />, { wrapper: makeWrapper() });
    expect(getByText('Reset password')).toBeTruthy();
    expect(getByLabelText('Email')).toBeTruthy();
  });

  it('happy path: submits a valid email and shows the no-enumeration success copy', async () => {
    mockPost.mockResolvedValue({ status: 200, data: {} });
    const { getByLabelText, getByText } = render(<ForgotPasswordScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'a@b.com');
    fireEvent.press(getByText('Send link'));
    await waitFor(() => expect(mockPost).toHaveBeenCalledWith(
      '/auth/password/reset-request',
      { email: 'a@b.com' },
      { skipAuth: true },
    ));
    expect(getByText("If that email is registered, you'll get a reset link.")).toBeTruthy();
  });

  it('422 invalid email: backend rejection is surfaced via the inline error', async () => {
    mockPost.mockRejectedValue(new ApiError(422, 'invalid_email', 'bad'));
    const { getByLabelText, getByText } = render(<ForgotPasswordScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'a@b.com');
    fireEvent.press(getByText('Send link'));
    await waitFor(() => expect(getByText('Enter a valid email address.')).toBeTruthy());
  });

  it('network error: a generic throw surfaces the network copy', async () => {
    mockPost.mockRejectedValue(new Error('boom'));
    const { getByLabelText, getByText } = render(<ForgotPasswordScreen />, { wrapper: makeWrapper() });
    fireEvent.changeText(getByLabelText('Email'), 'a@b.com');
    fireEvent.press(getByText('Send link'));
    await waitFor(() => expect(getByText("Couldn't reach the server. Try again.")).toBeTruthy());
  });
});
