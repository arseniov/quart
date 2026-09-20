// app/(auth)/phone-otp.tsx
// GH #29 — wires the phone-otp screen: auto-advance OTP cells with paste,
// POST /auth/phone/start on mount, POST /auth/phone/verify on submit,
// then saveTokens + best-effort device-register + replace('/').
import { useRouter, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { usePhoneStart } from '@/api/hooks/usePhoneStart';
import { usePhoneVerify } from '@/api/hooks/usePhoneVerify';

// ponytail: 6 separate TextInput refs for auto-advance; one string state keeps
//        paste + auto-advance in sync without 6-field form schemas or stale closures.
const OTP_LENGTH = 6;

export default function PhoneOtpScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ phone?: string }>();
  const phone = typeof params.phone === 'string' ? params.phone : '';
  const cellRefs = useRef<Array<TextInput | null>>([]);
  const [code, setCode] = useState('');
  const verify = usePhoneVerify();
  const { mutate: sendStart } = usePhoneStart();

  // ponytail: fire-and-forget on mount when phone arrives; backend is idempotent on retry,
  //        so a remount after nav-back just re-arms the server timer. start error is not
  //        surfaced — verify is the user-visible failure path.
  useEffect(() => {
    if (!phone) return;
    sendStart({ phone });
  }, [phone, sendStart]);

  const focusCell = (i: number) => cellRefs.current[i]?.focus();

  const applyCode = (next: string) => {
    const stripped = next.replace(/\D/g, '').slice(0, OTP_LENGTH);
    setCode(stripped);
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

  const onSubmit = async () => {
    if (verify.isPending || !phone || code.length !== OTP_LENGTH) return;
    try {
      await verify.mutateAsync({ phone, code });
      router.replace('/');
    } catch {
      // error surfaced via verify.isError below
    }
  };

  const pending = verify.isPending;
  const submitDisabled = pending || code.length !== OTP_LENGTH;

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

      {verifyError && (
        <Text accessibilityLiveRegion="polite" className="text-error mb-3">
          {verifyError}
        </Text>
      )}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: submitDisabled }}
        onPress={onSubmit}
        disabled={submitDisabled}
        className="bg-primary rounded-md p-3 items-center"
      >
        {pending ? <ActivityIndicator color="#fff" /> : (
          <Text className="text-text-onPrimary font-semibold">{t('auth.phoneOtp.submit')}</Text>
        )}
      </Pressable>
    </View>
  );
}
