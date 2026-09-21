// app/(app)/settings/__tests__/notifications.test.tsx
// GH #38 — toggling the push Switch off must (1) call
// Notifications.unregisterForNotificationsAsync() to drop the FCM/APNs token,
// and (2) fire-and-forget DELETE /me/devices so the backend stops using it.
// The OS unregister is the load-bearing call; the backend DELETE is best-effort
// and must not throw if the endpoint is missing.

import { fireEvent, render, waitFor } from '@testing-library/react-native';

jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  unregisterForNotificationsAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/api/client', () => {
  const del = jest.fn().mockResolvedValue({ status: 204, data: undefined, headers: new Headers() });
  const post = jest.fn().mockResolvedValue({ status: 200, data: {}, headers: new Headers() });
  const get = jest.fn().mockResolvedValue({ status: 200, data: { topic_ids: [] }, headers: new Headers() });
  return { apiClient: { del, post, get }, __del: del };
});

jest.mock('@/api/hooks/useTopics', () => ({
  useTopics: () => ({ data: [], isPending: false }),
}));

jest.mock('@/api/hooks/useUpdatePrefs', () => ({
  useTopicSubscriptions: () => ({ data: { topic_ids: [] }, isPending: false }),
  useUpdateTopicSubscriptions: () => ({ mutate: jest.fn() }),
}));

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
}));

import NotificationsSettings from '../notifications';
const Notifications = require('expo-notifications') as {
  unregisterForNotificationsAsync: jest.Mock;
  requestPermissionsAsync: jest.Mock;
};
const apiNs = require('@/api/client') as { apiClient: { del: jest.Mock } };

describe('NotificationsSettings — revoke on toggle off (GH #38)', () => {
  beforeEach(() => {
    Notifications.unregisterForNotificationsAsync.mockClear();
    Notifications.requestPermissionsAsync.mockClear();
    apiNs.apiClient.del.mockClear();
  });

  it('on toggle false, calls unregisterForNotificationsAsync + best-effort DELETE /me/devices', async () => {
    const { UNSAFE_getByType } = render(<NotificationsSettings />);
    const { Switch } = require('react-native');
    const toggle = UNSAFE_getByType(Switch);

    fireEvent(toggle, 'valueChange', false);

    await waitFor(() => {
      expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
    });
    expect(apiNs.apiClient.del).toHaveBeenCalledWith('/me/devices');
    // ponytail: order matters — OS must revoke before backend DELETE so a slow
    //          network doesn't leave the user receiving pushes after the
    //          "off" promise resolves.
    const unregOrder = Notifications.unregisterForNotificationsAsync.mock.invocationCallOrder[0];
    const delOrder = apiNs.apiClient.del.mock.invocationCallOrder[0];
    expect(unregOrder).toBeDefined();
    expect(delOrder).toBeDefined();
    expect(unregOrder!).toBeLessThan(delOrder!);
    // The request flow on false must NOT also ask the OS for permission.
    expect(Notifications.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it('still calls unregister even when DELETE /me/devices fails (backend endpoint missing)', async () => {
    apiNs.apiClient.del.mockRejectedValueOnce(new Error('404 not found'));
    const { UNSAFE_getByType } = render(<NotificationsSettings />);
    const { Switch } = require('react-native');
    const toggle = UNSAFE_getByType(Switch);

    fireEvent(toggle, 'valueChange', false);

    await waitFor(() => {
      expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
    });
    // The best-effort DELETE throws are swallowed by the component — no Alert,
    // no thrown error escaping onPushToggle.
    expect(apiNs.apiClient.del).toHaveBeenCalledWith('/me/devices');
  });

  it('still calls unregister even when unregisterForNotificationsAsync rejects (no token registered)', async () => {
    Notifications.unregisterForNotificationsAsync.mockRejectedValueOnce(new Error('no token'));
    const { UNSAFE_getByType } = render(<NotificationsSettings />);
    const { Switch } = require('react-native');
    const toggle = UNSAFE_getByType(Switch);

    fireEvent(toggle, 'valueChange', false);

    await waitFor(() => {
      // The OS call rejecting must not block the backend DELETE — both run, both
      // swallow their own errors. We assert the backend DELETE was attempted.
      expect(apiNs.apiClient.del).toHaveBeenCalledWith('/me/devices');
    });
    expect(Notifications.unregisterForNotificationsAsync).toHaveBeenCalledTimes(1);
  });

  it('on toggle true with granted permission, requests permission and does not alert', async () => {
    Notifications.requestPermissionsAsync.mockResolvedValueOnce({ status: 'granted' });
    const { UNSAFE_getByType } = render(<NotificationsSettings />);
    const { Switch, Alert } = require('react-native');
    const toggle = UNSAFE_getByType(Switch);
    const alertSpy = jest.spyOn(Alert, 'alert');

    fireEvent(toggle, 'valueChange', true);

    await waitFor(() => {
      expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    });
    expect(alertSpy).not.toHaveBeenCalled();

    alertSpy.mockRestore();
  });

  it('on toggle true with denied permission, surfaces an alert', async () => {
    Notifications.requestPermissionsAsync.mockResolvedValueOnce({ status: 'denied' });
    const { UNSAFE_getByType } = render(<NotificationsSettings />);
    const { Switch, Alert } = require('react-native');
    const toggle = UNSAFE_getByType(Switch);
    const alertSpy = jest.spyOn(Alert, 'alert');

    fireEvent(toggle, 'valueChange', true);

    await waitFor(() => {
      expect(Notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    });
    expect(alertSpy).toHaveBeenCalled();

    alertSpy.mockRestore();
  });
});