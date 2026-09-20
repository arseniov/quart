// app/(auth)/forgot-password.tsx
// GH #29 — email input → POST /auth/password/reset-request. Server returns the
// same shape regardless of whether the email is registered (no enumeration),
// so the success copy is unconditional. Client-side 30s throttle prevents
// rapid abuse of the endpoint.
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from 'react-i18next';
import { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { z } from 'zod';
import { usePasswordResetRequest } from '@/api/hooks/usePasswordResetRequest';

const THROTTLE_SECONDS = 30;
const EmailSchema = z.object({ email: z.string().email() });
type ForgotInput = z.infer<typeof EmailSchema>;

export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const reset = usePasswordResetRequest();
  const [sent, setSent] = useState(false);
  const [remaining, setRemaining] = useState(0);

  const { control, handleSubmit, formState: { errors } } = useForm<ForgotInput>({
    resolver: zodResolver(EmailSchema),
    defaultValues: { email: '' },
  });

  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(id);
  }, [remaining]);

  const throttled = remaining > 0;
  const pending = reset.isPending;

  const onSubmit = handleSubmit(async (data) => {
    if (pending || throttled) return;
    try {
      await reset.mutateAsync({ email: data.email });
      setSent(true);
      setRemaining(THROTTLE_SECONDS);
    } catch {
      // error surfaced via reset.isError below
    }
  });

  return (
    <View className="flex-1 bg-bg p-6 justify-center">
      <Text className="text-text-primary text-2xl mb-6">{t('auth.forgotPassword.title')}</Text>

      {sent ? (
        <Text
          accessibilityLiveRegion="polite"
          accessibilityRole="alert"
          className="text-text-primary mb-4"
        >
          {t('auth.forgotPassword.success')}
        </Text>
      ) : (
        <>
          <Controller
            control={control}
            name="email"
            render={({ field }) => (
              <TextInput
                value={field.value}
                onChangeText={field.onChange}
                onBlur={field.onBlur}
                accessibilityLabel={t('auth.forgotPassword.email')}
                placeholder={t('auth.forgotPassword.email')}
                autoCapitalize="none"
                keyboardType="email-address"
                editable={!pending}
                className="border border-border rounded-md p-3 mb-1 text-text-primary bg-surface"
              />
            )}
          />
          {errors.email && (
            <Text accessibilityLiveRegion="polite" className="text-error mb-3">
              {t('auth.forgotPassword.invalidEmail')}
            </Text>
          )}

          {reset.isError && !errors.email && (() => {
            const status = (reset.error as { status?: number } | null)?.status;
            return (
              <Text accessibilityLiveRegion="polite" className="text-error mb-3">
                {status === 422
                  ? t('auth.forgotPassword.invalidEmail')
                  : t('auth.forgotPassword.network')}
              </Text>
            );
          })()}
        </>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: pending || throttled }}
        onPress={onSubmit}
        disabled={pending || throttled}
        className="bg-primary rounded-md p-3 items-center"
      >
        {pending ? (
          <ActivityIndicator color="#fff" />
        ) : throttled ? (
          <Text className="text-text-onPrimary font-semibold">
            {t('auth.forgotPassword.throttled', { seconds: remaining })}
          </Text>
        ) : (
          <Text className="text-text-onPrimary font-semibold">{t('auth.forgotPassword.submit')}</Text>
        )}
      </Pressable>
    </View>
  );
}
