import { View, type ViewProps } from 'react-native';

export function Card({ className, ...rest }: ViewProps) {
  return (
    <View
      {...rest}
      className={`bg-surface rounded-lg p-4 border border-border ${className ?? ''}`}
    />
  );
}
