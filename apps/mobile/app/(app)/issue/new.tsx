import { Stack, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
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
  const draft = useDraftIssueStore();
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

  const next = () => draft.setStep(Math.min(4, draft.step + 1) as 1 | 2 | 3 | 4);
  const back = () => draft.setStep(Math.max(1, draft.step - 1) as 1 | 2 | 3 | 4);

  const pickPhoto = async () => {
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.8 });
    if (!r.canceled && r.assets[0]) draft.addPhoto(r.assets[0].uri);
  };

  const submit = async () => {
    try {
      const description = draft.description_i18n[locale] ?? '';
      const parsed = IssueCreateSchema.parse({
        category_id: draft.category_id!,
        description,
        lat: draft.location!.lat,
        lng: draft.location!.lng,
        neighborhood_id: draft.location?.neighborhood_id ?? '00000000-0000-0000-0000-000000000000',
        photo_object_keys: [],
        address_hint: draft.location?.address,
      });
      await create.mutateAsync(parsed);
      draft.reset();
      router.replace('/');
    } catch {
      // surfaced below
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1"
    >
      <View className="flex-1 bg-bg">
        <Stack.Screen options={{ title: t('issue.new.title'), presentation: 'modal' }} />
        <ProgressBar current={draft.step} total={4} />

        {draft.step === 1 && (
          <View className="flex-1">
            <Text className="text-text-primary text-lg px-4 mb-2">{t('issue.new.stepCategory')}</Text>
            {isPending ? (
              <ActivityIndicator />
            ) : (
              <IssueCategoryPicker
                categories={categories ?? []}
                selected={draft.category_id ?? null}
                onSelect={(id) => {
                  draft.setCategory(id);
                  draft.setStep(2);
                }}
              />
            )}
          </View>
        )}

        {draft.step === 2 && (
          <View className="flex-1 p-4">
            <Text className="text-text-primary text-lg mb-3">{t('issue.new.stepPhotos')}</Text>
            <ScrollView horizontal className="mb-4">
              {draft.photos.map((uri) => (
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

        {draft.step === 3 && (
          <View className="flex-1 p-4">
            <Text className="text-text-primary text-lg mb-3">{t('issue.new.stepLocation')}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => draft.setLocation({ lat: 41.9028, lng: 12.4964, address: 'Roma, IT' })}
              className="bg-surface border border-border rounded-md p-3 mb-3"
            >
              <Text className="text-text-primary">Use current location</Text>
            </Pressable>
            {draft.location && (
              <Text className="text-text-secondary text-sm">{draft.location.address}</Text>
            )}
          </View>
        )}

        {draft.step === 4 && (
          <View className="flex-1 p-4">
            <Text className="text-text-primary text-lg mb-3">{t('issue.new.stepDescription')}</Text>
            <TextInput
              accessibilityLabel={t('issue.new.stepDescription')}
              multiline
              value={draft.description_i18n[locale] ?? ''}
              onChangeText={(v) => draft.setDescription(locale, v)}
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
          {draft.step > 1 && (
            <Pressable
              accessibilityRole="button"
              onPress={back}
              className="flex-1 mr-2 border border-border rounded-md p-3 items-center"
            >
              <Text className="text-text-primary">{t('common.back')}</Text>
            </Pressable>
          )}
          {draft.step < 4 ? (
            <Pressable
              accessibilityRole="button"
              onPress={next}
              className="flex-1 bg-primary rounded-md p-3 items-center"
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
