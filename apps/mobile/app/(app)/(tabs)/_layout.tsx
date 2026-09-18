// app/(app)/(tabs)/_layout.tsx
import { Tabs } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { tokens } from '@/theme/tokens';

export default function TabsLayout() {
  const { t } = useTranslation();
  return (
    <Tabs screenOptions={{ tabBarActiveTintColor: tokens.color.primary.light }}>
      <Tabs.Screen name="index" options={{ title: t('nav.home') }} />
      <Tabs.Screen name="polls" options={{ title: t('nav.polls') }} />
      <Tabs.Screen name="ideas" options={{ title: t('nav.ideas') }} />
      <Tabs.Screen name="map" options={{ title: t('nav.map') }} />
      <Tabs.Screen name="profile" options={{ title: t('nav.profile') }} />
    </Tabs>
  );
}