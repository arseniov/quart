import { useOnboardingStore } from '../onboarding';
import { useDraftIssueStore } from '../draft-issue';
import { useUiStore } from '../ui';

describe('onboarding store', () => {
  beforeEach(() => useOnboardingStore.getState().reset());

  it('accumulates selections', () => {
    const s = useOnboardingStore.getState();
    s.setCity('roma');
    s.setNeighborhood('testaccio');
    s.toggleTopic('air-quality');
    s.toggleNotificationTopic('transit');
    const after = useOnboardingStore.getState();
    expect(after.city).toBe('roma');
    expect(after.neighborhood).toBe('testaccio');
    expect(after.topic_ids).toEqual(['air-quality']);
    expect(after.notification_topics).toEqual(['transit']);
  });

  it('toggleTopic removes an existing id (idempotent on second add)', () => {
    const s = useOnboardingStore.getState();
    s.toggleTopic('air-quality');
    s.toggleTopic('transit');
    expect(useOnboardingStore.getState().topic_ids).toEqual(['air-quality', 'transit']);
    s.toggleTopic('air-quality');
    expect(useOnboardingStore.getState().topic_ids).toEqual(['transit']);
  });

  it('reset clears all fields', () => {
    const s = useOnboardingStore.getState();
    s.setCity('roma');
    s.toggleTopic('air-quality');
    s.reset();
    const r = useOnboardingStore.getState();
    expect(r.city).toBeUndefined();
    expect(r.topic_ids).toEqual([]);
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

  it('removePhoto and setDescription and setLocation', () => {
    const d = useDraftIssueStore.getState();
    d.addPhoto('file:///tmp/a.jpg');
    d.addPhoto('file:///tmp/b.jpg');
    d.removePhoto('file:///tmp/a.jpg');
    d.setLocation({ lat: 41.9, lng: 12.5, address: 'Via Test' });
    d.setDescription('it', 'buca pericolosa');
    d.setDescription('en', 'dangerous pothole');
    const s = useDraftIssueStore.getState();
    expect(s.photos).toEqual(['file:///tmp/b.jpg']);
    expect(s.location).toEqual({ lat: 41.9, lng: 12.5, address: 'Via Test' });
    expect(s.description_i18n).toEqual({ it: 'buca pericolosa', en: 'dangerous pothole' });
  });

  it('reset returns to empty state', () => {
    const d = useDraftIssueStore.getState();
    d.addPhoto('file:///tmp/a.jpg');
    d.setStep(3);
    d.setDescription('it', 'draft');
    d.reset();
    const r = useDraftIssueStore.getState();
    expect(r.photos).toEqual([]);
    expect(r.step).toBe(1);
    expect(r.description_i18n).toEqual({ it: '' });
  });
});

describe('ui store', () => {
  it('switches feed filter', () => {
    useUiStore.getState().setFeedFilter('poll');
    expect(useUiStore.getState().feedFilter).toBe('poll');
  });
});
