import { useState } from 'react';
import type { ContractKind } from '@ai-runtime/contracts';
import {
  labClient,
  type Example,
  type SavedValidation,
} from '../../../shared/api/lab-client.js';
import { errorMessage } from '../../../shared/api/http-client.js';
import { newIdempotencyKey, prettyJson } from '../../../shared/lib/json.js';

export function usePlayground(
  examples: Example[],
  onSaved: () => Promise<void>,
  onError: (error: string) => void,
) {
  const [selected, setSelected] = useState(examples[0]?.id ?? 'chat');
  const [kind, setKind] = useState<ContractKind>(examples[0]?.kind ?? 'chat');
  const [payload, setPayload] = useState(
    prettyJson(examples[0]?.payload ?? {}),
  );
  const [key, setKey] = useState(newIdempotencyKey);
  const [saved, setSaved] = useState<SavedValidation | null>(null);
  const [busy, setBusy] = useState(false);

  function choose(example: Example) {
    setSelected(example.id);
    setKind(example.kind);
    setPayload(prettyJson(example.payload));
    setKey(newIdempotencyKey());
    setSaved(null);
    onError('');
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
    } catch {
      onError('JSON belum valid.');
    }
  }

  async function validate() {
    onError('');
    setBusy(true);
    try {
      const value: unknown = JSON.parse(payload);
      setSaved(await labClient.validate(kind, value, key));
      await onSaved();
    } catch (error) {
      onError(
        error instanceof SyntaxError
          ? 'JSON tidak valid. Periksa tanda kutip, koma, dan kurung.'
          : errorMessage(error),
      );
    } finally {
      setBusy(false);
    }
  }

  return {
    selected,
    kind,
    payload,
    key,
    saved,
    busy,
    choose,
    editPayload,
    editKind,
    format,
    validate,
    setKey,
  };
}
