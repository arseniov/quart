// src/api/__tests__/notifications.test.ts
jest.mock('@/api/client', () => ({
  apiClient: {
    patch: jest.fn().mockResolvedValue({ status: 200, data: {} }),
    get: jest.fn().mockResolvedValue({ status: 200, data: { notifications: [] } }),
    post: jest.fn(),
    put: jest.fn(),
    del: jest.fn(),
  },
}));

import { apiClient } from '@/api/client';
import { markNotificationRead } from '@/api/notifications';

const mPatch = apiClient.patch as jest.Mock;

beforeEach(() => {
  mPatch.mockClear();
});

describe('markNotificationRead', () => {
  it('calls apiClient.patch with /notifications/:id/read exactly once', async () => {
    await markNotificationRead('n1');
    expect(mPatch).toHaveBeenCalledTimes(1);
    expect(mPatch).toHaveBeenCalledWith('/notifications/n1/read');
  });

  it('propagates errors from apiClient.patch', async () => {
    mPatch.mockRejectedValueOnce(new Error('boom'));
    await expect(markNotificationRead('n2')).rejects.toThrow('boom');
  });
});
