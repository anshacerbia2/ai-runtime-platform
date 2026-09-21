interface ErrorBody {
  error?: { code?: string; message?: string };
}

async function fetchJson<T>(url: string, options: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error('Backend tidak merespons JSON. Periksa server M0.');
  }

  if (!response.ok) {
    const body = data as ErrorBody | null;
    throw new Error(
      `${body?.error?.code ?? response.status}: ${body?.error?.message ?? 'Request gagal.'}`,
    );
  }
  return data as T;
}

export function requestJson<T>(path: string, options: RequestInit = {}) {
  return fetchJson<T>('/api/m0/' + path, options);
}

export function requestPlatformJson<T>(
  path: string,
  options: RequestInit = {},
) {
  return fetchJson<T>(path, options);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Terjadi kesalahan yang tidak dikenal.';
}
