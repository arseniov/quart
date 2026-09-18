import { create } from 'zustand';

interface OnboardingState {
  city: string | undefined;
  neighborhood: string | undefined;
  topic_ids: string[];
  notification_topics: string[];
  setCity: (city: string) => void;
  setNeighborhood: (n: string) => void;
  toggleTopic: (id: string) => void;
  toggleNotificationTopic: (id: string) => void;
  reset: () => void;
}

export const useOnboardingStore = create<OnboardingState>((set) => ({
  city: undefined,
  neighborhood: undefined,
  topic_ids: [],
  notification_topics: [],
  setCity: (city) => set({ city }),
  setNeighborhood: (neighborhood) => set({ neighborhood }),
  toggleTopic: (id) =>
    set((s) => ({
      topic_ids: s.topic_ids.includes(id)
        ? s.topic_ids.filter((x) => x !== id)
        : [...s.topic_ids, id],
    })),
  toggleNotificationTopic: (id) =>
    set((s) => ({
      notification_topics: s.notification_topics.includes(id)
        ? s.notification_topics.filter((x) => x !== id)
        : [...s.notification_topics, id],
    })),
  reset: () =>
    set({ city: undefined, neighborhood: undefined, topic_ids: [], notification_topics: [] }),
}));