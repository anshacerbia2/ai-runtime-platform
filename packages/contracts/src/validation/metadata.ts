// Bound the entire diagnostic request before recursive canonicalization.
export function withinPayloadBudget(
  value: unknown,
  maxDepth = 24,
  maxNodes = 4096,
): boolean {
  const stack: { value: unknown; depth: number }[] = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const item = stack.pop()!;
    if (++nodes > maxNodes || item.depth > maxDepth) {
      return false;
    }
    if (item.value && typeof item.value === 'object') {
      for (const child of Object.values(item.value)) {
        stack.push({ value: child, depth: item.depth + 1 });
      }
    }
  }
  return true;
}

// Stable JSON for lab idempotency. This is NOT the complete M1 execution digest contract.
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJson).join(',') + ']';
  }
  return (
    '{' +
    Object.keys(value)
      .sort()
      .map(
        (k) =>
          JSON.stringify(k) +
          ':' +
          canonicalJson((value as Record<string, unknown>)[k]),
      )
      .join(',') +
    '}'
  );
}

export function describePayload(payload: unknown) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { shape: typeof payload };
  }
  const o = payload as Record<string, unknown>;
  const i = (o.input && typeof o.input === 'object' ? o.input : {}) as Record<
    string,
    unknown
  >;
  // Persist structural metadata only: no raw prompt/messages, labels, credential, or arbitrary input.
  return {
    top_level_fields: Object.keys(o).filter((k) =>
      [
        'profile',
        'capability',
        'context',
        'input',
        'constraints',
        'stream',
        'session_ref',
      ].includes(k),
    ),
    prompt_characters: typeof i.prompt === 'string' ? i.prompt.length : 0,
    message_count: Array.isArray(i.messages) ? i.messages.length : 0,
    artifact_count: Array.isArray(i.artifact_refs) ? i.artifact_refs.length : 0,
  };
}
