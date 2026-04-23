import { createResource, createSignal, For, Show, Index } from 'solid-js';
import {
  getNetworks, getNetworkState, createNetwork, updateNetwork, deleteNetwork,
  fmtBytes, baseForRemote, type Network,
} from '../api';
import { useProject } from '../ProjectContext';
import { useRemote } from '../RemoteContext';
import { useRbac } from '../RbacContext';
import { Drawer } from '../components/Drawer';

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusBadge(s: string) {
  if (s === 'Created') return 'badge badge-green';
  if (s === 'Pending') return 'badge badge-yellow';
  return 'badge badge-gray';
}

function KVList(props: { entries: [string, string][] }) {
  return (
    <Show when={props.entries.length > 0} fallback={<div class="drawer-empty">—</div>}>
      <div class="kv-list">
        <For each={props.entries}>
          {([k, v]) => (<><span class="kv-list-key">{k}</span><span class="kv-list-val">{v}</span></>)}
        </For>
      </div>
    </Show>
  );
}

interface KVEntry { key: string; value: string }

function kvToRecord(entries: KVEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) if (e.key.trim()) out[e.key.trim()] = e.value;
  return out;
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

interface NetworkModalProps {
  existing?: Network;      // undefined = create mode
  project: string;
  onClose: () => void;
  onSaved: () => void;
}

function NetworkModal(props: NetworkModalProps) {
  const editing = () => !!props.existing;

  const [name,    setName]    = createSignal(props.existing?.name ?? '');
  const [desc,    setDesc]    = createSignal(props.existing?.description ?? '');
  const [type,    setType]    = createSignal(props.existing?.type ?? 'bridge');
  const [config,  setConfig]  = createSignal<KVEntry[]>(
    Object.entries(props.existing?.config ?? {}).map(([k, v]) => ({ key: k, value: v }))
  );
  const [busy,    setBusy]    = createSignal(false);
  const [error,   setError]   = createSignal<string | null>(null);

  function addConfigRow() { setConfig(c => [...c, { key: '', value: '' }]); }
  function removeConfigRow(i: number) { setConfig(c => c.filter((_, idx) => idx !== i)); }
  function setConfigKey(i: number, k: string)   { setConfig(c => c.map((e, idx) => idx === i ? { ...e, key: k }   : e)); }
  function setConfigVal(i: number, v: string)   { setConfig(c => c.map((e, idx) => idx === i ? { ...e, value: v } : e)); }

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing()) {
        await updateNetwork(props.existing!.name, {
          description: desc(),
          config: kvToRecord(config()),
        }, props.project);
      } else {
        await createNetwork({
          name: name(),
          description: desc(),
          type: type(),
          config: kvToRecord(config()),
        }, props.project);
      }
      props.onSaved();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('modal-backdrop')) props.onClose(); }}>
      <div class="modal" style="max-width:540px">
        <div class="modal-header">
          <span class="modal-title">{editing() ? `Edit Network: ${props.existing!.name}` : 'Create Network'}</span>
          <button class="modal-close" onClick={props.onClose} disabled={busy()}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div class="modal-body">
            <Show when={error()}><div class="error" style="margin-bottom:.75rem">{error()}</div></Show>

            <Show when={!editing()}>
              <div class="form-row">
                <label class="form-label">Name <span style="color:var(--red)">*</span></label>
                <input class="form-input" value={name()} onInput={e => setName(e.currentTarget.value)}
                  placeholder="my-network" required disabled={busy()} />
              </div>
              <div class="form-row" style="margin-top:.75rem">
                <label class="form-label">Type</label>
                <select class="form-input" value={type()} onChange={e => setType(e.currentTarget.value)} disabled={busy()}>
                  <option value="bridge">bridge</option>
                  <option value="macvlan">macvlan</option>
                  <option value="sriov">sriov</option>
                  <option value="ovn">ovn</option>
                </select>
              </div>
            </Show>

            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Description</label>
              <input class="form-input" value={desc()} onInput={e => setDesc(e.currentTarget.value)}
                placeholder="Optional description" disabled={busy()} />
            </div>

            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Config</label>
              <Index each={config()}>
                {(entry, i) => (
                  <div style="display:flex;gap:.5rem;margin-bottom:.4rem">
                    <input class="form-input" style="flex:1" placeholder="key"
                      value={entry().key} onInput={e => setConfigKey(i, e.currentTarget.value)} disabled={busy()} />
                    <input class="form-input" style="flex:2" placeholder="value"
                      value={entry().value} onInput={e => setConfigVal(i, e.currentTarget.value)} disabled={busy()} />
                    <button type="button" class="btn btn-sm" onClick={() => removeConfigRow(i)} disabled={busy()}>✕</button>
                  </div>
                )}
              </Index>
              <button type="button" class="btn btn-sm" onClick={addConfigRow} disabled={busy()} style="margin-top:.25rem">
                + Add key
              </button>
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" onClick={props.onClose} disabled={busy()}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={busy()}>
              {busy() ? 'Saving…' : editing() ? 'Save Changes' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function Networks() {
  const { project } = useProject();
  const { remote }  = useRemote();
  const { readOnly } = useRbac();
  const [networks, { refetch }] = createResource(
    () => ({ r: remote(), p: project() }),
    ({ r, p }) => {
      const url = p && p !== 'default'
        ? `${baseForRemote(r)}/networks?recursion=1&project=${encodeURIComponent(p)}`
        : `${baseForRemote(r)}/networks?recursion=1`;
      return fetch(url).then(res => res.json());
    },
  );
  const [selected, setSelected] = createSignal<string | null>(null);
  const [state]    = createResource(
    () => ({ r: remote(), name: selected(), p: project() }),
    ({ r, name, p }) => {
      if (!name) return null;
      const url = p && p !== 'default'
        ? `${baseForRemote(r)}/networks/${encodeURIComponent(name)}/state?project=${encodeURIComponent(p)}`
        : `${baseForRemote(r)}/networks/${encodeURIComponent(name)}/state`;
      return fetch(url).then(res => res.json());
    },
  );

  const [showCreate, setShowCreate] = createSignal(false);
  const [editTarget, setEditTarget] = createSignal<Network | null>(null);
  const [deleteError, setDeleteError] = createSignal<string | null>(null);
  const [q, setQ] = createSignal('');

  const net  = () => networks()?.metadata?.find(n => n.name === selected());
  const nst  = () => state()?.metadata;

  const filtered = () => {
    const rows = networks()?.metadata ?? [];
    const s = q().toLowerCase();
    if (!s) return rows;
    return rows.filter(n =>
      n.name.toLowerCase().includes(s) ||
      n.type.toLowerCase().includes(s) ||
      n.status.toLowerCase().includes(s)
    );
  };

  async function handleDelete(name: string) {
    setDeleteError(null);
    if (!confirm(`Delete network "${name}"? This cannot be undone.`)) return;
    try {
      await deleteNetwork(name, project());
      if (selected() === name) setSelected(null);
      refetch();
    } catch (err: any) {
      setDeleteError(err.message ?? String(err));
    }
  }

  return (
    <div>
      <Show when={showCreate()}>
        <NetworkModal
          project={project()}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refetch(); }}
        />
      </Show>

      <Show when={editTarget()}>
        <NetworkModal
          existing={editTarget()!}
          project={project()}
          onClose={() => setEditTarget(null)}
          onSaved={() => { setEditTarget(null); refetch(); }}
        />
      </Show>

      <div class="card">
        <div class="card-header">
          <span>Networks</span>
          <div class="card-toolbar">
            <input class="search-input" placeholder="Filter networks…" value={q()} onInput={e => setQ(e.currentTarget.value)} />
            <Show when={!readOnly()}>
              <button class="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>+ Create</button>
            </Show>
            <button class="btn btn-sm" onClick={() => refetch()}>↻ Refresh</button>
          </div>
        </div>

        <Show when={deleteError()}><div class="error" style="margin:.5rem 1rem">{deleteError()}</div></Show>
        <Show when={networks.loading}><div class="loading">Loading…</div></Show>
        <Show when={networks.error}><div class="error">Failed to load networks</div></Show>

        <Show when={networks()}>
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Managed</th>
                <th>IPv4</th>
                <th>IPv6</th>
                <th>Used By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()} fallback={<tr><td colspan="8" class="empty">{q() ? 'No networks match your filter' : 'No networks'}</td></tr>}>
                {(n: Network) => {
                  const isSelected = () => selected() === n.name;
                  return (
                    <tr
                      class={`row-clickable${isSelected() ? ' row-selected' : ''}`}
                      onClick={() => isSelected() ? setSelected(null) : setSelected(n.name)}
                    >
                      <td class="fw-medium">{n.name}</td>
                      <td>{n.type}</td>
                      <td><span class={statusBadge(n.status)}>{n.status}</span></td>
                      <td>{n.managed ? 'Yes' : 'No'}</td>
                      <td class="mono small">{n.config?.['ipv4.address'] ?? '—'}</td>
                      <td class="mono small">{n.config?.['ipv6.address'] ?? '—'}</td>
                      <td>{n.used_by?.length ?? 0}</td>
                      <td onClick={e => e.stopPropagation()} style="white-space:nowrap">
                        <Show when={n.managed && !readOnly()}>
                          <button class="btn btn-sm" style="margin-right:.3rem"
                            onClick={() => setEditTarget(n)}>Edit</button>
                          <button class="btn btn-sm btn-danger"
                            onClick={() => handleDelete(n.name)}>Delete</button>
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

      <Drawer
        open={!!selected()}
        title={`Network: ${selected() ?? ''}`}
        onClose={() => setSelected(null)}
      >
        <Show when={net()}>
          <div class="drawer-section">
            <div class="drawer-section-title">Overview</div>
            <div class="kv-list">
              <span class="kv-list-key">Type</span>
              <span class="kv-list-val">{net()!.type}</span>
              <span class="kv-list-key">Status</span>
              <span class="kv-list-val"><span class={statusBadge(net()!.status)}>{net()!.status}</span></span>
              <span class="kv-list-key">Managed</span>
              <span class="kv-list-val">{net()!.managed ? 'Yes' : 'No'}</span>
              <Show when={net()!.description}>
                <span class="kv-list-key">Description</span>
                <span class="kv-list-val">{net()!.description}</span>
              </Show>
              <span class="kv-list-key">Used By</span>
              <span class="kv-list-val">{net()!.used_by?.length ?? 0} instance(s)</span>
            </div>
          </div>

          <div class="drawer-section">
            <div class="drawer-section-title">Config</div>
            <KVList entries={Object.entries(net()!.config ?? {})} />
          </div>

          <Show when={state.loading}><div class="loading">Loading state…</div></Show>
          <Show when={nst()}>
            <div class="drawer-section">
              <div class="drawer-section-title">Runtime State</div>
              <div class="kv-list">
                <span class="kv-list-key">State</span>
                <span class="kv-list-val">{nst()!.state}</span>
                <span class="kv-list-key">MAC</span>
                <span class="kv-list-val mono">{nst()!.hwaddr || '—'}</span>
                <span class="kv-list-key">MTU</span>
                <span class="kv-list-val">{nst()!.mtu || '—'}</span>
                <span class="kv-list-key">RX</span>
                <span class="kv-list-val">{fmtBytes(nst()!.counters?.bytes_received ?? 0)} ({(nst()!.counters?.packets_received ?? 0).toLocaleString()} pkts)</span>
                <span class="kv-list-key">TX</span>
                <span class="kv-list-val">{fmtBytes(nst()!.counters?.bytes_sent ?? 0)} ({(nst()!.counters?.packets_sent ?? 0).toLocaleString()} pkts)</span>
              </div>
            </div>

            <Show when={(nst()!.addresses?.length ?? 0) > 0}>
              <div class="drawer-section">
                <div class="drawer-section-title">Addresses</div>
                <div class="kv-list">
                  <For each={nst()!.addresses}>
                    {addr => (
                      <>
                        <span class="kv-list-key">{addr.family} <span class="muted">({addr.scope})</span></span>
                        <span class="kv-list-val mono">{addr.address}/{addr.netmask}</span>
                      </>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </Show>

          <Show when={(net()!.used_by?.length ?? 0) > 0}>
            <div class="drawer-section">
              <div class="drawer-section-title">Used By</div>
              <div class="kv-list">
                <For each={net()!.used_by}>
                  {ref => (
                    <>
                      <span class="kv-list-key">instance</span>
                      <span class="kv-list-val">{ref.replace(/^\/1\.0\/instances\//, '')}</span>
                    </>
                  )}
                </For>
              </div>
            </div>
          </Show>
        </Show>
      </Drawer>
    </div>
  );
}
