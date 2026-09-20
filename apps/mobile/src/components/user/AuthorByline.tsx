// src/components/user/AuthorByline.tsx
// Author byline — fetches a user's handle via `useUser` and renders a tappable
// link to `/user/:id`. Loading + 404/410/network all fall back to a non-tappable
// truncated id so the row never blocks on the profile lookup.
import { useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { minHitSlop } from '@/a11y/hit-slop';
import { useUser } from '@/api/hooks/useUser';

function shortId(id: string): string {
  return id.slice(0, 8);
}

interface AuthorBylineProps {
  userId: string;
}

export function AuthorByline({ userId }: AuthorBylineProps) {
  const router = useRouter();
  const { data, isPending } = useUser(userId);

  if (isPending) {
    return (
      <View testID="author-byline-loading">
        <Text className="text-text-secondary text-xs">{`@${shortId(userId)}`}</Text>
      </View>
    );
  }

  if (data) {
    return (
      <Pressable
        testID="author-byline-link"
        accessibilityRole="link"
        accessibilityLabel={`Profile of ${data.displayName}`}
        hitSlop={minHitSlop()}
        onPress={() => router.push(`/user/${userId}`)}
      >
        <Text className="text-primary text-xs font-medium">{`@${data.handle}`}</Text>
      </Pressable>
    );
  }

  // 404 / 410 / network — never block the row, fall back to truncated id.
  return (
    <View testID="author-byline-fallback">
      <Text className="text-text-secondary text-xs">{`@${shortId(userId)}`}</Text>
    </View>
  );
}