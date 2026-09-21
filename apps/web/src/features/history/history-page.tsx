import { useEffect, useState } from 'react';
import {
  labClient,
  type SavedValidation,
} from '../../shared/api/lab-client.js';
import { errorMessage } from '../../shared/api/http-client.js';
import { prettyJson } from '../../shared/lib/json.js';

export function HistoryPage({
  onError,
  onRefresh,
}: {
  onError(error: string): void;
  onRefresh(): Promise<void>;
}) {
  const [items, setItems] = useState<SavedValidation[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<SavedValidation | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void labClient
      .history()
      .then((page) => {
        if (active) {
          setItems(page.items);
          setCursor(page.next_cursor);
        }
      })
      .catch((error: unknown) => {
        if (active) {
          onError(errorMessage(error));
        }
      });
    return () => {
      active = false;
    };
  }, [onError]);

  async function load(more = false) {
    setBusy(true);
    try {
      const page = await labClient.history(more ? cursor : null);
      setItems((previous) =>
        more ? [...previous, ...page.items] : page.items,
      );
      setCursor(page.next_cursor);
      await onRefresh();
    } catch (error) {
      onError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Metadata validasi</h2>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh dari DB
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>WAKTU</th>
              <th>KONTRAK</th>
              <th>STATUS</th>
              <th>RECORD</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.created_at).toLocaleString('id-ID')}</td>
                <td>{row.kind}</td>
                <td>
                  <span className={'pill ' + (row.valid ? 'pass' : 'fail')}>
                    {row.valid ? 'VALID' : 'INVALID'}
                  </span>
                </td>
                <td className="mono">{row.id.slice(0, 13)}…</td>
                <td>
                  <button
                    className="text-button"
                    onClick={() => setSelected(row)}
                  >
                    Detail
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && (
        <p className="table-empty">
          Belum ada validasi. Mulai dari Contract Lab.
        </p>
      )}
      {cursor && (
        <button
          className="secondary load-more"
          disabled={busy}
          onClick={() => void load(true)}
        >
          Muat berikutnya
        </button>
      )}
      {selected && (
        <details className="saved-detail" open>
          <summary>Record {selected.id}</summary>
          <pre>{prettyJson(selected)}</pre>
        </details>
      )}
      <div className="privacy-note">
        Yang tersimpan: digest, bentuk request, profile, hasil validasi, dan
        waktu. Prompt mentah, provider key, dan job bisnis tidak disimpan.
      </div>
    </section>
  );
}
