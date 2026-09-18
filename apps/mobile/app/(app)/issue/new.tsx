import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Alert } from 'react-native';
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  TextInput,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Image } from 'expo-image';
import { IssueCreateSchema } from '@quart/shared-types';
import { useDraftIssueStore } from '@/stores/draft-issue';
import { useCreateIssue } from '@/api/hooks/useIssue';
import { apiClient } from '@/api/client';
import { queryKeys } from '@/api/query-client';
import { ProgressBar } from '@/components/ProgressBar';
import { IssueCategoryPicker, type IssueCategory } from '@/components/issue/IssueCategoryPicker';

export default function NewIssueScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const step = useDraftIssueStore((s) => s.step);
  const category_id = useDraftIssueStore((s) => s.category_id);
  const photos = useDraftIssueStore((s) => s.photos);
  const location = useDraftIssueStore((s) => s.location);
  const description_i18n = useDraftIssueStore((s) => s.description_i18n);
  const setStep = useDraftIssueStore((s) => s.setStep);
  const setCategory = useDraftIssueStore((s) => s.setCategory);
  const setLocation = useDraftIssueStore((s) => s.setLocation);
  const setDescription = useDraftIssueStore((s) => s.setDescription);
  const addPhoto = useDraftIssueStore((s) => s.addPhoto);
  const reset = useDraftIssueStore((s) => s.reset);
  const create = useCreateIssue();
  const locale = (i18n.language as 'it' | 'en') ?? 'it';

  const { data: categories, isPending } = useQuery({
    queryKey: queryKeys.issueCategories(),
    queryFn: async () => {
      const r = await apiClient.get<{ categories: IssueCategory[] }>(`/issue-categories`);
      return r.data.categories;
    },
    staleTime: 60 * 60 * 1000,
  });

  const next = () => {
    if (step === 1 && !category_id) return;
    if (step === 3 && !location) return;
    setStep(Math.min(4, step + 1) as 1 | 2 | 3 | 4);
  };
  const back = () => setStep(Math.max(1, step - 1) as 1 | 2 | 3 | 4);

  const pickPhoto = async () => {
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!r.canceled && r.assets[0]) addPhoto(r.assets[0].uri);
  };

  const submit = async () => {
    if (!category_id || !location) return;
    try {
      const description = description_i18n[locale] ?? '';
      if (description.trim().length < 10) {
        Alert.alert(t('errors.generic'));
        return;
      }
      const parsed = IssueCreateSchema.parse({
        category_id,
        description,
        lat: location.lat,
        lng: location.lng,
        neighborhood_id: location.neighborhood_id ?? '00000000-0000-0000-0000-000000000000',
        photo_object_keys: [],
        address_hint: location.address,
      });
      await create.mutateAsync(parsed);
      reset();
      router.back();
    } catch {
      Alert.alert(t('errors.generic'));
    }
  };

  const nextDisabled = (step === 1 && !category_id) || (step === 3 && !location);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      <View className="flex-1 bg-bg">
        <Stack.Screen options={{ title: t('issue.new.title'), presentation: 'modal' }} />
        <ProgressBar current={step} total={4} />

        {step === 1 && (
          <View className="flex-1">
            <Text className="text-text-primary text-lg px-4 mb-2">{t('issue.new.stepCategory')}</Text>
            {isPending ? (
              <ActivityIndicator />
            ) : (
              <IssueCategoryPicker
                categories={categories ?? []}
                selected={category_id ?? null}
                onSelect={(id) => {
                  setCategory(id);
                  setStep(2);
                }}
              />
            )}
          </View>
        )}

        {step === 2 && (
          <View className="flex-1 p-4">
            <Text className="text-text-primary text-lg mb-3">{t('issue.new.stepPhotos')}</Text>
            <ScrollView horizontal className="mb-4">
              {photos.map((uri) => (
                <View key={uri} className="mr-2">
                  <Image source={{ uri }} style={{ width: 96, height: 96, borderRadius: 8 }} />
                </View>
              ))}
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              onPress={pickPhoto}
              className="border border-dashed border-border rounded-md p-6 items-center"
            >
              <Text className="text-primary">{t('issue.new.addPhoto')}</Text>
            </Pressable>
          </View>
        )}

        {step === 3 && (
          <View className="flex-1 p-4">
            <Text className="text-text-primary text-lg mb-3">{t('issue.new.stepLocation')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => setLocation({ lat: 41.9028, lng: 12.4964, address: 'Roma, IT' })}
              className="bg-surface border border-border rounded-md p-3 mb-3"
            >
              <Text className="text-text-primary">{t('issue.new.useCurrentLocation')}</Text>
            </Pressable>
            {location && (
              <Text className="text-text-secondary text-sm">{location.address}</Text>
            )}
          </View>
        )}

        {step === 4 && (
          <View className="flex-1 p-4">
            <Text className="text-text-primary text-lg mb-3">{t('issue.new.stepDescription')}</Text>
            <TextInput
              accessibilityLabel={t('issue.new.stepDescription')}
              multiline
              value={description_i18n[locale] ?? ''}
              onChangeText={(v) => setDescription(locale, v)}
              className="border border-border rounded-md p-3 bg-surface text-text-primary min-h-32"
            />
            {create.isError && (
              <Text accessibilityLiveRegion="polite" className="text-error mt-3">
                {t('errors.generic')}
              </Text>
            )}
          </View>
        )}

        <View className="flex-row p-4 border-t border-border">
          {step > 1 && (
            <Pressable
              accessibilityRole="button"
              onPress={back}
              className="flex-1 mr-2 border border-border rounded-md p-3 items-center"
            >
              <Text className="text-text-primary">{t('common.back')}</Text>
            </Pressable>
          )}
          {step < 4 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: nextDisabled }}
              onPress={next}
              disabled={nextDisabled}
              className={`flex-1 bg-primary rounded-md p-3 items-center ${nextDisabled ? 'opacity-50' : ''}`}
            >
              <Text className="text-text-onPrimary font-semibold">{t('common.ok')}</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              onPress={submit}
              disabled={create.isPending}
              className="flex-1 bg-primary rounded-md p-3 items-center"
            >
              {create.isPending ? <ActivityIndicator color="#fff" /> : (
                <Text className="text-text-onPrimary font-semibold">{t('issue.new.submit')}</Text>
              )}
            </Pressable>
          )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
