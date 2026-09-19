// src/components/idea/CommentComposer.tsx
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { minHitSlop } from '@/a11y/hit-slop';
import { usePostIdeaComment } from '@/api/hooks/useIdeaComments';

const CommentFormSchema = z.object({
  body: z.string().min(1).max(5000),
});
type CommentFormInput = z.infer<typeof CommentFormSchema>;

const MAX_LEN = 5000;
const COUNTER_THRESHOLD = 4500;

export function CommentComposer({ ideaId }: { ideaId: string | null | undefined }) {
  const { t } = useTranslation();
  const post = usePostIdeaComment(ideaId ?? '');
  const [body, setBody] = useState('');

  const { control, handleSubmit, reset, formState: { isValid } } = useForm<CommentFormInput>({
    resolver: zodResolver(CommentFormSchema),
    defaultValues: { body: '' },
    mode: 'onChange',
  });

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && !post.isPending;

  const onSubmit = handleSubmit(async () => {
    try {
      await post.mutateAsync({ body: trimmed });
      reset({ body: '' });
      setBody('');
      post.reset();
    } catch {
      Alert.alert(t('idea.comments.failed'));
    }
  });

  return (
    <View className="p-4 border-t border-border bg-bg">
      <Controller
        control={control}
        name="body"
        render={({ field }) => (
          <TextInput
            {...field}
            value={body}
            onChangeText={(v) => {
              field.onChange(v);
              setBody(v);
            }}
            accessibilityLabel={t('idea.comments.placeholder')}
            placeholder={t('idea.comments.placeholder')}
            multiline
            maxLength={MAX_LEN}
            testID="comment-composer-input"
            className="border border-border rounded-md p-3 mb-1 bg-surface text-text-primary min-h-24"
          />
        )}
      />
      {body.length > COUNTER_THRESHOLD && (
        <Text className="text-text-secondary text-xs self-end mb-2">
          {t('idea.comments.charCount', { count: body.length })}
        </Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={post.isPending ? t('idea.comments.submitting') : t('idea.comments.submit')}
        accessibilityState={{ disabled: !canSubmit }}
        hitSlop={minHitSlop(44)}
        onPress={onSubmit}
        disabled={!canSubmit}
        className={`rounded-md p-3 items-center ${canSubmit ? 'bg-primary' : 'bg-surface border border-border'}`}
      >
        {post.isPending ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text className={canSubmit ? 'text-text-onPrimary font-semibold' : 'text-text-secondary'}>
            {isValid || canSubmit ? t('idea.comments.submit') : t('idea.comments.submit')}
          </Text>
        )}
      </Pressable>
    </View>
  );
}
