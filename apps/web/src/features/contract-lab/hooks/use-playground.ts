import { ValidationInput } from '@ai-runtime/contracts';
import { useEffect, useRef, useState } from 'react';
import type { ContractKind } from '@ai-runtime/contracts';
import {
  labClient,
  type Example,
  type SavedValidation,
} from '../../../shared/api/lab-client';
import { isRequestAborted, toError } from '../../../shared/api/http-error';
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
  const [saved, setSaved] = useState<SavedValidation | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState<Error | null>(null);
  const pending = useRef<AbortController | null>(null);

  useEffect(() => () => pending.current?.abort(), []);

  function choose(example: Example) {
    setSelected(example.id);
    setKind(example.kind);
    setPayload(prettyJson(example.payload));
    setKey(newIdempotencyKey());
    setSaved(null);
    setRefreshWarning(null);
    onError(null);
  }

  function editPayload(value: string) {
    setPayload(value);
    setSaved(null);
  }

  function editKind(value: ContractKind) {
    setKind(value);
    setSaved(null);
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
    onError(null);
    setRefreshWarning(null);
    let value: unknown;
    try {
      value = JSON.parse(payload);
    } catch (cause) {
      onError(
        new Error('JSON tidak valid. Periksa tanda kutip, koma, dan kurung.', {
          cause,
        }),
      );
      return;
    }

    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    try {
      const result = await labClient.validate(
        ValidationInput.parse({ kind, payload: value }),
        key,
        controller.signal,
      );
      if (controller.signal.aborted) {
        return;
      }
      setSaved(result);
      // The durable mutation succeeded. A secondary refresh must not reverse that verdict.
      try {
        await onSaved();
      } catch (cause) {
        if (!controller.signal.aborted) {
          setRefreshWarning(
            new Error('Validasi tersimpan; status belum berhasil diperbarui.', {
              cause,
            }),
          );
        }
      }
    } catch (cause) {
      if (!controller.signal.aborted && !isRequestAborted(cause)) {
        onError(toError(cause));
      }
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) {
        setBusy(false);
      }
    }
  }

  return {
    selected,
    kind,
    payload,
    key,
    saved,
    busy,
    refreshWarning,
    choose,
    editPayload,
    editKind,
    format,
    validate,
    setKey,
  };
}
