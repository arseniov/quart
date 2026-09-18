// ponytail: stub for Phase 10; Phase 5 wires the real useMe hook + MMKV-backed session
export interface Me {
  id: string;
  needs_onboarding: boolean;
}

export function useMe(): { data: Me | null; isPending: boolean } {
  // Default: not signed in. Phase 5 replaces with real session lookup.
  return { data: null, isPending: false };
}