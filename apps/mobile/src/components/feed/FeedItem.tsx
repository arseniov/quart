import { Link } from 'expo-router';
import { Text, Pressable } from 'react-native';
import { Card } from '@/components/ui/Card';
import type { FeedItem as FeedItemType } from '@/api/hooks/useFeed';

const kindToRoute: Record<FeedItemType['kind'], string> = {
  poll: '/poll',
  idea: '/idea',
  issue: '/issue',
};

export function FeedItem({ item }: { item: FeedItemType }) {
  return (
    <Link href={`${kindToRoute[item.kind]}/${item.id}`} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`${item.kind}: ${item.title}`}>
        <Card className="m-3">
          <Text className="text-text-secondary text-xs uppercase mb-1">{item.kind}</Text>
          <Text className="text-text-primary text-base font-semibold mb-1">{item.title}</Text>
          <Text className="text-text-secondary text-sm">{item.excerpt}</Text>
        </Card>
      </Pressable>
    </Link>
  );
}
