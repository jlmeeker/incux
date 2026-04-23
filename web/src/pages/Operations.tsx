import { createResource, createSignal, For, Show } from 'solid-js';
import { getOperations, cancelOperation, fmtDate, baseForRemote, type Operation } from '../api';
import { useRemote } from '../RemoteContext';
import { useRbac } from '../RbacContext';

function statusBadge(s: string) {
  if (s === 'Running')   return 'badge badge-blue';
  if (s === 'Success')   return 'badge badge-green';
  if (s === 'Failure')   return 'badge badge-red';
  if (s === 'Cancelled') return 'badge badge-gray';
  if (s === 'Pending')   return 'badge badge-yellow';
  return 'badge badge-gray';
}

function classBadge(c: string) {
  if (c === 'task')  return 'badge badge-blue';
  if (c === 'token') return 'badge badge-yellow';
  return 'badge badge-gray';
}

function extractResource(op: Operation): string {
  const instances = op.resources?.instances ?? op.resources?.containers ?? [];
  if (instances.length > 0) return instances[0].replace(/^\/1\.0\/instances\//, '');
  return '';
}

export default function Operations() {
  const { remote } = useRemote();
  const { readOnly } = useRbac();
  const [ops, { refetch }] = createResource(remote, r =>
    fetch(`${baseForRemote(r)}/operations?recursion=1`).then(res => res.json())
  );
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [busy,        setBusy]        = createSignal<string | null>(null);
  const [q,           setQ]           = createSignal('');

  // Flatten the status-keyed map into a single array, newest first
  const allOps = () => {
    const map = ops()?.metadata ?? {};
    const flat: Operation[] = [];
    for (const list of Object.values(map)) flat.push(...list);
    flat.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return flat;
  };

  const filtered = () => {
    const s = q().toLowerCase();
    if (!s) return allOps();
    return allOps().filter(op =>
      op.description.toLowerCase().includes(s) ||
      op.status.toLowerCase().includes(s) ||
      op.class.toLowerCase().includes(s) ||
      extractResource(op).toLowerCase().includes(s)
    );
  };

  async function handleCancel(id: string) {
    setActionError(null);
    if (!confirm('Cancel this operation?')) return;
    setBusy(id);
    try {
      await cancelOperation(id);
      refetch();
    } catch (e: any) { setActionError(e.message ?? String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <div class="card">
        <div class="card-header">
          <span>Operations</span>
          <div class="card-toolbar">
            <input class="search-input" placeholder="Filter operations…" value={q()} onInput={e => setQ(e.currentTarget.value)} />
            <button class="btn btn-sm" onClick={() => refetch()}>↻ Refresh</button>
          </div>
        </div>

        <Show when={actionError()}><div class="error" style="margin:.5rem 1rem">{actionError()}</div></Show>
        <Show when={ops.loading}><div class="loading">Loading…</div></Show>
        <Show when={ops.error}><div class="error">Failed to load operations</div></Show>

        <Show when={ops()}>
          <table class="data-table">
            <thead>
              <tr>
                <th>Status</th>
                <th>Class</th>
                <th>Description</th>
                <th>Resource</th>
                <th>Created</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()} fallback={
                <tr><td colspan="7" class="empty">{q() ? 'No operations match your filter' : 'No operations'}</td></tr>
              }>
                {(op: Operation) => (
                  <tr>
                    <td><span class={statusBadge(op.status)}>{op.status}</span></td>
                    <td><span class={classBadge(op.class)}>{op.class}</span></td>
                    <td>{op.description}</td>
                    <td class="mono small">{extractResource(op) || '—'}</td>
                    <td class="muted small">{fmtDate(op.created_at)}</td>
                    <td class="muted small">{fmtDate(op.updated_at)}</td>
                    <td>
                      <Show when={op.may_cancel && op.status === 'Running' && !readOnly()}>
                        <button class="btn btn-sm btn-danger" disabled={busy() === op.id}
                          onClick={() => handleCancel(op.id)}>
                          {busy() === op.id ? '…' : 'Cancel'}
                        </button>
                      </Show>
                    </td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </Show>
      </div>
    </div>
  );
}
