import { Link } from 'expo-router';
import { Text, Pressable, View } from 'react-native';
import { Card } from '@/components/ui/Card';
import type { Idea } from '@/api/hooks/useIdea';

type IdeaCardProps = {
  idea: Pick<Idea, 'id' | 'title'> & {
    upvotes?: Idea['upvotes'];
    user_upvoted?: Idea['user_upvoted'];
  };
  excerpt?: string;
};

export function IdeaCard({ idea, excerpt }: IdeaCardProps) {
  return (
    <Link href={`/idea/${idea.id}`} asChild>
      <Pressable accessibilityRole="button" accessibilityLabel={`Idea: ${idea.title}`}>
        <Card className="m-3">
          <Text className="text-text-primary text-base font-semibold mb-1">{idea.title}</Text>
          {excerpt && <Text className="text-text-secondary text-sm mb-2">{excerpt}</Text>}
          <View className="flex-row items-center">
            <Text className="text-text-secondary text-xs">▲ {idea.upvotes ?? 0}</Text>
          </View>
        </Card>
      </Pressable>
    </Link>
  );
}
