import { create } from 'zustand';

export type FeedFilter = 'all' | 'poll' | 'idea' | 'issue';

interface UIState {
  theme: 'system' | 'light' | 'dark';
  feedFilter: FeedFilter;
  mapStyle: 'light' | 'dark';
  setTheme: (t: UIState['theme']) => void;
  setFeedFilter: (f: FeedFilter) => void;
  setMapStyle: (s: UIState['mapStyle']) => void;
}

export const useUiStore = create<UIState>((set) => ({
  theme: 'system',
  feedFilter: 'all',
  mapStyle: 'light',
  setTheme: (theme) => set({ theme }),
  setFeedFilter: (feedFilter) => set({ feedFilter }),
  setMapStyle: (mapStyle) => set({ mapStyle }),
}));