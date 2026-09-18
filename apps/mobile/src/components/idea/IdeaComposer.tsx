import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import { KeyboardAvoidingView, Platform, View, Text, TextInput, Pressable, ActivityIndicator, Alert } from 'react-native';
import { useCreateIdea } from '@/api/hooks/useIdea';
import { useRouter } from 'expo-router';

export const IdeaCreateSchema = z.object({
  title: z.string().min(3).max(200),
  body: z.string().min(10).max(8000),
});
export type IdeaCreateInput = z.infer<typeof IdeaCreateSchema>;

export function IdeaComposer() {
  const { t } = useTranslation();
  const router = useRouter();
  const create = useCreateIdea();
  const { control, handleSubmit, formState: { errors } } = useForm<IdeaCreateInput>({
    resolver: zodResolver(IdeaCreateSchema),
    defaultValues: { title: '', body: '' },
  });

  const onSubmit = handleSubmit(async (data) => {
    try {
      const idea = await create.mutateAsync(data);
      router.replace(`/idea/${idea.id}`);
    } catch {
      Alert.alert(t('errors.generic'));
    }
  });

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      className="flex-1 bg-bg"
    >
      <View className="flex-1 p-4">
      <Controller
        control={control}
        name="title"
        render={({ field }) => (
          <TextInput
            {...field}
            accessibilityLabel={t('idea.compose.title')}
            placeholder={t('idea.compose.title')}
            className="border border-border rounded-md p-3 mb-1 bg-surface text-text-primary"
          />
        )}
      />
      {errors.title && (
        <Text accessibilityLiveRegion="polite" className="text-error mb-2">
          {errors.title.message}
        </Text>
      )}
      <Controller
        control={control}
        name="body"
        render={({ field }) => (
          <TextInput
            {...field}
            accessibilityLabel={t('idea.compose.body')}
            placeholder={t('idea.compose.body')}
            multiline
            className="border border-border rounded-md p-3 mb-1 bg-surface text-text-primary min-h-32"
          />
        )}
      />
      {errors.body && (
        <Text accessibilityLiveRegion="polite" className="text-error mb-3">
          {errors.body.message}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        onPress={onSubmit}
        disabled={create.isPending}
        className="bg-primary rounded-md p-3 items-center mt-4"
      >
        {create.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className="text-text-onPrimary font-semibold">{t('idea.compose.submit')}</Text>
        )}
      </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
