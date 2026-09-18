import { create } from 'zustand';

export interface DraftLocation {
  lat: number;
  lng: number;
  address: string | undefined;
}

interface DraftIssue {
  category_id: string | undefined;
  photos: string[];
  location: DraftLocation | undefined;
  description_i18n: { it: string; en: string | undefined };
  step: 1 | 2 | 3 | 4;
  addPhoto: (uri: string) => void;
  removePhoto: (uri: string) => void;
  setLocation: (loc: DraftLocation | undefined) => void;
  setDescription: (lang: 'it' | 'en', text: string) => void;
  setStep: (step: 1 | 2 | 3 | 4) => void;
  reset: () => void;
}

const empty = {
  category_id: undefined,
  photos: [] as string[],
  location: undefined,
  description_i18n: { it: '', en: undefined } as { it: string; en: string | undefined },
  step: 1 as const,
};

export const useDraftIssueStore = create<DraftIssue>((set) => ({
  ...empty,
  addPhoto: (uri) => set((s) => ({ photos: [...s.photos, uri] })),
  removePhoto: (uri) => set((s) => ({ photos: s.photos.filter((p) => p !== uri) })),
  setLocation: (location) => set({ location }),
  setDescription: (lang, text) =>
    set((s) => ({ description_i18n: { ...s.description_i18n, [lang]: text } })),
  setStep: (step) => set({ step }),
  reset: () => set({ ...empty, photos: [], description_i18n: { it: '', en: undefined } }),
}));