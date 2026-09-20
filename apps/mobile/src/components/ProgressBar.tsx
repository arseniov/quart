// src/components/ProgressBar.tsx
import { View } from 'react-native';

interface Props { current: number; total: number }

export function ProgressBar({ current, total }: Props) {
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={`Step ${current} of ${total}`}
      accessibilityValue={{ now: current, min: 0, max: total }}
      className="flex-row gap-1 px-4 py-3"
    >
      {Array.from({ length: total }, (_, i) => {
        const stepNum = i + 1;
        const active = stepNum <= current;
        return (
          <View
            key={i}
            className={`flex-1 h-1 rounded-full ${active ? 'bg-primary' : 'bg-border'}`}
          />
        );
      })}
    </View>
  );
}
