import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiClient } from '@/api/client';

export interface OnboardingInput {
  city_id: string;
  neighborhood_id: string;
  topic_ids: string[];
  preferred_locale: string;
}

export function useCompleteOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: OnboardingInput) => {
      await apiClient.post('/me/onboarding', input);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });
}