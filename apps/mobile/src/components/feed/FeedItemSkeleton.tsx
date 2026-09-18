import { Card } from '@/components/ui/Card';
import { View } from 'react-native';

export function FeedItemSkeleton() {
  return (
    <Card className="m-3 opacity-60">
      <View className="h-3 w-12 bg-border rounded mb-2" />
      <View className="h-4 w-3/4 bg-border rounded mb-2" />
      <View className="h-3 w-1/2 bg-border rounded" />
    </Card>
  );
}
