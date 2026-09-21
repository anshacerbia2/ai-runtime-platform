import { useEffect, useState } from 'react';
import { labClient, type LabResources } from '../shared/api/lab-client.js';
import { errorMessage } from '../shared/api/http-client.js';

export function useWorkspace() {
  const [resources, setResources] = useState<LabResources | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const abort = new AbortController();
    void labClient
      .resources(abort.signal)
      .then(setResources)
      .catch((error: unknown) => {
        if (!abort.signal.aborted) {
          setError(errorMessage(error));
        }
      });
    return () => abort.abort();
  }, []);

  async function refreshHealth() {
    const health = await labClient.health();
    setResources((current) => (current ? { ...current, health } : current));
  }

  return { resources, error, setError, refreshHealth };
}
