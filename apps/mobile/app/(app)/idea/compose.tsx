import { Stack } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { IdeaComposer } from '@/components/idea/IdeaComposer';

export default function ComposeIdeaScreen() {
  const { t } = useTranslation();
  return (
    <>
      <Stack.Screen options={{ title: t('idea.compose.title'), presentation: 'modal' }} />
      <IdeaComposer />
    </>
  );
}
