import { useOnboardingStore } from '../onboarding';
import { useDraftIssueStore } from '../draft-issue';
import { useUiStore } from '../ui';

describe('onboarding store', () => {
  beforeEach(() => useOnboardingStore.getState().reset());

  it('accumulates selections', () => {
    useOnboardingStore.getState().setCity('roma');
    useOnboardingStore.getState().setNeighborhood('testaccio');
    useOnboardingStore.getState().toggleTopic('air-quality');
    const s = useOnboardingStore.getState();
    expect(s.city).toBe('roma');
    expect(s.neighborhood).toBe('testaccio');
    expect(s.topic_ids).toContain('air-quality');
  });
});

describe('draft-issue store', () => {
  beforeEach(() => useDraftIssueStore.getState().reset());

  it('captures photos and step', () => {
    const d = useDraftIssueStore.getState();
    d.addPhoto('file:///tmp/a.jpg');
    d.setStep(2);
    expect(useDraftIssueStore.getState().photos).toHaveLength(1);
    expect(useDraftIssueStore.getState().step).toBe(2);
  });
});

describe('ui store', () => {
  it('switches feed filter', () => {
    useUiStore.getState().setFeedFilter('poll');
    expect(useUiStore.getState().feedFilter).toBe('poll');
  });
});