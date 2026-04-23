import { createResource, createSignal, For, Show, Index } from 'solid-js';
import {
  getStoragePools, getStoragePoolResources, getStorageVolumes,
  createStoragePool, deleteStoragePool, updateStoragePool,
  createStorageVolume, deleteStorageVolume, updateStorageVolume,
  getVolumeSnapshots, createVolumeSnapshot, deleteVolumeSnapshot, restoreVolumeSnapshot,
  getVolumeBackups, createVolumeBackup, deleteVolumeBackup, downloadVolumeBackupUrl,
  waitForOperation,
  fmtBytes, fmtDate, baseForRemote,
  type StoragePool, type StorageVolume, type VolumeSnapshot, type VolumeBackup,
} from '../api';
import { useProject } from '../ProjectContext';
import { useRemote } from '../RemoteContext';
import { useRbac } from '../RbacContext';
import { Drawer } from '../components/Drawer';

// ── Helpers ───────────────────────────────────────────────────────────────────

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

function ConfigEditor(props: {
  entries: KVEntry[];
  busy: boolean;
  onChange: (entries: KVEntry[]) => void;
}) {
  function addRow()          { props.onChange([...props.entries, { key: '', value: '' }]); }
  function removeRow(i: number) { props.onChange(props.entries.filter((_, idx) => idx !== i)); }
  function setKey(i: number, k: string) { props.onChange(props.entries.map((e, idx) => idx === i ? { ...e, key: k }   : e)); }
  function setVal(i: number, v: string) { props.onChange(props.entries.map((e, idx) => idx === i ? { ...e, value: v } : e)); }
  return (
    <>
      <Index each={props.entries}>
        {(entry, i) => (
          <div style="display:flex;gap:.5rem;margin-bottom:.4rem">
            <input class="form-input" style="flex:1" placeholder="key"
              value={entry().key} onInput={e => setKey(i, e.currentTarget.value)} disabled={props.busy} />
            <input class="form-input" style="flex:2" placeholder="value"
              value={entry().value} onInput={e => setVal(i, e.currentTarget.value)} disabled={props.busy} />
            <button type="button" class="btn btn-sm" onClick={() => removeRow(i)} disabled={props.busy}>✕</button>
          </div>
        )}
      </Index>
      <button type="button" class="btn btn-sm" onClick={addRow} disabled={props.busy} style="margin-top:.25rem">+ Add key</button>
    </>
  );
}

// ── Create Pool modal ─────────────────────────────────────────────────────────

interface CreatePoolModalProps { onClose: () => void; onSaved: () => void; }

function CreatePoolModal(props: CreatePoolModalProps) {
  const [name,   setName]   = createSignal('');
  const [driver, setDriver] = createSignal('dir');
  const [desc,   setDesc]   = createSignal('');
  const [config, setConfig] = createSignal<KVEntry[]>([]);
  const [busy,   setBusy]   = createSignal(false);
  const [error,  setError]  = createSignal<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await createStoragePool({ name: name(), driver: driver(), description: desc(), config: kvToRecord(config()) });
      props.onSaved();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally { setBusy(false); }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('modal-backdrop')) props.onClose(); }}>
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <span class="modal-title">Create Storage Pool</span>
          <button class="modal-close" onClick={props.onClose} disabled={busy()}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div class="modal-body">
            <Show when={error()}><div class="error" style="margin-bottom:.75rem">{error()}</div></Show>
            <div class="form-row">
              <label class="form-label">Name <span style="color:var(--red)">*</span></label>
              <input class="form-input" value={name()} onInput={e => setName(e.currentTarget.value)}
                placeholder="my-pool" required disabled={busy()} />
            </div>
            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Driver</label>
              <select class="form-input" value={driver()} onChange={e => setDriver(e.currentTarget.value)} disabled={busy()}>
                <option value="dir">dir</option>
                <option value="btrfs">btrfs</option>
                <option value="zfs">zfs</option>
                <option value="lvm">lvm</option>
                <option value="ceph">ceph</option>
              </select>
            </div>
            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Description</label>
              <input class="form-input" value={desc()} onInput={e => setDesc(e.currentTarget.value)}
                placeholder="Optional" disabled={busy()} />
            </div>
            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Config</label>
              <ConfigEditor entries={config()} busy={busy()} onChange={setConfig} />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" onClick={props.onClose} disabled={busy()}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={busy()}>{busy() ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Pool modal ───────────────────────────────────────────────────────────

interface EditPoolModalProps { pool: StoragePool; onClose: () => void; onSaved: () => void; }

function EditPoolModal(props: EditPoolModalProps) {
  const [desc,   setDesc]   = createSignal(props.pool.description ?? '');
  const [config, setConfig] = createSignal<KVEntry[]>(
    Object.entries(props.pool.config ?? {}).map(([k, v]) => ({ key: k, value: v }))
  );
  const [busy,  setBusy]  = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await updateStoragePool(props.pool.name, { description: desc(), config: kvToRecord(config()) });
      props.onSaved();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally { setBusy(false); }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('modal-backdrop')) props.onClose(); }}>
      <div class="modal" style="max-width:520px;max-height:90vh;overflow-y:auto">
        <div class="modal-header">
          <span class="modal-title">Edit Pool: {props.pool.name}</span>
          <button class="modal-close" onClick={props.onClose} disabled={busy()}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div class="modal-body">
            <Show when={error()}><div class="error" style="margin-bottom:.75rem">{error()}</div></Show>
            <div class="form-row">
              <label class="form-label">Driver <span class="muted small">(read-only)</span></label>
              <input class="form-input" value={props.pool.driver} disabled />
            </div>
            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Description</label>
              <input class="form-input" value={desc()} onInput={e => setDesc(e.currentTarget.value)}
                placeholder="Optional" disabled={busy()} />
            </div>
            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Config</label>
              <ConfigEditor entries={config()} busy={busy()} onChange={setConfig} />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" onClick={props.onClose} disabled={busy()}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={busy()}>{busy() ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Create Volume modal ───────────────────────────────────────────────────────

interface CreateVolumeModalProps { pool: string; project: string; onClose: () => void; onSaved: () => void; }

function CreateVolumeModal(props: CreateVolumeModalProps) {
  const [name,   setName]   = createSignal('');
  const [desc,   setDesc]   = createSignal('');
  const [config, setConfig] = createSignal<KVEntry[]>([]);
  const [busy,   setBusy]   = createSignal(false);
  const [error,  setError]  = createSignal<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await createStorageVolume(props.pool, { name: name(), type: 'custom', description: desc(), config: kvToRecord(config()) }, props.project);
      props.onSaved();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally { setBusy(false); }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('modal-backdrop')) props.onClose(); }}>
      <div class="modal" style="max-width:500px">
        <div class="modal-header">
          <span class="modal-title">Create Volume in "{props.pool}"</span>
          <button class="modal-close" onClick={props.onClose} disabled={busy()}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div class="modal-body">
            <Show when={error()}><div class="error" style="margin-bottom:.75rem">{error()}</div></Show>
            <div class="form-row">
              <label class="form-label">Name <span style="color:var(--red)">*</span></label>
              <input class="form-input" value={name()} onInput={e => setName(e.currentTarget.value)}
                placeholder="my-volume" required disabled={busy()} />
            </div>
            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Description</label>
              <input class="form-input" value={desc()} onInput={e => setDesc(e.currentTarget.value)}
                placeholder="Optional" disabled={busy()} />
            </div>
            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Config</label>
              <ConfigEditor entries={config()} busy={busy()} onChange={setConfig} />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" onClick={props.onClose} disabled={busy()}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={busy()}>{busy() ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Edit Volume modal ─────────────────────────────────────────────────────────

interface EditVolumeModalProps { pool: string; volume: StorageVolume; project: string; onClose: () => void; onSaved: () => void; }

function EditVolumeModal(props: EditVolumeModalProps) {
  const [desc,   setDesc]   = createSignal(props.volume.description ?? '');
  const [config, setConfig] = createSignal<KVEntry[]>(
    Object.entries(props.volume.config ?? {}).map(([k, v]) => ({ key: k, value: v }))
  );
  const [busy,  setBusy]  = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await updateStorageVolume(props.pool, props.volume.type, props.volume.name, { description: desc(), config: kvToRecord(config()) }, props.project);
      props.onSaved();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally { setBusy(false); }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('modal-backdrop')) props.onClose(); }}>
      <div class="modal" style="max-width:500px;max-height:90vh;overflow-y:auto">
        <div class="modal-header">
          <span class="modal-title">Edit Volume: {props.volume.name}</span>
          <button class="modal-close" onClick={props.onClose} disabled={busy()}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div class="modal-body">
            <Show when={error()}><div class="error" style="margin-bottom:.75rem">{error()}</div></Show>
            <div class="form-row">
              <label class="form-label">Description</label>
              <input class="form-input" value={desc()} onInput={e => setDesc(e.currentTarget.value)}
                placeholder="Optional" disabled={busy()} />
            </div>
            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Config</label>
              <ConfigEditor entries={config()} busy={busy()} onChange={setConfig} />
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" onClick={props.onClose} disabled={busy()}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={busy()}>{busy() ? 'Saving…' : 'Save Changes'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Storage() {
  const { project } = useProject();
  const { remote }  = useRemote();
  const { readOnly } = useRbac();

  const [pools, { refetch }] = createResource(
    () => ({ r: remote(), p: project() }),
    ({ r, p }) => {
      const url = p && p !== 'default'
        ? `${baseForRemote(r)}/storage-pools?recursion=1&project=${encodeURIComponent(p)}`
        : `${baseForRemote(r)}/storage-pools?recursion=1`;
      return fetch(url).then(res => res.json());
    },
  );

  const [selectedPool, setSelectedPool] = createSignal<string | null>(null);

  const [resources, { refetch: refetchRes }] = createResource(
    () => ({ r: remote(), pool: selectedPool(), p: project() }),
    ({ r, pool, p }) => {
      if (!pool) return null;
      const url = p && p !== 'default'
        ? `${baseForRemote(r)}/storage-pools/${encodeURIComponent(pool)}/resources?project=${encodeURIComponent(p)}`
        : `${baseForRemote(r)}/storage-pools/${encodeURIComponent(pool)}/resources`;
      return fetch(url).then(res => res.json());
    },
  );
  const [volumes, { refetch: refetchVol }] = createResource(
    () => ({ r: remote(), pool: selectedPool(), p: project() }),
    ({ r, pool, p }) => {
      if (!pool) return null;
      const url = p && p !== 'default'
        ? `${baseForRemote(r)}/storage-pools/${encodeURIComponent(pool)}/volumes?recursion=1&project=${encodeURIComponent(p)}`
        : `${baseForRemote(r)}/storage-pools/${encodeURIComponent(pool)}/volumes?recursion=1`;
      return fetch(url).then(res => res.json());
    },
  );

  const [selectedVol, setSelectedVol] = createSignal<StorageVolume | null>(null);

  // Volume snapshots
  const [volSnaps, { refetch: refetchVolSnaps }] = createResource(
    () => {
      const v = selectedVol();
      return v ? { r: remote(), pool: selectedPool()!, type: v.type, name: v.name, p: project() } : null;
    },
    (src) => {
      if (!src) return null;
      const { r, pool, type, name, p } = src;
      const pq = p && p !== 'default' ? `&project=${encodeURIComponent(p)}` : '';
      return fetch(`${baseForRemote(r)}/storage-pools/${encodeURIComponent(pool)}/volumes/${type}/${encodeURIComponent(name)}/snapshots?recursion=1${pq}`).then(res => res.json());
    },
  );
  const [volSnapBusy,    setVolSnapBusy]    = createSignal<string | null>(null);
  const [volSnapErr,     setVolSnapErr]     = createSignal<string | null>(null);
  const [newVolSnapName, setNewVolSnapName] = createSignal('');

  // Volume backups
  const [volBackups, { refetch: refetchVolBackups }] = createResource(
    () => {
      const v = selectedVol();
      return v ? { r: remote(), pool: selectedPool()!, type: v.type, name: v.name, p: project() } : null;
    },
    (src) => {
      if (!src) return null;
      const { r, pool, type, name, p } = src;
      const pq = p && p !== 'default' ? `&project=${encodeURIComponent(p)}` : '';
      return fetch(`${baseForRemote(r)}/storage-pools/${encodeURIComponent(pool)}/volumes/${type}/${encodeURIComponent(name)}/backups?recursion=1${pq}`).then(res => res.json());
    },
  );
  const [volBackupBusy,    setVolBackupBusy]    = createSignal<string | null>(null);
  const [volBackupErr,     setVolBackupErr]     = createSignal<string | null>(null);
  const [newVolBackupName, setNewVolBackupName] = createSignal('');

  const [showCreatePool, setShowCreatePool] = createSignal(false);
  const [editPool,       setEditPool]       = createSignal<StoragePool | null>(null);
  const [showCreateVol,  setShowCreateVol]  = createSignal(false);
  const [editVol,        setEditVol]        = createSignal<StorageVolume | null>(null);
  const [actionError,    setActionError]    = createSignal<string | null>(null);
  const [q, setQ] = createSignal('');

  const pool = () => pools()?.metadata?.find(p => p.name === selectedPool());
  const res  = () => resources()?.metadata;

  const filtered = () => {
    const rows = pools()?.metadata ?? [];
    const s = q().toLowerCase();
    if (!s) return rows;
    return rows.filter(p =>
      p.name.toLowerCase().includes(s) ||
      p.driver.toLowerCase().includes(s) ||
      p.status.toLowerCase().includes(s)
    );
  };

  function openPool(name: string) {
    setSelectedVol(null);
    setSelectedPool(p => p === name ? null : name);
  }

  function openVol(vol: StorageVolume) {
    setSelectedVol(v => v?.name === vol.name && v?.type === vol.type ? null : vol);
  }

  async function handleDeletePool(name: string) {
    setActionError(null);
    if (!confirm(`Delete pool "${name}"? This cannot be undone.`)) return;
    try {
      await deleteStoragePool(name);
      if (selectedPool() === name) { setSelectedPool(null); setSelectedVol(null); }
      refetch();
    } catch (err: any) { setActionError(err.message ?? String(err)); }
  }

  async function handleDeleteVolume(vol: StorageVolume) {
    setActionError(null);
    if (!confirm(`Delete volume "${vol.name}" (${vol.type})? This cannot be undone.`)) return;
    try {
      await deleteStorageVolume(selectedPool()!, vol.type, vol.name, project());
      if (selectedVol()?.name === vol.name) setSelectedVol(null);
      refetchVol();
    } catch (err: any) { setActionError(err.message ?? String(err)); }
  }

  async function handleVolSnapCreate() {
    const vol = selectedVol(); const pool = selectedPool();
    if (!vol || !pool) return;
    setVolSnapErr(null); setVolSnapBusy('create');
    try {
      const resp = await createVolumeSnapshot(pool, vol.type, vol.name, newVolSnapName().trim(), project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      setNewVolSnapName(''); refetchVolSnaps();
    } catch (e: any) { setVolSnapErr(e.message ?? String(e)); }
    finally { setVolSnapBusy(null); }
  }

  async function handleVolSnapRestore(snap: string) {
    const vol = selectedVol(); const pool = selectedPool();
    if (!vol || !pool) return;
    if (!confirm(`Restore volume "${vol.name}" to snapshot "${snap}"? Current state will be lost.`)) return;
    setVolSnapErr(null); setVolSnapBusy(`${snap}:restore`);
    try {
      const resp = await restoreVolumeSnapshot(pool, vol.type, vol.name, snap, project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      refetchVolSnaps();
    } catch (e: any) { setVolSnapErr(e.message ?? String(e)); }
    finally { setVolSnapBusy(null); }
  }

  async function handleVolSnapDelete(snap: string) {
    const vol = selectedVol(); const pool = selectedPool();
    if (!vol || !pool) return;
    if (!confirm(`Delete snapshot "${snap}"?`)) return;
    setVolSnapErr(null); setVolSnapBusy(`${snap}:delete`);
    try {
      const resp = await deleteVolumeSnapshot(pool, vol.type, vol.name, snap, project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      refetchVolSnaps();
    } catch (e: any) { setVolSnapErr(e.message ?? String(e)); }
    finally { setVolSnapBusy(null); }
  }

  async function handleVolBackupCreate() {
    const vol = selectedVol(); const pool = selectedPool();
    if (!vol || !pool) return;
    setVolBackupErr(null); setVolBackupBusy('create');
    try {
      const resp = await createVolumeBackup(pool, vol.type, vol.name, { name: newVolBackupName().trim() || undefined, optimized_storage: true }, project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      setNewVolBackupName(''); refetchVolBackups();
    } catch (e: any) { setVolBackupErr(e.message ?? String(e)); }
    finally { setVolBackupBusy(null); }
  }

  async function handleVolBackupDelete(backup: string) {
    const vol = selectedVol(); const pool = selectedPool();
    if (!vol || !pool) return;
    if (!confirm(`Delete backup "${backup}"?`)) return;
    setVolBackupErr(null); setVolBackupBusy(`${backup}:delete`);
    try {
      const resp = await deleteVolumeBackup(pool, vol.type, vol.name, backup, project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      refetchVolBackups();
    } catch (e: any) { setVolBackupErr(e.message ?? String(e)); }
    finally { setVolBackupBusy(null); }
  }

  function handleVolBackupDownload(backup: string) {
    const vol = selectedVol(); const pool = selectedPool();
    if (!vol || !pool) return;
    const url = downloadVolumeBackupUrl(pool, vol.type, vol.name, backup, project());
    const a = document.createElement('a'); a.href = url; a.download = `${vol.name}-${backup}.tar.gz`; a.click();
  }

  return (
    <div>
      <Show when={showCreatePool()}>
        <CreatePoolModal onClose={() => setShowCreatePool(false)} onSaved={() => { setShowCreatePool(false); refetch(); }} />
      </Show>
      <Show when={editPool()}>
        <EditPoolModal pool={editPool()!} onClose={() => setEditPool(null)} onSaved={() => { setEditPool(null); refetch(); }} />
      </Show>
      <Show when={showCreateVol() && !!selectedPool()}>
        <CreateVolumeModal pool={selectedPool()!} project={project()}
          onClose={() => setShowCreateVol(false)}
          onSaved={() => { setShowCreateVol(false); refetchVol(); }} />
      </Show>
      <Show when={editVol() && !!selectedPool()}>
        <EditVolumeModal pool={selectedPool()!} volume={editVol()!} project={project()}
          onClose={() => setEditVol(null)}
          onSaved={() => { setEditVol(null); setSelectedVol(null); refetchVol(); }} />
      </Show>

      <div class="card">
        <div class="card-header">
          <span>Storage Pools</span>
          <div class="card-toolbar">
            <input class="search-input" placeholder="Filter pools…" value={q()} onInput={e => setQ(e.currentTarget.value)} />
            <Show when={!readOnly()}>
              <button class="btn btn-sm btn-primary" onClick={() => setShowCreatePool(true)}>+ Create Pool</button>
            </Show>
            <button class="btn btn-sm" onClick={() => refetch()}>↻ Refresh</button>
          </div>
        </div>

        <Show when={actionError()}><div class="error" style="margin:.5rem 1rem">{actionError()}</div></Show>
        <Show when={pools.loading}><div class="loading">Loading…</div></Show>
        <Show when={pools.error}><div class="error">Failed to load storage pools</div></Show>

        <Show when={pools()}>
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Driver</th>
                <th>Status</th>
                <th>Source</th>
                <th>Used By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()} fallback={<tr><td colspan="6" class="empty">{q() ? 'No pools match your filter' : 'No storage pools'}</td></tr>}>
                {(p: StoragePool) => {
                  const isSelected = () => selectedPool() === p.name;
                  return (
                    <tr class={`row-clickable${isSelected() ? ' row-selected' : ''}`} onClick={() => openPool(p.name)}>
                      <td class="fw-medium">{p.name}</td>
                      <td>{p.driver}</td>
                      <td><span class={p.status === 'Created' ? 'badge badge-green' : 'badge badge-gray'}>{p.status}</span></td>
                      <td class="mono small">{p.config?.source ?? '—'}</td>
                      <td>{p.used_by?.length ?? 0}</td>
                      <td onClick={e => e.stopPropagation()} style="white-space:nowrap">
                        <Show when={!readOnly()}>
                          <button class="btn btn-sm" style="margin-right:.3rem" onClick={() => setEditPool(p)}>Edit</button>
                          <button class="btn btn-sm btn-danger" onClick={() => handleDeletePool(p.name)}>Delete</button>
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

      {/* Pool drawer */}
      <Drawer
        open={!!selectedPool()}
        title={`Pool: ${selectedPool() ?? ''}`}
        onClose={() => { setSelectedPool(null); setSelectedVol(null); }}
      >
        <Show when={pool()}>
          <div class="drawer-section">
            <div class="drawer-section-title" style="display:flex;justify-content:space-between;align-items:center">
              <span>Overview</span>
              <button class="btn btn-sm" onClick={() => setEditPool(pool()!)}>✎ Edit</button>
            </div>
            <div class="kv-list">
              <span class="kv-list-key">Driver</span>
              <span class="kv-list-val">{pool()!.driver}</span>
              <span class="kv-list-key">Status</span>
              <span class="kv-list-val"><span class={pool()!.status === 'Created' ? 'badge badge-green' : 'badge badge-gray'}>{pool()!.status}</span></span>
              <Show when={pool()!.description}>
                <span class="kv-list-key">Description</span>
                <span class="kv-list-val">{pool()!.description}</span>
              </Show>
              <span class="kv-list-key">Used By</span>
              <span class="kv-list-val">{pool()!.used_by?.length ?? 0}</span>
            </div>
          </div>

          <Show when={resources.loading}><div class="loading">Loading resources…</div></Show>
          <Show when={res()}>
            <div class="drawer-section">
              <div class="drawer-section-title">Space</div>
              <div class="kv-list">
                <span class="kv-list-key">Used</span>
                <span class="kv-list-val">{fmtBytes(res()!.space.used)}</span>
                <span class="kv-list-key">Total</span>
                <span class="kv-list-val">{fmtBytes(res()!.space.total)}</span>
                <span class="kv-list-key">Free</span>
                <span class="kv-list-val">{fmtBytes(res()!.space.total - res()!.space.used)}</span>
              </div>
              <div class="progress-bar" style={{ 'margin-top': '6px' }}>
                <div class="progress-fill" style={{ width: `${Math.round(res()!.space.used / res()!.space.total * 100)}%` }} />
              </div>
            </div>
          </Show>

          <div class="drawer-section">
            <div class="drawer-section-title">Config</div>
            <KVList entries={Object.entries(pool()!.config ?? {})} />
          </div>

          {/* Volumes */}
          <div class="drawer-section">
            <div class="drawer-section-title" style="display:flex;justify-content:space-between;align-items:center">
              <span>Volumes</span>
              <Show when={!readOnly()}>
                <button class="btn btn-sm btn-primary" onClick={() => setShowCreateVol(true)}>+ Create</button>
              </Show>
            </div>
            <Show when={volumes.loading}><div class="loading">Loading volumes…</div></Show>
            <Show when={!volumes.loading && (volumes()?.metadata?.length ?? 0) === 0}>
              <div class="drawer-empty">No volumes</div>
            </Show>
            <Show when={(volumes()?.metadata?.length ?? 0) > 0}>
              <table class="data-table" style={{ 'font-size': '.8rem' }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Content</th>
                    <th>Created</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  <For each={volumes()!.metadata}>
                    {(vol: StorageVolume) => {
                      const isSel = () => selectedVol()?.name === vol.name && selectedVol()?.type === vol.type;
                      return (
                        <tr class={`row-clickable${isSel() ? ' row-selected' : ''}`} onClick={() => openVol(vol)}>
                          <td class="fw-medium">{vol.name}</td>
                          <td>{vol.type}</td>
                          <td>{vol.content_type}</td>
                          <td>{vol.created_at ? new Date(vol.created_at).toLocaleDateString() : '—'}</td>
                          <td onClick={e => e.stopPropagation()} style="white-space:nowrap">
                            <Show when={!readOnly()}>
                              <button class="btn btn-sm" style="margin-right:.3rem" onClick={() => setEditVol(vol)}>Edit</button>
                              <Show when={vol.type === 'custom'}>
                                <button class="btn btn-sm btn-danger" onClick={() => handleDeleteVolume(vol)}>Delete</button>
                              </Show>
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
        </Show>
      </Drawer>

      {/* Volume detail drawer */}
      <Drawer
        open={!!selectedVol()}
        title={`Volume: ${selectedVol()?.name ?? ''}`}
        onClose={() => setSelectedVol(null)}
      >
        <Show when={selectedVol()}>
          <div class="drawer-section">
            <div class="drawer-section-title" style="display:flex;justify-content:space-between;align-items:center">
              <span>Overview</span>
              <button class="btn btn-sm" onClick={() => setEditVol(selectedVol()!)}>✎ Edit</button>
            </div>
            <div class="kv-list">
              <span class="kv-list-key">Pool</span>
              <span class="kv-list-val">{selectedVol()!.pool || selectedPool()}</span>
              <span class="kv-list-key">Type</span>
              <span class="kv-list-val">{selectedVol()!.type}</span>
              <span class="kv-list-key">Content</span>
              <span class="kv-list-val">{selectedVol()!.content_type}</span>
              <span class="kv-list-key">Created</span>
              <span class="kv-list-val">{fmtDate(selectedVol()!.created_at)}</span>
              <Show when={selectedVol()!.description}>
                <span class="kv-list-key">Description</span>
                <span class="kv-list-val">{selectedVol()!.description}</span>
              </Show>
              <span class="kv-list-key">Used By</span>
              <span class="kv-list-val">{selectedVol()!.used_by?.length ?? 0}</span>
            </div>
          </div>
          <div class="drawer-section">
            <div class="drawer-section-title">Config</div>
            <KVList entries={Object.entries(selectedVol()!.config ?? {})} />
          </div>
          <Show when={(selectedVol()!.used_by?.length ?? 0) > 0}>
            <div class="drawer-section">
              <div class="drawer-section-title">Used By</div>
              <div class="kv-list">
                <For each={selectedVol()!.used_by}>
                  {ref => (
                    <>
                      <span class="kv-list-key">ref</span>
                      <span class="kv-list-val">{ref.replace(/^\/1\.0\//, '')}</span>
                    </>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Volume Snapshots */}
          <div class="drawer-section">
            <div class="drawer-section-title">Snapshots</div>
            <Show when={volSnapErr()}>
              <div class="error" style="margin-bottom:.5rem;padding:.4rem .6rem">{volSnapErr()}</div>
            </Show>
            <div style="display:flex;gap:.5rem;margin-bottom:.75rem">
              <input class="form-input" style="flex:1;font-size:.82rem;padding:.3rem .5rem"
                placeholder="snapshot name (leave blank for auto)"
                value={newVolSnapName()} onInput={e => setNewVolSnapName(e.currentTarget.value)}
                disabled={!!volSnapBusy()} />
              <button class="btn btn-sm btn-primary" disabled={!!volSnapBusy()} onClick={handleVolSnapCreate}>
                {volSnapBusy() === 'create' ? 'Creating…' : '+ Snapshot'}
              </button>
            </div>
            <Show when={volSnaps.loading}><div class="loading">Loading…</div></Show>
            <Show when={!volSnaps.loading && (volSnaps()?.metadata?.length ?? 0) === 0}>
              <div class="drawer-empty">No snapshots</div>
            </Show>
            <Show when={(volSnaps()?.metadata?.length ?? 0) > 0}>
              <table class="data-table" style={{'font-size':'.8rem'}}>
                <thead><tr><th>Name</th><th>Created</th><th></th></tr></thead>
                <tbody>
                  <For each={volSnaps()!.metadata}>
                    {(snap: VolumeSnapshot) => {
                      const isRestoring = () => volSnapBusy() === `${snap.name}:restore`;
                      const isDeleting  = () => volSnapBusy() === `${snap.name}:delete`;
                      const isBusy      = () => !!volSnapBusy();
                      return (
                        <tr>
                          <td class="fw-medium">{snap.name}</td>
                          <td>{fmtDate(snap.created_at)}</td>
                          <td style="white-space:nowrap">
                            <button class="btn btn-sm" style="margin-right:.3rem" disabled={isBusy()} onClick={() => handleVolSnapRestore(snap.name)}>
                              {isRestoring() ? 'Restoring…' : '↩ Restore'}
                            </button>
                            <button class="btn btn-sm btn-danger" disabled={isBusy()} onClick={() => handleVolSnapDelete(snap.name)}>
                              {isDeleting() ? 'Deleting…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </Show>
          </div>

          {/* Volume Backups */}
          <div class="drawer-section">
            <div class="drawer-section-title">Backups</div>
            <Show when={volBackupErr()}>
              <div class="error" style="margin-bottom:.5rem;padding:.4rem .6rem">{volBackupErr()}</div>
            </Show>
            <div style="display:flex;gap:.5rem;margin-bottom:.75rem">
              <input class="form-input" style="flex:1;font-size:.82rem;padding:.3rem .5rem"
                placeholder="backup name (leave blank for auto)"
                value={newVolBackupName()} onInput={e => setNewVolBackupName(e.currentTarget.value)}
                disabled={!!volBackupBusy()} />
              <button class="btn btn-sm btn-primary" disabled={!!volBackupBusy()} onClick={handleVolBackupCreate}>
                {volBackupBusy() === 'create' ? 'Creating…' : '+ Backup'}
              </button>
            </div>
            <Show when={volBackups.loading}><div class="loading">Loading…</div></Show>
            <Show when={!volBackups.loading && (volBackups()?.metadata?.length ?? 0) === 0}>
              <div class="drawer-empty">No backups</div>
            </Show>
            <Show when={(volBackups()?.metadata?.length ?? 0) > 0}>
              <table class="data-table" style={{'font-size':'.8rem'}}>
                <thead><tr><th>Name</th><th>Created</th><th>Expires</th><th></th></tr></thead>
                <tbody>
                  <For each={volBackups()!.metadata}>
                    {(bk: VolumeBackup) => {
                      const isDeleting = () => volBackupBusy() === `${bk.name}:delete`;
                      const isBusy     = () => !!volBackupBusy();
                      return (
                        <tr>
                          <td class="fw-medium">{bk.name}</td>
                          <td>{fmtDate(bk.created_at)}</td>
                          <td>{fmtDate(bk.expires_at)}</td>
                          <td style="white-space:nowrap">
                            <button class="btn btn-sm" style="margin-right:.3rem" disabled={isBusy()} onClick={() => handleVolBackupDownload(bk.name)}>↓</button>
                            <button class="btn btn-sm btn-danger" disabled={isBusy()} onClick={() => handleVolBackupDelete(bk.name)}>
                              {isDeleting() ? 'Deleting…' : 'Delete'}
                            </button>
                          </td>
                        </tr>
                      );
                    }}
                  </For>
                </tbody>
              </table>
            </Show>
          </div>
        </Show>
      </Drawer>
    </div>
  );
}
