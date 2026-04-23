import { createResource, createSignal, For, Show, Index } from 'solid-js';
import {
  getProfiles, getProfile, createProfile, updateProfile, deleteProfile,
  getInstances, baseForRemote,
  type Profile,
} from '../api';
import { useProject } from '../ProjectContext';
import { useRemote } from '../RemoteContext';
import { useRbac } from '../RbacContext';
import { Drawer } from '../components/Drawer';
import { KNOWN_CONFIG_KEYS } from '../configKeys';

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

// Datalist-backed config key input
const CONFIG_KEY_LIST_ID = 'profile-config-key-list';
function ConfigKeyDatalist() {
  return (
    <datalist id={CONFIG_KEY_LIST_ID}>
      <For each={KNOWN_CONFIG_KEYS}>
        {item => <option value={item.key}>{item.desc}</option>}
      </For>
    </datalist>
  );
}

// ── Create / Edit modal ───────────────────────────────────────────────────────

interface ProfileModalProps {
  existing?: Profile;
  project: string;
  onClose: () => void;
  onSaved: (runningInstancesAffected: string[]) => void;
}

function ProfileModal(props: ProfileModalProps) {
  const editing = () => !!props.existing;

  const [name,   setName]   = createSignal(props.existing?.name ?? '');
  const [desc,   setDesc]   = createSignal(props.existing?.description ?? '');
  const [config, setConfig] = createSignal<KVEntry[]>(
    Object.entries(props.existing?.config ?? {}).map(([k, v]) => ({ key: k, value: v }))
  );
  // Devices: list of { devName, entries: KVEntry[] }
  const [devices, setDevices] = createSignal<Array<{ name: string; entries: KVEntry[] }>>(
    Object.entries(props.existing?.devices ?? {}).map(([dn, dc]) => ({
      name: dn,
      entries: Object.entries(dc).map(([k, v]) => ({ key: k, value: v })),
    }))
  );
  const [busy,  setBusy]  = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  // Config helpers
  function addConfigRow() { setConfig(c => [...c, { key: '', value: '' }]); }
  function removeConfigRow(i: number) { setConfig(c => c.filter((_, idx) => idx !== i)); }
  function setConfigKey(i: number, k: string) { setConfig(c => c.map((e, idx) => idx === i ? { ...e, key: k }   : e)); }
  function setConfigVal(i: number, v: string) { setConfig(c => c.map((e, idx) => idx === i ? { ...e, value: v } : e)); }

  // Device helpers
  function addDevice() { setDevices(d => [...d, { name: '', entries: [{ key: 'type', value: '' }] }]); }
  function removeDevice(di: number) { setDevices(d => d.filter((_, idx) => idx !== di)); }
  function setDeviceName(di: number, n: string) { setDevices(d => d.map((dev, idx) => idx === di ? { ...dev, name: n } : dev)); }
  function addDeviceRow(di: number) { setDevices(d => d.map((dev, idx) => idx === di ? { ...dev, entries: [...dev.entries, { key: '', value: '' }] } : dev)); }
  function removeDeviceRow(di: number, ei: number) { setDevices(d => d.map((dev, idx) => idx === di ? { ...dev, entries: dev.entries.filter((_, eidx) => eidx !== ei) } : dev)); }
  function setDeviceKey(di: number, ei: number, k: string) { setDevices(d => d.map((dev, idx) => idx === di ? { ...dev, entries: dev.entries.map((e, eidx) => eidx === ei ? { ...e, key: k }   : e) } : dev)); }
  function setDeviceVal(di: number, ei: number, v: string) { setDevices(d => d.map((dev, idx) => idx === di ? { ...dev, entries: dev.entries.map((e, eidx) => eidx === ei ? { ...e, value: v } : e) } : dev)); }

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setError(null);
    const devRecord: Record<string, Record<string, string>> = {};
    for (const dev of devices()) {
      if (dev.name.trim()) devRecord[dev.name.trim()] = kvToRecord(dev.entries);
    }
    try {
      if (editing()) {
        await updateProfile(props.existing!.name, {
          description: desc(),
          config: kvToRecord(config()),
          devices: devRecord,
        }, props.project);

        // Determine which running instances use this profile
        const usedBy = props.existing!.used_by ?? [];
        const instanceNames = usedBy
          .map(u => u.replace(/^\/1\.0\/instances\//, ''))
          .filter(Boolean);

        let runningAffected: string[] = [];
        if (instanceNames.length > 0) {
          try {
            const all = await getInstances(props.project);
            const running = new Set(
              (all.metadata ?? [])
                .filter(i => i.status === 'Running')
                .map(i => i.name)
            );
            runningAffected = instanceNames.filter(n => running.has(n));
          } catch { /* best-effort */ }
        }

        props.onSaved(runningAffected);
      } else {
        await createProfile({
          name: name(),
          description: desc(),
          config: kvToRecord(config()),
          devices: devRecord,
        }, props.project);
        props.onSaved([]);
      }
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally { setBusy(false); }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('modal-backdrop')) props.onClose(); }}>
      <div class="modal" style="max-width:580px;max-height:90vh;overflow-y:auto">
        <div class="modal-header">
          <span class="modal-title">{editing() ? `Edit Profile: ${props.existing!.name}` : 'Create Profile'}</span>
          <button class="modal-close" onClick={props.onClose} disabled={busy()}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div class="modal-body">
            <Show when={error()}><div class="error" style="margin-bottom:.75rem">{error()}</div></Show>

            {/* Datalist for config key suggestions */}
            <ConfigKeyDatalist />

            <Show when={!editing()}>
              <div class="form-row">
                <label class="form-label">Name <span style="color:var(--red)">*</span></label>
                <input class="form-input" value={name()} onInput={e => setName(e.currentTarget.value)}
                  placeholder="my-profile" required disabled={busy()} />
              </div>
            </Show>

            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Description</label>
              <input class="form-input" value={desc()} onInput={e => setDesc(e.currentTarget.value)}
                placeholder="Optional" disabled={busy()} />
            </div>

            {/* Config */}
            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Config</label>
              <Index each={config()}>
                {(entry, i) => (
                  <div style="display:flex;gap:.5rem;margin-bottom:.4rem">
                    <input class="form-input" style="flex:1" placeholder="key"
                      list={CONFIG_KEY_LIST_ID}
                      value={entry().key} onInput={e => setConfigKey(i, e.currentTarget.value)} disabled={busy()} />
                    <input class="form-input" style="flex:2" placeholder="value"
                      value={entry().value} onInput={e => setConfigVal(i, e.currentTarget.value)} disabled={busy()} />
                    <button type="button" class="btn btn-sm" onClick={() => removeConfigRow(i)} disabled={busy()}>✕</button>
                  </div>
                )}
              </Index>
              <button type="button" class="btn btn-sm" onClick={addConfigRow} disabled={busy()} style="margin-top:.25rem">+ Add config key</button>
            </div>

            {/* Devices */}
            <div class="form-row" style="margin-top:1rem">
              <label class="form-label">Devices</label>
              <Index each={devices()}>
                {(dev, di) => (
                  <div style="border:1px solid var(--border);border-radius:6px;padding:.6rem;margin-bottom:.6rem">
                    <div style="display:flex;gap:.5rem;margin-bottom:.5rem;align-items:center">
                      <input class="form-input" style="flex:1" placeholder="device name"
                        value={dev().name} onInput={e => setDeviceName(di, e.currentTarget.value)} disabled={busy()} />
                      <button type="button" class="btn btn-sm btn-danger" onClick={() => removeDevice(di)} disabled={busy()}>Remove device</button>
                    </div>
                    <Index each={dev().entries}>
                      {(entry, ei) => (
                        <div style="display:flex;gap:.5rem;margin-bottom:.3rem">
                          <input class="form-input" style="flex:1;font-size:.8rem" placeholder="key"
                            value={entry().key} onInput={e => setDeviceKey(di, ei, e.currentTarget.value)} disabled={busy()} />
                          <input class="form-input" style="flex:2;font-size:.8rem" placeholder="value"
                            value={entry().value} onInput={e => setDeviceVal(di, ei, e.currentTarget.value)} disabled={busy()} />
                          <button type="button" class="btn btn-sm" onClick={() => removeDeviceRow(di, ei)} disabled={busy()}>✕</button>
                        </div>
                      )}
                    </Index>
                    <button type="button" class="btn btn-sm" onClick={() => addDeviceRow(di)} disabled={busy()} style="margin-top:.2rem;font-size:.75rem">+ Add key</button>
                  </div>
                )}
              </Index>
              <button type="button" class="btn btn-sm" onClick={addDevice} disabled={busy()} style="margin-top:.25rem">+ Add device</button>
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

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Profiles() {
  const { project } = useProject();
  const { remote }  = useRemote();
  const { readOnly } = useRbac();
  const [profiles, { refetch }] = createResource(
    () => ({ r: remote(), p: project() }),
    ({ r, p }) => {
      const url = p && p !== 'default'
        ? `${baseForRemote(r)}/profiles?recursion=1&project=${encodeURIComponent(p)}`
        : `${baseForRemote(r)}/profiles?recursion=1`;
      return fetch(url).then(res => res.json());
    },
  );
  const [selected, setSelected] = createSignal<string | null>(null);
  const [detail] = createResource(
    () => ({ r: remote(), name: selected(), p: project() }),
    ({ r, name, p }) => {
      if (!name) return null;
      const url = p && p !== 'default'
        ? `${baseForRemote(r)}/profiles/${encodeURIComponent(name)}?project=${encodeURIComponent(p)}`
        : `${baseForRemote(r)}/profiles/${encodeURIComponent(name)}`;
      return fetch(url).then(res => res.json());
    },
  );

  const [showCreate,    setShowCreate]    = createSignal(false);
  const [editTarget,    setEditTarget]    = createSignal<Profile | null>(null);
  const [actionError,   setActionError]   = createSignal<string | null>(null);
  const [restartWarn,   setRestartWarn]   = createSignal<string[] | null>(null);
  const [q, setQ] = createSignal('');

  const profile = () => detail()?.metadata;

  const filtered = () => {
    const rows = profiles()?.metadata ?? [];
    const s = q().toLowerCase();
    if (!s) return rows;
    return rows.filter(p =>
      p.name.toLowerCase().includes(s) ||
      (p.description ?? '').toLowerCase().includes(s)
    );
  };

  async function handleDelete(name: string) {
    setActionError(null);
    if (!confirm(`Delete profile "${name}"? This cannot be undone.`)) return;
    try {
      await deleteProfile(name, project());
      if (selected() === name) setSelected(null);
      refetch();
    } catch (err: any) { setActionError(err.message ?? String(err)); }
  }

  return (
    <div>
      <Show when={showCreate()}>
        <ProfileModal
          project={project()}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); refetch(); }}
        />
      </Show>
      <Show when={editTarget()}>
        <ProfileModal
          existing={editTarget()!}
          project={project()}
          onClose={() => setEditTarget(null)}
          onSaved={running => {
            setEditTarget(null);
            refetch();
            if (running.length > 0) setRestartWarn(running);
          }}
        />
      </Show>

      <Show when={restartWarn()}>
        <div class="info-banner" style="display:flex;align-items:flex-start;gap:.75rem;margin-bottom:16px">
          <span style="flex-shrink:0;font-size:1rem">⚠</span>
          <div style="flex:1">
            <strong>Restart required</strong> — profile changes do not apply to running instances until they are restarted.
            The following instance{restartWarn()!.length > 1 ? 's are' : ' is'} currently running and will need a restart:{' '}
            <strong>{restartWarn()!.join(', ')}</strong>
          </div>
          <button class="btn btn-xs btn-ghost" onClick={() => setRestartWarn(null)}>✕</button>
        </div>
      </Show>

      <div class="card">
        <div class="card-header">
          <span>Profiles</span>
          <div class="card-toolbar">
            <input class="search-input" placeholder="Filter profiles…" value={q()} onInput={e => setQ(e.currentTarget.value)} />
            <Show when={!readOnly()}>
              <button class="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>+ Create</button>
            </Show>
            <button class="btn btn-sm" onClick={() => refetch()}>↻ Refresh</button>
          </div>
        </div>

        <Show when={actionError()}><div class="error" style="margin:.5rem 1rem">{actionError()}</div></Show>
        <Show when={profiles.loading}><div class="loading">Loading…</div></Show>
        <Show when={profiles.error}><div class="error">Failed to load profiles</div></Show>

        <Show when={profiles()}>
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Config Keys</th>
                <th>Devices</th>
                <th>Used By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()} fallback={<tr><td colspan="6" class="empty">{q() ? 'No profiles match your filter' : 'No profiles'}</td></tr>}>
                {(p: Profile) => {
                  const isSelected = () => selected() === p.name;
                  return (
                    <tr
                      class={`row-clickable${isSelected() ? ' row-selected' : ''}`}
                      onClick={() => isSelected() ? setSelected(null) : setSelected(p.name)}
                    >
                      <td class="fw-medium">{p.name}</td>
                      <td>{p.description || '—'}</td>
                      <td>{Object.keys(p.config ?? {}).length}</td>
                      <td>{Object.keys(p.devices ?? {}).join(', ') || '—'}</td>
                      <td>{p.used_by?.length ?? 0}</td>
                      <td onClick={e => e.stopPropagation()} style="white-space:nowrap">
                        <Show when={!readOnly()}>
                          <button class="btn btn-sm" style="margin-right:.3rem"
                            onClick={() => setEditTarget(p)}>Edit</button>
                          <Show when={p.name !== 'default'}>
                            <button class="btn btn-sm btn-danger"
                              onClick={() => handleDelete(p.name)}>Delete</button>
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

      <Drawer
        open={!!selected()}
        title={`Profile: ${selected() ?? ''}`}
        onClose={() => setSelected(null)}
      >
        <Show when={detail.loading}><div class="loading">Loading…</div></Show>
        <Show when={detail.error}><div class="error">Failed to load profile</div></Show>
        <Show when={profile()}>
          <Show when={profile()!.description}>
            <div class="drawer-section">
              <div class="drawer-section-title">Description</div>
              <div>{profile()!.description}</div>
            </div>
          </Show>

          <div class="drawer-section">
            <div class="drawer-section-title">Config</div>
            <KVList entries={Object.entries(profile()!.config ?? {})} />
          </div>

          <div class="drawer-section">
            <div class="drawer-section-title">Devices</div>
            <Show when={Object.keys(profile()!.devices ?? {}).length > 0} fallback={<div class="drawer-empty">No devices</div>}>
              <For each={Object.entries(profile()!.devices ?? {})}>
                {([devName, devConfig]) => (
                  <div style={{ 'margin-bottom': '10px' }}>
                    <div class="muted small" style={{ 'margin-bottom': '4px', 'font-weight': '600' }}>{devName}</div>
                    <KVList entries={Object.entries(devConfig)} />
                  </div>
                )}
              </For>
            </Show>
          </div>

          <div class="drawer-section">
            <div class="drawer-section-title">Used By</div>
            <Show when={(profile()!.used_by?.length ?? 0) > 0} fallback={<div class="drawer-empty">Not in use</div>}>
              <div class="kv-list">
                <For each={profile()!.used_by ?? []}>
                  {ref => (
                    <>
                      <span class="kv-list-key">instance</span>
                      <span class="kv-list-val">{ref.replace(/^\/1\.0\/instances\//, '')}</span>
                    </>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Show>
      </Drawer>
    </div>
  );
}
