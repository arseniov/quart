// src/api/__tests__/useDsar.test.ts
jest.mock('@/api/client', () => ({
  apiClient: {
    post: jest.fn().mockResolvedValue({ status: 200, data: { request_id: 'req-1' } }),
  },
}));

jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useMutation: (cfg: any) => cfg,
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

import { apiClient } from '@/api/client';
import { useExportData, useDeleteAccount } from '@/api/hooks/useDsar';

describe('useExportData', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs /me/dsar with type=export', async () => {
    const mut: any = useExportData();
    const result = await mut.mutationFn();
    expect(apiClient.post).toHaveBeenCalledWith('/me/dsar', { type: 'export' });
    expect(result).toEqual({ request_id: 'req-1' });
  });
});

describe('useDeleteAccount', () => {
  beforeEach(() => jest.clearAllMocks());

  it('POSTs /me/dsar with type=delete', async () => {
    const mut: any = useDeleteAccount();
    const result = await mut.mutationFn();
    expect(apiClient.post).toHaveBeenCalledWith('/me/dsar', { type: 'delete' });
    expect(result).toEqual({ request_id: 'req-1' });
  });
});
