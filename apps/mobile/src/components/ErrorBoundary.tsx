// src/components/ErrorBoundary.tsx
import React from 'react';
import { View, Text, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import * as Sentry from '@/observability/sentry';

interface State { error: Error | null }

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo) {
    // @ts-expect-error - Sentry stub doesn't export Sentry; optional chain no-ops until migration lands
    Sentry.Sentry?.captureException?.(error, { extra: info as unknown as Record<string, unknown> });
  }

  reset = () => this.setState({ error: null });

  override render() {
    if (this.state.error) {
      return <ErrorFallback onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function ErrorFallback({ onReset }: { onReset: () => void }) {
  const { t } = useTranslation();
  return (
    <View className="flex-1 bg-bg items-center justify-center p-6">
      <Text className="text-text-primary text-lg mb-4">{t('errors.generic')}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={onReset}
        className="bg-primary rounded-md px-4 py-2"
      >
        <Text className="text-text-onPrimary font-semibold">{t('common.retry')}</Text>
      </Pressable>
    </View>
  );
}