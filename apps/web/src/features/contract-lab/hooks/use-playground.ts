import { ValidationInput } from '@ai-runtime/contracts';
import { useEffect, useRef, useState } from 'react';
import type { ContractKind } from '@ai-runtime/contracts';
import {
  labClient,
  type Example,
  type SavedValidation,
} from '../../../shared/api/lab-client';
import { ApiClientError, toError } from '../../../shared/api/http-error';
import {
  completeMutation,
  type MutationState,
} from '../../../shared/api/mutation-state';
import { newIdempotencyKey, prettyJson } from '../../../shared/lib/json';

export function usePlayground(
  examples: Example[],
  onSaved: () => Promise<void>,
  onError: (error: Error | null) => void,
) {
  const [selected, setSelected] = useState(examples[0]?.id ?? 'chat');
  const [kind, setKind] = useState<ContractKind>(examples[0]?.kind ?? 'chat');
  const [payload, setPayload] = useState(
    prettyJson(examples[0]?.payload ?? {}),
  );
  const [key, setKey] = useState(newIdempotencyKey);
  const [mutation, setMutation] = useState<MutationState<SavedValidation>>({
    status: 'idle',
  });
  const [refreshWarning, setRefreshWarning] = useState<Error | null>(null);
  const pending = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current++;
      pending.current?.abort();
    };
  }, []);

  function invalidate() {
    const interrupted = pending.current !== null;
    generation.current++;
    pending.current?.abort();
    pending.current = null;
    setMutation({ status: 'idle' });
    setRefreshWarning(
      interrupted
        ? new Error(
            'Request sebelumnya mungkin sudah tersimpan. Periksa History; pembatalan koneksi bukan rollback.',
          )
        : null,
    );
    onError(null);
  }
  function choose(example: Example) {
    invalidate();
    setSelected(example.id);
    setKind(example.kind);
    setPayload(prettyJson(example.payload));
    setKey(newIdempotencyKey());
  }
  function editPayload(value: string) {
    invalidate();
    setPayload(value);
  }
  function editKind(value: ContractKind) {
    invalidate();
    setKind(value);
  }
  function editKey(value: string) {
    invalidate();
    setKey(value);
  }
  function format() {
    try {
      setPayload(prettyJson(JSON.parse(payload)));
      onError(null);
    } catch (cause) {
      onError(new Error('JSON belum valid.', { cause }));
    }
  }

  async function validate() {
    if (pending.current) {
      return;
    }
    const operation = ++generation.current;
    onError(null);
    setRefreshWarning(null);
    let body: ReturnType<typeof ValidationInput.parse>;
    try {
      body = ValidationInput.parse({ kind, payload: JSON.parse(payload) });
    } catch (cause) {
      const error = new Error(
        'JSON tidak valid. Periksa bentuk payload, tanda kutip, koma, dan kurung.',
        { cause },
      );
      setMutation({ status: 'error', operation, error });
      onError(error);
      return;
    }
    const controller = new AbortController();
    pending.current = controller;
    setMutation({ status: 'pending', operation });
    const current = () =>
      mounted.current &&
      generation.current === operation &&
      !controller.signal.aborted;
    try {
      const result = await labClient.validate(body, key, controller.signal);
      if (!current()) {
        return;
      }
      setMutation((state) =>
        completeMutation(state, { status: 'success', operation, data: result }),
      );
      // Pending describes only this write, not a secondary health refresh.
      pending.current = null;
      try {
        await onSaved();
      } catch (cause) {
        if (current()) {
          setRefreshWarning(
            new Error('Validasi tersimpan; status belum berhasil diperbarui.', {
              cause,
            }),
          );
        }
      }
    } catch (cause) {
      if (!current()) {
        return;
      }
      const error = toError(cause);
      const status =
        error instanceof ApiClientError && error.outcome === 'unknown'
          ? 'unknown'
          : 'error';
      setMutation((state) =>
        completeMutation(state, { status, operation, error }),
      );
      onError(error);
    } finally {
      if (pending.current === controller) {
        pending.current = null;
      }
    }
  }

  return {
    selected,
    kind,
    payload,
    key,
    mutation,
    saved: mutation.status === 'success' ? mutation.data : null,
    busy: mutation.status === 'pending',
    refreshWarning,
    choose,
    editPayload,
    editKind,
    format,
    validate,
    setKey: editKey,
  };
}
