// app/(auth)/phone-otp.tsx
// GH #29 + GH #30: wires the phone-otp screen end-to-end. On submit we
// POST /auth/phone/verify, which now issues a session in one round trip
// (the hook persists the tokens via saveTokens and registers the device,
// swallowing NotificationsPermissionError). On success the screen routes
// straight to `/` — the user is signed in.
//
// RHF + zod validate the OTP string; six visual cells are derived from
// the field value — auto-advance + paste keep working.
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { usePhoneStart } from '@/api/hooks/usePhoneStart';
import { usePhoneVerify } from '@/api/hooks/usePhoneVerify';

// ponytail: 6 separate TextInput refs for auto-advance; a single zod-validated
//        string field keeps paste + auto-advance in sync without a 6-field
//        form schema or stale closures.
const OTP_LENGTH = 6;
const OtpSchema = z.object({
  code: z.string().regex(/^\d{6}$/, 'invalid'),
});
type OtpInput = z.infer<typeof OtpSchema>;

export default function PhoneOtpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string | string[] }>();
  // ponytail: expo-router can hand back either a string, an array, or nothing
  //        for ?phone=… — defensive coercion covers all three shapes.
  const phone = typeof params.phone === 'string' ? params.phone : '';
  const cellRefs = useRef<Array<TextInput | null>>([]);
  const verify = usePhoneVerify();
  const { mutate: sendStart } = usePhoneStart();

  const { setValue, handleSubmit, watch, formState: { errors } } = useForm<OtpInput>({
    resolver: zodResolver(OtpSchema),
    defaultValues: { code: '' },
  });
  const code = watch('code') ?? '';

  // ponytail: bounce back to /login if the phone param is missing or duplicated
  //        (array) — both indicate the user landed here through a stale link.
  useEffect(() => {
    if (Array.isArray(params.phone) || !params.phone) {
      router.replace('/login');
    }
  }, [params.phone, router]);

  // ponytail: fire-and-forget on mount when phone arrives; backend is idempotent on retry,
  //        so a remount after nav-back just re-arms the server timer. start error is not
  //        surfaced — verify is the user-visible failure path.
  useEffect(() => {
    if (!phone) return;
    sendStart({ phoneNumber: phone });
  }, [phone, sendStart]);

  const focusCell = (i: number) => cellRefs.current[i]?.focus();

  const applyCode = (next: string) => {
    // ponytail: skip shouldValidate so the inline "invalid code" copy doesn't
    //        flash while the user is still typing digits 1..5. The server
    //        error surfaces naturally on submit.
    const stripped = next.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setValue('code', stripped);
    const last = stripped.length;
    if (last > 0) focusCell(Math.min(last, OTP_LENGTH - 1));
  };

  const onChangeDigit = (i: number, raw: string) => {
    if (raw.length > 1) {
      // ponytail: paste or autofill from SMS — replace from this index onward.
      applyCode(code.slice(0, i) + raw);
      return;
    }
    const ch = raw.replace(/\D/g, '').slice(-1);
    applyCode(code.slice(0, i) + ch + code.slice(i + 1));
  };

  const onKeyPress = (i: number, key: string) => {
    if (key === 'Backspace' && !code[i] && i > 0) {
      applyCode(code.slice(0, i - 1));
      focusCell(i - 1);
    }
  };

  const onSubmit = handleSubmit(async ({ code: submitted }) => {
    if (verify.isPending || !phone) return;
    try {
      await verify.mutateAsync({ phoneNumber: phone, code: submitted });
      router.replace('/');
    } catch {
      // error surfaced via verify.isError below
    }
  });

  const pending = verify.isPending;

  const verifyError = (() => {
    if (!verify.isError) return null;
    const e = verify.error as { status?: number } | null;
    const status = e?.status;
    if (status === 422) return t('auth.phoneOtp.invalidCode');
    if (status === 401) return t('auth.phoneOtp.sessionExpired');
    return t('errors.generic');
  })();

  return (
    <View className="flex-1 bg-bg p-6 justify-center">
      <Text className="text-text-primary text-2xl mb-2">{t('auth.phoneOtp.title')}</Text>
      {phone ? (
        <Text className="text-text-secondary mb-6">{t('auth.phoneOtp.sent', { number: phone })}</Text>
      ) : null}

      <View className="flex-row justify-between mb-4">
        {Array.from({ length: OTP_LENGTH }, (_, i) => (
          <TextInput
            key={i}
            ref={(el) => { cellRefs.current[i] = el; }}
            accessibilityRole="text"
            accessibilityLabel={t('auth.phoneOtp.inputLabel', { n: i + 1 })}
            value={code[i] ?? ''}
            onChangeText={(v) => onChangeDigit(i, v)}
            onKeyPress={(e) => onKeyPress(i, e.nativeEvent.key)}
            keyboardType="number-pad"
            maxLength={i === 0 ? OTP_LENGTH : 1}
            textContentType="oneTimeCode"
            autoComplete="one-time-code"
            className="border border-border rounded-md w-12 h-14 text-center text-2xl text-text-primary bg-surface"
          />
        ))}
      </View>

      {errors.code && (
        <Text accessibilityLiveRegion="polite" className="text-error mb-3">
          {t('auth.phoneOtp.invalidCode')}
        </Text>
      )}
      {verifyError && (
        <Text accessibilityLiveRegion="polite" className="text-error mb-3">
          {verifyError}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: pending }}
        onPress={onSubmit}
        disabled={pending}
        className="bg-primary rounded-md p-3 items-center"
      >
        {pending ? <ActivityIndicator color="#fff" /> : (
          <Text className="text-text-onPrimary font-semibold">{t('auth.phoneOtp.submit')}</Text>
        )}
      </Pressable>
    </View>
  );
}
