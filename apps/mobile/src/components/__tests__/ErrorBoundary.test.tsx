// src/components/__tests__/ErrorBoundary.test.tsx
import React from 'react';
import { Text } from 'react-native';
import { render, fireEvent } from '@testing-library/react-native';
import i18n from '@/i18n';

const mockCaptureException = jest.fn();

jest.mock('@/observability/sentry', () => ({
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import { ErrorBoundary } from '@/components/ErrorBoundary';

function Bomb({ throwOn }: { throwOn?: boolean }): React.ReactElement {
  if (throwOn) throw new Error('boom');
  return <Text>child ok</Text>;
}

describe('ErrorBoundary', () => {
  afterAll(async () => {
    await i18n.changeLanguage('it');
  });

  beforeEach(() => {
    mockCaptureException.mockReset();
  });

  it('renders fallback when a child throws', async () => {
    await i18n.changeLanguage('en');
    // Suppress the deliberate React error noise from `throw new Error()`.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { getByText } = render(
      <ErrorBoundary>
        <Bomb throwOn />
      </ErrorBoundary>,
    );
    expect(getByText('Something went wrong.')).toBeTruthy();
    expect(getByText('Retry')).toBeTruthy();
    errSpy.mockRestore();
  });

  it('calls captureException on componentDidCatch', async () => {
    await i18n.changeLanguage('en');
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb throwOn />
      </ErrorBoundary>,
    );
    expect(mockCaptureException).toHaveBeenCalledTimes(1);
    const [err] = mockCaptureException.mock.calls[0];
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('boom');
    errSpy.mockRestore();
  });

  it('retries and re-renders children after pressing the button', async () => {
    await i18n.changeLanguage('en');
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    // Class component (not function) — strict mode does not double-invoke render
    // on class components, so a thrown render reliably reaches the boundary.
    let throwOn = true;
    class Thrower extends React.Component<{ throwOn: boolean }, { n: number }> {
      override state = { n: 0 };
      override render(): React.ReactNode {
        if (this.props.throwOn) throw new Error('class-throw');
        return <Text>recovered</Text>;
      }
    }
    const { getByText, queryByText, rerender } = render(
      <ErrorBoundary>
        <Thrower throwOn={throwOn} />
      </ErrorBoundary>,
    );
    expect(getByText('Retry')).toBeTruthy();
    throwOn = false;
    rerender(
      <ErrorBoundary>
        <Thrower throwOn={throwOn} />
      </ErrorBoundary>,
    );
    fireEvent.press(getByText('Retry'));
    expect(queryByText('Something went wrong.')).toBeNull();
    expect(queryByText('recovered')).toBeTruthy();
    errSpy.mockRestore();
  });

  it('renders children normally when nothing throws', async () => {
    await i18n.changeLanguage('en');
    const { getByText } = render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(getByText('child ok')).toBeTruthy();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});