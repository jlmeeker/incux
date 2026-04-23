import { createResource, createSignal, For, Show, Index } from 'solid-js';
import { useNavigate } from '@solidjs/router';
import {
  getInstances, putInstanceState, deleteInstance, waitForOperation,
  patchInstance, renameInstance, copyInstance, migrateInstance,
  getProfiles, getClusterMembers,
  fmtDate, fmtBytes, baseForRemote,
  type Instance, type InstanceStatus, type InstanceAction,
} from '../api';
import { useProject } from '../ProjectContext';
import { useRemote } from '../RemoteContext';
import { useRbac } from '../RbacContext';
import { LaunchModal } from '../components/LaunchModal';
import { KNOWN_CONFIG_KEYS } from '../configKeys';

const INSTANCE_CONFIG_LIST_ID = 'instance-config-key-list';
function InstanceConfigKeyDatalist() {
  return (
    <datalist id={INSTANCE_CONFIG_LIST_ID}>
      <For each={KNOWN_CONFIG_KEYS}>
        {item => <option value={item.key}>{item.desc}</option>}
      </For>
    </datalist>
  );
}

// ── Shared helpers (exported for use in InstanceDetail) ───────────────────────

export function statusClass(s: InstanceStatus) {
  if (s === 'Running') return 'badge badge-green';
  if (s === 'Stopped') return 'badge badge-red';
  if (s === 'Frozen')  return 'badge badge-blue';
  return 'badge badge-gray';
}

export function KVList(props: { entries: [string, string][] }) {
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

// ── Resource Limits Section ───────────────────────────────────────────────────

export const LIMIT_FIELDS: { key: string; label: string; placeholder: string; hint: string; restartNote?: string }[] = [
  { key: 'limits.cpu',            label: 'CPU cores',      placeholder: 'e.g. 2 or 0-3',         hint: 'count or range; empty = unlimited',
    restartNote: 'VMs: pinned ranges (e.g. 0-3) require a restart. A plain count is hot-plugged but the guest OS may need to bring CPUs online.' },
  { key: 'limits.cpu.allowance',  label: 'CPU allowance',  placeholder: 'e.g. 50% or 10ms/50ms', hint: '% or period/quota; empty = unlimited (containers only)' },
  { key: 'limits.memory',         label: 'Memory',         placeholder: 'e.g. 512MB or 2GB',     hint: 'bytes with suffix; empty = unlimited',
    restartNote: 'VMs: increasing memory uses hotplug (max 16 slots before restart needed). Decreasing uses balloon device and may be slow.' },
  { key: 'limits.memory.swap',    label: 'Allow swap',     placeholder: 'true or false',          hint: 'set false to disable swap (containers only)' },
  { key: 'limits.memory.enforce', label: 'Memory enforce', placeholder: 'hard or soft',           hint: 'hard = OOM kill; soft = best-effort (containers only)' },
  { key: 'limits.processes',      label: 'Max processes',  placeholder: 'e.g. 500',               hint: 'count; empty = unlimited (containers only)' },
];

export interface LimitsSectionProps {
  instance: Instance;
  project: string;
  onSaved: () => void;
}

export function LimitsSection(props: LimitsSectionProps) {
  const cfg = () => props.instance.expanded_config ?? props.instance.config ?? {};
  const initial = () => LIMIT_FIELDS.reduce((acc, f) => {
    acc[f.key] = cfg()[f.key] ?? '';
    return acc;
  }, {} as Record<string, string>);

  const [values,      setValues]      = createSignal<Record<string, string>>(initial());
  const [busy,        setBusy]        = createSignal(false);
  const [error,       setError]       = createSignal<string | null>(null);
  const [success,     setSuccess]     = createSignal(false);
  const [restartHint, setRestartHint] = createSignal<string | null>(null);

  const resetValues = () => { setValues(initial()); setRestartHint(null); };

  async function save(e: Event) {
    e.preventDefault();
    setBusy(true); setError(null); setSuccess(false); setRestartHint(null);

    // Only PATCH keys that actually changed — don't send unchanged keys at all.
    // Sending an unchanged empty string can still trigger live-apply failures on VMs.
    const config: Record<string, string> = {};
    const notes: string[] = [];
    let hasChanges = false;

    for (const f of LIMIT_FIELDS) {
      const before = cfg()[f.key] ?? '';
      const after  = values()[f.key].trim();
      if (after === before) continue; // unchanged — skip entirely
      hasChanges = true;
      config[f.key] = after;

      if (f.restartNote) notes.push(f.restartNote);

      // Clearing a limit on a running instance is risky — warn explicitly
      if (after === '' && before !== '' && props.instance.status === 'Running') {
        notes.push(`Clearing "${f.label}" on a running instance may fail or require a stop/start to take effect.`);
      }
    }

    if (!hasChanges) {
      setBusy(false);
      return;
    }

    try {
      await patchInstance(props.instance.name, { config }, props.project);
      setSuccess(true);
      if (notes.length > 0) setRestartHint([...new Set(notes)].join(' '));
      props.onSaved();
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) { setError(err.message ?? String(err)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={save}>
      <Show when={error()}>
        <div class="error" style="margin-bottom:.5rem;padding:.4rem .6rem">{error()}</div>
      </Show>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:.5rem .75rem">
        <For each={LIMIT_FIELDS}>
          {f => (
            <div>
              <label class="form-label" style="font-size:.78rem;margin-bottom:.2rem">
                {f.label}
                <Show when={!!f.restartNote}>
                  <span title={f.restartNote} style="cursor:help;margin-left:.35rem;color:var(--yellow);font-size:.85rem">⚠</span>
                </Show>
              </label>
              <input class="form-input" style="font-size:.8rem;padding:.3rem .5rem"
                placeholder={f.placeholder} title={f.hint}
                value={values()[f.key]}
                onInput={e => setValues(v => ({ ...v, [f.key]: e.currentTarget.value }))}
                disabled={busy()} />
              <div class="form-hint">{f.hint}</div>
            </div>
          )}
        </For>
      </div>
      <div style="display:flex;gap:.5rem;margin-top:.75rem;align-items:center">
        <button type="submit" class="btn btn-sm btn-primary" disabled={busy()}>{busy() ? 'Saving…' : 'Apply Limits'}</button>
        <button type="button" class="btn btn-sm" onClick={resetValues} disabled={busy()}>Reset</button>
        <Show when={success()}><span class="badge badge-green" style="font-size:.75rem">Saved</span></Show>
      </div>
      <Show when={restartHint()}>
        <div class="info-banner" style="margin-top:.75rem;display:flex;gap:.5rem;align-items:flex-start">
          <span style="flex-shrink:0">⚠</span>
          <span>{restartHint()}</span>
        </div>
      </Show>
    </form>
  );
}

// ── Instance Edit (inline, not a modal) ───────────────────────────────────────

export interface KVEntry { key: string; value: string }
export function kvToRecord(entries: KVEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) if (e.key.trim()) out[e.key.trim()] = e.value;
  return out;
}

export const READ_ONLY_PREFIXES = ['volatile.', 'image.'];
export function isReadOnly(key: string) { return READ_ONLY_PREFIXES.some(p => key.startsWith(p)); }

export interface InstanceEditProps {
  instance: Instance;
  project: string;
  onSaved: (newName: string) => void;
}

export function InstanceEditSection(props: InstanceEditProps) {
  const { remote } = useRemote();
  const [allProfiles] = createResource(
    () => ({ r: remote(), p: props.project }),
    ({ r, p }) => {
      const url = p && p !== 'default'
        ? `${baseForRemote(r)}/profiles?recursion=1&project=${encodeURIComponent(p)}`
        : `${baseForRemote(r)}/profiles?recursion=1`;
      return fetch(url).then(res => res.json());
    },
  );

  const [newName,     setNewName]     = createSignal(props.instance.name);
  const [desc,        setDesc]        = createSignal(props.instance.description ?? '');
  const [selProfiles, setSelProfiles] = createSignal<string[]>([...(props.instance.profiles ?? [])]);

  const editableConfig = Object.entries(props.instance.config ?? {}).filter(([k]) => !isReadOnly(k));
  const [config, setConfig] = createSignal<KVEntry[]>(editableConfig.map(([k, v]) => ({ key: k, value: v })));
  const [devices, setDevices] = createSignal<Array<{ name: string; entries: KVEntry[] }>>(
    Object.entries(props.instance.devices ?? {}).map(([dn, dc]) => ({
      name: dn, entries: Object.entries(dc).map(([k, v]) => ({ key: k, value: v })),
    }))
  );

  const [busy,  setBusy]  = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [ok,    setOk]    = createSignal(false);

  const isStopped = () => props.instance.status === 'Stopped';
  function toggleProfile(name: string) { setSelProfiles(p => p.includes(name) ? p.filter(x => x !== name) : [...p, name]); }
  function addConfigRow()              { setConfig(c => [...c, { key: '', value: '' }]); }
  function removeConfigRow(i: number)  { setConfig(c => c.filter((_, idx) => idx !== i)); }
  function setConfigKey(i: number, k: string) { setConfig(c => c.map((e, idx) => idx === i ? { ...e, key: k }   : e)); }
  function setConfigVal(i: number, v: string) { setConfig(c => c.map((e, idx) => idx === i ? { ...e, value: v } : e)); }
  function addDevice()                 { setDevices(d => [...d, { name: '', entries: [{ key: 'type', value: '' }] }]); }
  function removeDevice(di: number)    { setDevices(d => d.filter((_, i) => i !== di)); }
  function setDeviceName(di: number, n: string) { setDevices(d => d.map((dev, i) => i === di ? { ...dev, name: n } : dev)); }
  function addDeviceRow(di: number)    { setDevices(d => d.map((dev, i) => i === di ? { ...dev, entries: [...dev.entries, { key: '', value: '' }] } : dev)); }
  function removeDeviceRow(di: number, ei: number) { setDevices(d => d.map((dev, i) => i === di ? { ...dev, entries: dev.entries.filter((_, j) => j !== ei) } : dev)); }
  function setDeviceKey(di: number, ei: number, k: string) { setDevices(d => d.map((dev, i) => i === di ? { ...dev, entries: dev.entries.map((e, j) => j === ei ? { ...e, key: k }   : e) } : dev)); }
  function setDeviceVal(di: number, ei: number, v: string) { setDevices(d => d.map((dev, i) => i === di ? { ...dev, entries: dev.entries.map((e, j) => j === ei ? { ...e, value: v } : e) } : dev)); }

  async function submit(ev: Event) {
    ev.preventDefault();
    setBusy(true); setError(null); setOk(false);
    const devRecord: Record<string, Record<string, string>> = {};
    for (const dev of devices()) if (dev.name.trim()) devRecord[dev.name.trim()] = kvToRecord(dev.entries);
    try {
      await patchInstance(props.instance.name, {
        description: desc(), config: kvToRecord(config()), profiles: selProfiles(), devices: devRecord,
      }, props.project);
      const trimmedName = newName().trim();
      if (trimmedName && trimmedName !== props.instance.name) {
        if (!isStopped()) throw new Error('Instance must be stopped before renaming.');
        const resp = await renameInstance(props.instance.name, trimmedName, props.project);
        if ((resp as any).operation) await waitForOperation((resp as any).operation);
        props.onSaved(trimmedName);
      } else {
        setOk(true);
        setTimeout(() => setOk(false), 2000);
        props.onSaved(props.instance.name);
      }
    } catch (e: any) { setError(e.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit}>
      <Show when={error()}><div class="error" style="margin-bottom:.75rem;padding:.5rem .75rem">{error()}</div></Show>

      {/* Name */}
      <div class="form-row" style="margin-bottom:.75rem">
        <label class="form-label">
          Name
          <Show when={!isStopped()}>
            <span class="muted small" style="margin-left:.4rem;font-weight:400">(stop instance to rename)</span>
          </Show>
        </label>
        <input class="form-input" value={newName()} onInput={e => setNewName(e.currentTarget.value)}
          disabled={busy() || !isStopped()} />
      </div>

      {/* Description */}
      <div class="form-row" style="margin-bottom:.75rem">
        <label class="form-label">Description</label>
        <input class="form-input" value={desc()} onInput={e => setDesc(e.currentTarget.value)}
          placeholder="Optional" disabled={busy()} />
      </div>

      {/* Profiles */}
      <div class="form-row" style="margin-bottom:.75rem">
        <label class="form-label">Profiles</label>
        <Show when={allProfiles.loading}><div class="muted small">Loading profiles…</div></Show>
        <div style="display:flex;flex-wrap:wrap;gap:.4rem;margin-top:.3rem">
          <For each={allProfiles()?.metadata ?? []}>
            {prof => (
              <label class={`profile-chip${selProfiles().includes(prof.name) ? ' selected' : ''}`}>
                <input type="checkbox" checked={selProfiles().includes(prof.name)}
                  onChange={() => toggleProfile(prof.name)} disabled={busy()} />
                {prof.name}
              </label>
            )}
          </For>
        </div>
      </div>

      {/* Config */}
      <div class="form-row" style="margin-bottom:.75rem">
        <label class="form-label">Config <span class="muted small">(volatile.* and image.* are read-only)</span></label>
        <InstanceConfigKeyDatalist />
        <Index each={config()}>
          {(entry, i) => (
            <div style="display:flex;gap:.5rem;margin-bottom:.4rem">
              <input class="form-input" style="flex:1" placeholder="key"
                list={INSTANCE_CONFIG_LIST_ID}
                value={entry().key} onInput={e => setConfigKey(i, e.currentTarget.value)} disabled={busy()} />
              <input class="form-input" style="flex:2" placeholder="value"
                value={entry().value} onInput={e => setConfigVal(i, e.currentTarget.value)} disabled={busy()} />
              <button type="button" class="btn btn-sm" onClick={() => removeConfigRow(i)} disabled={busy()}>✕</button>
            </div>
          )}
        </Index>
        <button type="button" class="btn btn-sm" onClick={addConfigRow} disabled={busy()} style="margin-top:.25rem">+ Add key</button>
      </div>

      {/* Devices */}
      <div class="form-row" style="margin-bottom:.75rem">
        <label class="form-label">Devices</label>
        <Index each={devices()}>
          {(dev, di) => (
            <div style="border:1px solid var(--border);border-radius:6px;padding:.6rem;margin-bottom:.6rem">
              <div style="display:flex;gap:.5rem;margin-bottom:.5rem;align-items:center">
                <input class="form-input" style="flex:1" placeholder="device name"
                  value={dev().name} onInput={e => setDeviceName(di, e.currentTarget.value)} disabled={busy()} />
                <button type="button" class="btn btn-sm btn-danger" onClick={() => removeDevice(di)} disabled={busy()}>Remove</button>
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
              <button type="button" class="btn btn-sm" onClick={() => addDeviceRow(di)} disabled={busy()} style="font-size:.75rem">+ Add key</button>
            </div>
          )}
        </Index>
        <button type="button" class="btn btn-sm" onClick={addDevice} disabled={busy()} style="margin-top:.25rem">+ Add device</button>
      </div>

      <div style="display:flex;align-items:center;gap:.5rem">
        <button type="submit" class="btn btn-primary" disabled={busy()}>{busy() ? 'Saving…' : 'Save Changes'}</button>
        <Show when={ok()}><span class="badge badge-green">Saved</span></Show>
      </div>
    </form>
  );
}

// ── Copy / Migrate Modal ──────────────────────────────────────────────────────

export interface CopyMigrateModalProps {
  instance: Instance;
  project: string;
  onClose: () => void;
  onDone: () => void;
}

export function CopyMigrateModal(props: CopyMigrateModalProps) {
  const { remote } = useRemote();
  const [members] = createResource(remote, r =>
    fetch(`${baseForRemote(r)}/cluster/members?recursion=1`).then(res => res.json()).catch(() => null)
  );
  const [mode,    setMode]    = createSignal<'copy' | 'migrate'>('copy');
  const [newName, setNewName] = createSignal(props.instance.name + '-copy');
  const [target,  setTarget]  = createSignal('');
  const [busy,    setBusy]    = createSignal(false);
  const [error,   setError]   = createSignal<string | null>(null);

  const memberNames = () => (members()?.metadata ?? []).map(m => m.server_name);

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode() === 'copy') {
        const resp = await copyInstance({
          name: newName().trim(),
          type: props.instance.type,
          source: { type: 'copy', source: props.instance.name, project: props.project },
        }, props.project);
        if ((resp as any).operation) await waitForOperation((resp as any).operation);
      } else {
        const resp = await migrateInstance(props.instance.name, target(), props.project);
        if ((resp as any).operation) await waitForOperation((resp as any).operation);
      }
      props.onDone();
    } catch (e: any) { setError(e.message ?? String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('modal-backdrop')) props.onClose(); }}>
      <div class="modal" style="max-width:460px">
        <div class="modal-header">
          <span class="modal-title">Copy / Migrate: {props.instance.name}</span>
          <button class="modal-close" onClick={props.onClose} disabled={busy()}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div class="modal-body">
            <Show when={error()}><div class="error" style="margin-bottom:.75rem">{error()}</div></Show>
            <Show when={props.instance.status !== 'Stopped'}>
              <div class="notice notice-warn" style="margin-bottom:.75rem">
                This instance is <strong>{props.instance.status}</strong>. It must be stopped before copying or migrating.
              </div>
            </Show>
            <div class="form-row">
              <label class="form-label">Action</label>
              <div style="display:flex;gap:.75rem;margin-top:.3rem">
                <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
                  <input type="radio" name="mode" checked={mode() === 'copy'} onChange={() => setMode('copy')} disabled={busy()} />
                  Copy (new instance)
                </label>
                <label style="display:flex;align-items:center;gap:.4rem;cursor:pointer">
                  <input type="radio" name="mode" checked={mode() === 'migrate'} onChange={() => setMode('migrate')} disabled={busy()} />
                  Migrate (move to member)
                </label>
              </div>
            </div>
            <Show when={mode() === 'copy'}>
              <div class="form-row" style="margin-top:.75rem">
                <label class="form-label">New name <span style="color:var(--red)">*</span></label>
                <input class="form-input" value={newName()} onInput={e => setNewName(e.currentTarget.value)} required disabled={busy()} />
              </div>
            </Show>
            <Show when={mode() === 'migrate'}>
              <div class="form-row" style="margin-top:.75rem">
                <label class="form-label">Target cluster member <span style="color:var(--red)">*</span></label>
                <Show when={memberNames().length > 0} fallback={
                  <input class="form-input" value={target()} onInput={e => setTarget(e.currentTarget.value)}
                    placeholder="member name" required disabled={busy()} />
                }>
                  <select class="form-input" value={target()} onChange={e => setTarget(e.currentTarget.value)} disabled={busy()}>
                    <option value="">— select member —</option>
                    <For each={memberNames()}>{m => <option value={m}>{m}</option>}</For>
                  </select>
                </Show>
              </div>
            </Show>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" onClick={props.onClose} disabled={busy()}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={busy() || (mode() === 'migrate' && !target()) || props.instance.status !== 'Stopped'}>
              {busy() ? (mode() === 'copy' ? 'Copying…' : 'Migrating…') : (mode() === 'copy' ? 'Copy' : 'Migrate')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Instance list page ────────────────────────────────────────────────────────

export default function Instances() {
  const { project } = useProject();
  const { remote }  = useRemote();
  const { readOnly } = useRbac();
  const navigate = useNavigate();
  const [instances, { refetch }] = createResource(
    () => ({ r: remote(), p: project() }),
    ({ r, p }) => {
      const url = p === '*'
        ? `${baseForRemote(r)}/instances?recursion=2&all-projects=true`
        : p && p !== 'default'
          ? `${baseForRemote(r)}/instances?recursion=2&project=${encodeURIComponent(p)}`
          : `${baseForRemote(r)}/instances?recursion=2`;
      return fetch(url).then(res => res.json());
    },
  );
  const [busy, setBusy] = createSignal<string | null>(null);
  const [err,  setErr]  = createSignal<string | null>(null);
  const [showLaunch, setShowLaunch] = createSignal(false);
  const [q, setQ] = createSignal('');

  const filtered = () => {
    const rows = instances()?.metadata ?? [];
    const s = q().toLowerCase();
    if (!s) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(s) ||
      r.status.toLowerCase().includes(s) ||
      r.type.toLowerCase().includes(s) ||
      (r.profiles ?? []).join(' ').toLowerCase().includes(s)
    );
  };

  async function action(name: string, act: InstanceAction) {
    setErr(null); setBusy(`${name}:${act}`);
    try {
      const resp = await putInstanceState(name, act, false, project());
      if (resp.operation) await waitForOperation(resp.operation);
      else await new Promise(r => setTimeout(r, 1200));
      await refetch();
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(null); }
  }

  async function remove(name: string) {
    if (!confirm(`Delete instance "${name}"? This cannot be undone.`)) return;
    setErr(null); setBusy(`${name}:delete`);
    try {
      const resp = await deleteInstance(name, project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      await refetch();
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(null); }
  }

  return (
    <div>
      <Show when={err()}>
        <div class="error-banner">
          {err()}
          <button class="btn btn-xs btn-ghost" onClick={() => setErr(null)}>✕</button>
        </div>
      </Show>

      <div class="card">
        <div class="card-header">
          <span>Instances</span>
          <div class="card-toolbar">
            <input class="search-input" placeholder="Filter instances…" value={q()} onInput={e => setQ(e.currentTarget.value)} />
            <button class="btn btn-sm" onClick={() => refetch()} disabled={!!busy()}>↻ Refresh</button>
            <Show when={!readOnly()}>
              <button class="btn btn-sm btn-primary" onClick={() => setShowLaunch(true)}>+ Launch</button>
            </Show>
          </div>
        </div>

        <Show when={instances.loading}><div class="loading">Loading…</div></Show>
        <Show when={instances.error}><div class="error">Failed to load instances</div></Show>

        <Show when={instances()}>
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <Show when={project() === '*'}><th>Project</th></Show>
                <th>Type</th>
                <th>Status</th>
                <th>IPv4</th>
                <th>Profiles</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()} fallback={
                <tr><td colspan={project() === '*' ? 8 : 7} class="empty">{q() ? 'No instances match your filter' : 'No instances — click + Launch to create one'}</td></tr>
              }>
                {(row: Instance) => {
                  const isBusy = () => busy()?.startsWith(row.name + ':') ?? false;
                  const ipv4 = () => {
                    const nets = row.state?.network;
                    if (!nets) return '—';
                    for (const iface of Object.values(nets)) {
                      const addr = iface.addresses?.find(a => a.family === 'inet' && a.scope === 'global');
                      if (addr) return addr.address;
                    }
                    return '—';
                  };
                  return (
                    <tr
                      class={`row-clickable${isBusy() ? ' row-busy' : ''}`}
                      onClick={() => {
                        const proj = row.project && row.project !== 'default' ? `?project=${encodeURIComponent(row.project)}` : '';
                        navigate(`/instances/${row.name}${proj}`);
                      }}
                    >
                      <td class="fw-medium">{row.name}</td>
                      <Show when={project() === '*'}>
                        <td class="muted small">{row.project ?? 'default'}</td>
                      </Show>
                      <td>{row.type}</td>
                      <td>
                        <span class={statusClass(row.status)}>{row.status}</span>
                        <Show when={isBusy()}><span class="spinner" /></Show>
                      </td>
                      <td class="mono">{ipv4()}</td>
                      <td class="muted small">{row.profiles?.join(', ') ?? '—'}</td>
                      <td>{fmtDate(row.created_at)}</td>
                      <td class="actions-cell" onClick={e => e.stopPropagation()}>
                        <Show when={!readOnly()}>
                          <Show when={row.status === 'Stopped'}>
                            <button class="btn btn-xs btn-green" disabled={isBusy()} onClick={() => action(row.name, 'start')}>▶ Start</button>
                          </Show>
                          <Show when={row.status === 'Running'}>
                            <button class="btn btn-xs btn-yellow" disabled={isBusy()} onClick={() => action(row.name, 'restart')}>↺ Restart</button>
                            <button class="btn btn-xs btn-red"    disabled={isBusy()} onClick={() => action(row.name, 'stop')}>■ Stop</button>
                          </Show>
                          <Show when={row.status === 'Frozen'}>
                            <button class="btn btn-xs btn-green" disabled={isBusy()} onClick={() => action(row.name, 'unfreeze')}>▶ Unfreeze</button>
                          </Show>
                          <button class="btn btn-xs btn-ghost" disabled={isBusy()} onClick={() => remove(row.name)} title="Delete">🗑</button>
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

      <Show when={showLaunch()}>
        <LaunchModal onClose={() => setShowLaunch(false)} onLaunched={() => { setShowLaunch(false); refetch(); }} />
      </Show>
    </div>
  );
}
