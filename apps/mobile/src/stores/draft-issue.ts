import { create } from 'zustand';

interface DraftIssue {
  category_id: string | undefined;
  photos: string[];
  location: { lat: number; lng: number; address?: string; neighborhood_id?: string } | undefined;
  description_i18n: { it: string; en?: string };
  step: 1 | 2 | 3 | 4;
  addPhoto: (uri: string) => void;
  removePhoto: (uri: string) => void;
  setCategory: (id: string) => void;
  setLocation: (loc: { lat: number; lng: number; address?: string; neighborhood_id?: string } | undefined) => void;
  setDescription: (lang: 'it' | 'en', text: string) => void;
  setStep: (step: 1 | 2 | 3 | 4) => void;
  reset: () => void;
}

const empty = {
  category_id: undefined,
  photos: [] as string[],
  location: undefined as { lat: number; lng: number; address?: string; neighborhood_id?: string } | undefined,
  description_i18n: { it: '', en: undefined } as unknown as { it: string; en?: string },
  step: 1 as const,
};

export const useDraftIssueStore = create<DraftIssue>((set) => ({
  ...empty,
  addPhoto: (uri) => set((s) => ({ photos: [...s.photos, uri] })),
  removePhoto: (uri) => set((s) => ({ photos: s.photos.filter((p) => p !== uri) })),
  setCategory: (category_id) => set({ category_id }),
  setLocation: (location) => set({ location }),
  setDescription: (lang, text) =>
    set((s) => ({ description_i18n: { ...s.description_i18n, [lang]: text } })),
  setStep: (step) => set({ step }),
  reset: () =>
    set({ ...empty, photos: [...empty.photos], description_i18n: { ...empty.description_i18n } }),
}));
