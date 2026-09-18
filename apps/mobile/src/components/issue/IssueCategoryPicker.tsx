import { View, Text, Pressable, FlatList } from 'react-native';
import { useTranslation } from 'react-i18next';

export interface IssueCategory {
  id: string;
  code: string;
  name_i18n: { it: string; en: string };
  icon_name: string;
  color_hex: string;
}

export function IssueCategoryPicker({
  categories,
  selected,
  onSelect,
}: {
  categories: IssueCategory[];
  selected: string | null;
  onSelect: (id: string) => void;
}) {
  const { i18n } = useTranslation();
  const locale = (i18n.language as 'it' | 'en') ?? 'it';
  return (
    <FlatList
      data={categories}
      keyExtractor={(c) => c.id}
      renderItem={({ item }) => {
        const isSelected = selected === item.id;
        const label = item.name_i18n[locale] ?? item.name_i18n.it;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={isSelected ? `${label}, selected` : label}
            accessibilityState={{ selected: isSelected }}
            onPress={() => onSelect(item.id)}
            className={`m-2 p-4 rounded-md border ${isSelected ? 'border-primary bg-primary/10' : 'border-border bg-surface'}`}
          >
            <View className="flex-row items-center">
              <View className="w-3 h-3 rounded-full mr-3" style={{ backgroundColor: item.color_hex }} />
              <Text className="text-text-primary">{label}</Text>
            </View>
          </Pressable>
        );
      }}
    />
  );
}
