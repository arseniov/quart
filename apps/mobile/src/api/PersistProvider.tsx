// src/api/PersistProvider.tsx
import { useEffect, useState, type ReactNode } from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { queryClient, persister } from './query-client';

export function PersistProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  if (!hydrated) return null;
  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{ persister, maxAge: 1000 * 60 * 60 * 24 }}
      onSuccess={() => {
        // resume paused mutations after hydrate
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
