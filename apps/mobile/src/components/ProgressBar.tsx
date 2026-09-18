// src/components/ProgressBar.tsx
import { View } from 'react-native';

interface Props { current: number; total: number }

export function ProgressBar({ current, total }: Props) {
  return (
    <View className="flex-row gap-1 px-4 py-3">
      {Array.from({ length: total }, (_, i) => {
        const stepNum = i + 1;
        const active = stepNum <= current;
        return (
          <View
            key={i}
            accessibilityLabel={`Step ${stepNum} of ${total}`}
            className={`flex-1 h-1 rounded-full ${active ? 'bg-primary' : 'bg-border'}`}
          />
        );
      })}
    </View>
  );
}