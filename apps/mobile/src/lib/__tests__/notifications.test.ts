// src/lib/__tests__/notifications.test.ts
import { routeForNotification } from '../notifications';

describe('routeForNotification', () => {
  it('routes idea kind to /idea/<id>', () => {
    expect(routeForNotification({ kind: 'idea', target_id: 'i1' })).toBe('/idea/i1');
  });

  it('routes poll kind to /poll/<id>', () => {
    expect(routeForNotification({ kind: 'poll', target_id: 'p1' })).toBe('/poll/p1');
  });

  it('routes issue kind to /issue/<id>', () => {
    expect(routeForNotification({ kind: 'issue', target_id: 'is1' })).toBe('/issue/is1');
  });

  it('falls back to /notifications for unknown kinds', () => {
    expect(routeForNotification({ kind: 'unknown', target_id: null })).toBe('/notifications');
  });

  it('falls back to /notifications when kind matches but target_id is missing', () => {
    expect(routeForNotification({ kind: 'idea', target_id: null })).toBe('/notifications');
  });
});
