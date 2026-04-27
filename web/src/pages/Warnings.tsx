import { createResource, createSignal, For, Show } from 'solid-js';
import { getWarnings, acknowledgeWarning, deleteWarning, fmtDate, baseForRemote, type Warning } from '../api';
import { useRemote } from '../RemoteContext';
import { useRbac } from '../RbacContext';

function severityBadge(s: string) {
  if (s === 'low')      return 'badge badge-blue';
  if (s === 'moderate') return 'badge badge-yellow';
  if (s === 'high')     return 'badge badge-red';
  return 'badge badge-gray';
}

function statusBadge(s: string) {
  if (s === 'new')          return 'badge badge-red';
  if (s === 'acknowledged') return 'badge badge-gray';
  if (s === 'resolved')     return 'badge badge-green';
  return 'badge badge-gray';
}

export default function Warnings() {
  const { remote } = useRemote();
  const { readOnly } = useRbac();
  const [warnings, { refetch }] = createResource(remote, r =>
    fetch(`${baseForRemote(r)}/warnings?recursion=1`).then(res => res.json())
  );
  const [actionError,   setActionError]   = createSignal<string | null>(null);
  const [busy,          setBusy]          = createSignal<string | null>(null);
  const [q,             setQ]             = createSignal('');
  const [showResolved,  setShowResolved]  = createSignal(false);

  const filtered = () => {
    let rows = warnings()?.metadata ?? [];
    if (!showResolved()) rows = rows.filter((w: Warning) => w.status !== 'resolved');
    const s = q().toLowerCase();
    if (!s) return rows;
    return rows.filter((w: Warning) =>
      (w.last_message ?? '').toLowerCase().includes(s) ||
      (w.type ?? '').toLowerCase().includes(s) ||
      (w.severity ?? '').toLowerCase().includes(s) ||
      (w.status ?? '').toLowerCase().includes(s) ||
      (w.location ?? '').toLowerCase().includes(s)
    );
  };

  async function handleAcknowledge(uuid: string) {
    setActionError(null);
    setBusy(`${uuid}:ack`);
    try {
      await acknowledgeWarning(uuid);
      refetch();
    } catch (e: any) { setActionError(e.message ?? String(e)); }
    finally { setBusy(null); }
  }

  async function handleDelete(uuid: string) {
    setActionError(null);
    if (!confirm('Delete this warning? This cannot be undone.')) return;
    setBusy(`${uuid}:delete`);
    try {
      await deleteWarning(uuid);
      refetch();
    } catch (e: any) { setActionError(e.message ?? String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div class="card">
        <div class="card-header">
          <span>Warnings</span>
          <div class="card-toolbar">
            <label class="toolbar-toggle">
              <input type="checkbox" checked={showResolved()} onChange={e => setShowResolved(e.currentTarget.checked)} />
              Show resolved
            </label>
            <input class="search-input" placeholder="Filter warnings…" value={q()} onInput={e => setQ(e.currentTarget.value)} />
            <button class="btn btn-sm" onClick={() => refetch()}>↻ Refresh</button>
          </div>
        </div>

        <Show when={actionError()}><div class="error" style="margin:.5rem 1rem">{actionError()}</div></Show>
        <Show when={warnings.loading}><div class="loading">Loading…</div></Show>
        <Show when={warnings.error}><div class="error">Failed to load warnings</div></Show>

        <Show when={warnings()}>
          <table class="data-table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Status</th>
                <th>Type</th>
                <th>Message</th>
                <th>Count</th>
                <th>Location</th>
                <th>Last Seen</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()} fallback={
                <tr><td colspan="8" class="empty">{q() ? 'No warnings match your filter' : 'No warnings — all clear!'}</td></tr>
              }>
                {(w: Warning) => {
                  const isBusy = () => busy()?.startsWith(w.uuid) ?? false;
                  return (
                    <tr>
                      <td><span class={severityBadge(w.severity)}>{w.severity}</span></td>
                      <td><span class={statusBadge(w.status)}>{w.status}</span></td>
                      <td class="mono small">{w.type}</td>
                      <td style="max-width:300px;white-space:normal">{w.last_message}</td>
                      <td>{w.count}</td>
                      <td class="mono small">{w.location || '—'}</td>
                      <td class="muted small">{fmtDate(w.last_seen_at)}</td>
                      <td style="white-space:nowrap">
                        <Show when={!readOnly()}>
                          <Show when={w.status === 'new'}>
                            <button class="btn btn-sm" style="margin-right:.3rem" disabled={isBusy()}
                              onClick={() => handleAcknowledge(w.uuid)}>
                              {busy() === `${w.uuid}:ack` ? '…' : 'Ack'}
                            </button>
                          </Show>
                          <button class="btn btn-sm btn-danger" disabled={isBusy()}
                            onClick={() => handleDelete(w.uuid)}>
                            {busy() === `${w.uuid}:delete` ? '…' : 'Delete'}
                          </button>
                        </Show>
                      </td>
                    </tr>
                  );
                }}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </div>
  );
}
