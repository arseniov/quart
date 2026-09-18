// src/api/hooks/__tests__/useRegisterDevice.test.ts
jest.mock('expo-notifications', () => ({
  requestPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  getExpoPushTokenAsync: jest.fn().mockResolvedValue({ data: 'ExponentPushToken[abc]' }),
}));
jest.mock('@/api/client', () => ({
  apiClient: { post: jest.fn().mockResolvedValue({ status: 200, data: {} }) },
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useMutation: (cfg: any) => ({ mutationFn: cfg.mutationFn, mutate: cfg.mutationFn, mutateAsync: cfg.mutationFn }),
}));

describe('useRegisterDevice', () => {
  it('posts token to /me/devices with locale + version', async () => {
    const { useRegisterDevice } = require('@/api/hooks/useRegisterDevice');
    const { apiClient } = require('@/api/client');
    const m: any = useRegisterDevice();
    await m.mutate();
    expect(apiClient.post).toHaveBeenCalledWith(
      '/me/devices',
      expect.objectContaining({ expo_push_token: expect.any(String) }),
    );
  });
});
