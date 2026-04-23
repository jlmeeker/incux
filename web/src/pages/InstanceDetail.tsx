import { createResource, createSignal, For, Show, Index } from 'solid-js';
import { useParams, useNavigate, useSearchParams, A } from '@solidjs/router';
import {
  getInstance, putInstanceState, deleteInstance, waitForOperation,
  getSnapshots, createSnapshot, deleteSnapshot, restoreSnapshot,
  getBackups, createBackup, deleteBackup, downloadBackupUrl,
  getInstanceFile, putInstanceFile,
  getInstanceLogs, getInstanceLog,
  getInstanceMetadata, updateInstanceMetadata,
  fmtDate, fmtBytes, baseForRemote,
  type Instance, type InstanceAction, type InstanceBackup, type InstanceMetadata,
} from '../api';
import { useProject } from '../ProjectContext';
import { useRemote }  from '../RemoteContext';
import { useRbac }    from '../RbacContext';
import { InstanceConsole } from '../components/InstanceConsole';
import { InstancePerf }   from '../components/InstancePerf';
import {
  statusClass, KVList,
  LimitsSection, InstanceEditSection,
  CopyMigrateModal,
} from './Instances';

// ── Tab definition ────────────────────────────────────────────────────────────

type Tab = 'config' | 'edit' | 'limits' | 'snapshots' | 'backups' | 'files' | 'logs' | 'metadata';
const TABS: { id: Tab; label: string }[] = [
  { id: 'config',    label: 'Config'          },
  { id: 'edit',      label: 'Edit'            },
  { id: 'limits',    label: 'Resource Limits' },
  { id: 'snapshots', label: 'Snapshots'       },
  { id: 'backups',   label: 'Backups'         },
  { id: 'files',     label: 'Files'           },
  { id: 'logs',      label: 'Logs'            },
  { id: 'metadata',  label: 'Metadata'        },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function InstanceDetail() {
  const params   = useParams<{ name: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { project: ctxProject } = useProject();
  const { remote }  = useRemote();
  const { readOnly } = useRbac();

  // ?project=<name> in the URL takes precedence — set when navigating from
  // the all-projects list so we always know the exact project for this instance.
  // Fall back to context project; if context is '*' (all), default to 'default'.
  const project = () => {
    if (searchParams.project) return searchParams.project;
    if (ctxProject() === '*') return 'default';
    return ctxProject();
  };

  const [detail, { refetch }] = createResource(
    () => ({ r: remote(), name: params.name, project: project() }),
    ({ r, name, project }) => {
      const pq = project && project !== 'default' ? `?project=${encodeURIComponent(project)}` : '';
      return fetch(`${baseForRemote(r)}/instances/${encodeURIComponent(name)}${pq}`).then(res => res.json());
    },
  );

  const inst = () => detail()?.metadata;

  // ── Lifecycle ──────────────────────────────────────────────────────────────
  const [actionBusy, setActionBusy] = createSignal<string | null>(null);
  const [actionErr,  setActionErr]  = createSignal<string | null>(null);

  async function doAction(act: InstanceAction | 'delete') {
    setActionErr(null);
    setActionBusy(act);
    try {
      if (act === 'delete') {
        if (!confirm(`Delete instance "${params.name}"? This cannot be undone.`)) return;
        const resp = await deleteInstance(params.name, project());
        if ((resp as any).operation) await waitForOperation((resp as any).operation);
        navigate('/instances');
        return;
      }
      const resp = await putInstanceState(params.name, act as InstanceAction, false, project());
      if (resp.operation) await waitForOperation(resp.operation);
      else await new Promise(r => setTimeout(r, 1200));
      await refetch();
    } catch (e: any) { setActionErr(e.message ?? String(e)); }
    finally { setActionBusy(null); }
  }

  // ── Tab state ──────────────────────────────────────────────────────────────
  const [tab, setTab] = createSignal<Tab>('config');

  // ── Console ────────────────────────────────────────────────────────────────
  const [consoleMode, setConsoleMode] = createSignal<'console' | 'exec'>('console');
  const [showConsole, setShowConsole] = createSignal(false);

  // ── Snapshots ──────────────────────────────────────────────────────────────
  const [snapshots, { refetch: refetchSnaps }] = createResource(
    () => ({ r: remote(), name: params.name, p: project() }),
    ({ r, name, p }) => {
      const pq = p && p !== 'default' ? `&project=${encodeURIComponent(p)}` : '';
      return fetch(`${baseForRemote(r)}/instances/${encodeURIComponent(name)}/snapshots?recursion=1${pq}`).then(res => res.json());
    },
  );
  const [snapBusy,    setSnapBusy]    = createSignal<string | null>(null);
  const [snapErr,     setSnapErr]     = createSignal<string | null>(null);
  const [newSnapName, setNewSnapName] = createSignal('');

  async function snapCreate() {
    setSnapErr(null); setSnapBusy('create');
    try {
      const resp = await createSnapshot(params.name, newSnapName().trim(), false, project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      setNewSnapName(''); refetchSnaps();
    } catch (e: any) { setSnapErr(e.message ?? String(e)); }
    finally { setSnapBusy(null); }
  }
  async function snapDelete(snap: string) {
    if (!confirm(`Delete snapshot "${snap}"?`)) return;
    setSnapErr(null); setSnapBusy(`${snap}:delete`);
    try {
      const resp = await deleteSnapshot(params.name, snap, project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      refetchSnaps();
    } catch (e: any) { setSnapErr(e.message ?? String(e)); }
    finally { setSnapBusy(null); }
  }
  async function snapRestore(snap: string) {
    if (!confirm(`Restore "${params.name}" to snapshot "${snap}"? Current state will be lost.`)) return;
    setSnapErr(null); setSnapBusy(`${snap}:restore`);
    try {
      const resp = await restoreSnapshot(params.name, snap, project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      refetchSnaps(); refetch();
    } catch (e: any) { setSnapErr(e.message ?? String(e)); }
    finally { setSnapBusy(null); }
  }

  // ── Backups ────────────────────────────────────────────────────────────────
  const [backups, { refetch: refetchBackups }] = createResource(
    () => ({ r: remote(), name: params.name, p: project() }),
    ({ r, name, p }) => {
      const pq = p && p !== 'default' ? `&project=${encodeURIComponent(p)}` : '';
      return fetch(`${baseForRemote(r)}/instances/${encodeURIComponent(name)}/backups?recursion=1${pq}`).then(res => res.json());
    },
  );
  const [backupBusy,    setBackupBusy]    = createSignal<string | null>(null);
  const [backupErr,     setBackupErr]     = createSignal<string | null>(null);
  const [newBackupName, setNewBackupName] = createSignal('');

  async function backupCreate() {
    setBackupErr(null); setBackupBusy('create');
    try {
      const resp = await createBackup(params.name, { name: newBackupName().trim() || undefined, instance_only: false, optimized_storage: true }, project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      setNewBackupName(''); refetchBackups();
    } catch (e: any) { setBackupErr(e.message ?? String(e)); }
    finally { setBackupBusy(null); }
  }
  async function backupDelete(name: string) {
    if (!confirm(`Delete backup "${name}"?`)) return;
    setBackupErr(null); setBackupBusy(`${name}:delete`);
    try {
      const resp = await deleteBackup(params.name, name, project());
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      refetchBackups();
    } catch (e: any) { setBackupErr(e.message ?? String(e)); }
    finally { setBackupBusy(null); }
  }
  function backupDownload(name: string) {
    const url = downloadBackupUrl(params.name, name, project());
    const a = document.createElement('a'); a.href = url; a.download = `${params.name}-${name}.tar.gz`; a.click();
  }

  // ── Files ──────────────────────────────────────────────────────────────────
  const [filePath,      setFilePath]      = createSignal('/');
  const [fileEntries,   setFileEntries]   = createSignal<string[]>([]);
  const [fileErr,       setFileErr]       = createSignal<string | null>(null);
  const [fileBusy,      setFileBusy]      = createSignal(false);
  const [uploadName,    setUploadName]    = createSignal('');
  const [uploadContent, setUploadContent] = createSignal('');

  async function fileBrowse(path: string) {
    setFileErr(null); setFileBusy(true);
    try {
      const res = await getInstanceFile(params.name, path, project());
      if (!res.ok) { setFileErr(`Error ${res.status}: ${res.statusText}`); return; }
      const ct = res.headers.get('Content-Type') ?? '';
      if (ct.includes('application/json')) {
        const data = await res.json() as { metadata: string[] };
        setFilePath(path); setFileEntries(data.metadata ?? []);
      } else {
        const blob = await res.blob();
        const fname = path.split('/').pop() ?? 'file';
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = fname; a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e: any) { setFileErr(e.message ?? String(e)); }
    finally { setFileBusy(false); }
  }
  async function fileUpload() {
    const fname = uploadName().trim();
    if (!fname) return;
    const destPath = (filePath().endsWith('/') ? filePath() : filePath() + '/') + fname;
    setFileErr(null); setFileBusy(true);
    try {
      const res = await putInstanceFile(params.name, destPath, uploadContent(), project());
      if (!res.ok) { const t = await res.text(); setFileErr(t); return; }
      setUploadName(''); setUploadContent(''); fileBrowse(filePath());
    } catch (e: any) { setFileErr(e.message ?? String(e)); }
    finally { setFileBusy(false); }
  }

  // ── Logs ───────────────────────────────────────────────────────────────────
  const [logs,       setLogs]       = createSignal<string[]>([]);
  const [logContent, setLogContent] = createSignal<string | null>(null);
  const [logFile,    setLogFile]    = createSignal<string | null>(null);
  const [logErr,     setLogErr]     = createSignal<string | null>(null);
  const [logBusy,    setLogBusy]    = createSignal(false);

  async function loadLogs() {
    setLogErr(null); setLogBusy(true); setLogContent(null); setLogFile(null);
    try {
      const res = await getInstanceLogs(params.name, project());
      setLogs((res.metadata ?? []).map((p: string) => p.split('/').pop() ?? p));
    } catch (e: any) { setLogErr(e.message ?? String(e)); }
    finally { setLogBusy(false); }
  }
  async function viewLog(filename: string) {
    setLogErr(null); setLogBusy(true); setLogContent(null);
    try {
      const res = await getInstanceLog(params.name, filename, project());
      if (!res.ok) { setLogErr(`Error ${res.status}`); return; }
      setLogFile(filename); setLogContent(await res.text());
    } catch (e: any) { setLogErr(e.message ?? String(e)); }
    finally { setLogBusy(false); }
  }

  // ── Metadata ───────────────────────────────────────────────────────────────
  const [metadata,    setMetadata]    = createSignal<InstanceMetadata | null>(null);
  const [metaErr,     setMetaErr]     = createSignal<string | null>(null);
  const [metaBusy,    setMetaBusy]    = createSignal(false);
  const [metaProps,   setMetaProps]   = createSignal<Array<{key:string;value:string}>>([]);
  const [metaEditing, setMetaEditing] = createSignal(false);

  async function loadMetadata() {
    setMetaErr(null); setMetaBusy(true);
    try {
      const res = await getInstanceMetadata(params.name, project());
      setMetadata(res.metadata);
      setMetaProps(Object.entries(res.metadata.properties ?? {}).map(([k, v]) => ({ key: k, value: v as string })));
    } catch (e: any) { setMetaErr(e.message ?? String(e)); }
    finally { setMetaBusy(false); }
  }
  async function saveMetadata() {
    const md = metadata();
    if (!md) return;
    setMetaErr(null); setMetaBusy(true);
    const props: Record<string, string> = {};
    for (const e of metaProps()) if (e.key.trim()) props[e.key.trim()] = e.value;
    try {
      await updateInstanceMetadata(params.name, { ...md, properties: props }, project());
      setMetaEditing(false); loadMetadata();
    } catch (e: any) { setMetaErr(e.message ?? String(e)); }
    finally { setMetaBusy(false); }
  }

  // ── Copy/migrate modal ─────────────────────────────────────────────────────
  const [showCopy, setShowCopy] = createSignal(false);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      {/* Header */}
      <div class="idet-header">
        <div class="idet-breadcrumb">
          <A href="/instances">← Instances</A>
          <span>/</span>
          <span>{params.name}</span>
        </div>
        <div class="idet-title-row">
          <span class="idet-name">{params.name}</span>
          <Show when={inst()}>
            <span class={statusClass(inst()!.status)}>{inst()!.status}</span>
            <Show when={inst()!.type === 'virtual-machine'}>
              <span class="badge badge-gray">VM</span>
            </Show>
          </Show>
          <div class="idet-actions">
            <Show when={!readOnly()}>
              <Show when={inst()?.status === 'Stopped'}>
                <button class="btn btn-sm btn-green" disabled={!!actionBusy()} onClick={() => doAction('start')}>
                  {actionBusy() === 'start' ? 'Starting…' : '▶ Start'}
                </button>
              </Show>
              <Show when={inst()?.status === 'Running'}>
                <button class="btn btn-sm btn-yellow" disabled={!!actionBusy()} onClick={() => doAction('restart')}>
                  {actionBusy() === 'restart' ? 'Restarting…' : '↺ Restart'}
                </button>
                <button class="btn btn-sm btn-red" disabled={!!actionBusy()} onClick={() => doAction('stop')}>
                  {actionBusy() === 'stop' ? 'Stopping…' : '■ Stop'}
                </button>
                <button class="btn btn-sm btn-yellow" disabled={!!actionBusy()} onClick={() => doAction('freeze')}>
                  {actionBusy() === 'freeze' ? 'Freezing…' : '❄ Freeze'}
                </button>
              </Show>
              <Show when={inst()?.status === 'Frozen'}>
                <button class="btn btn-sm btn-green" disabled={!!actionBusy()} onClick={() => doAction('unfreeze')}>
                  {actionBusy() === 'unfreeze' ? 'Unfreezing…' : '▶ Unfreeze'}
                </button>
              </Show>
              <Show when={inst()}>
                <button class="btn btn-sm" onClick={() => setShowCopy(true)}>⎘ Copy/Migrate</button>
              </Show>
              <button class="btn btn-sm btn-danger" disabled={!!actionBusy()} onClick={() => doAction('delete')}>
                {actionBusy() === 'delete' ? 'Deleting…' : '🗑 Delete'}
              </button>
            </Show>
            {/* Console/shell buttons visible to all — read-only users can still observe */}
            <Show when={inst()?.status === 'Running'}>
              <span style="width:1px;height:18px;background:var(--border);margin:0 2px" />
              <button class="btn btn-sm btn-blue"
                onClick={() => {
                  if (consoleMode() === 'console' && showConsole()) { setShowConsole(false); }
                  else { setShowConsole(false); setConsoleMode('console'); setTimeout(() => setShowConsole(true), 0); }
                }}>
                ⌨ Console
              </button>
              <button class="btn btn-sm btn-blue"
                onClick={() => {
                  if (consoleMode() === 'exec' && showConsole()) { setShowConsole(false); }
                  else { setShowConsole(false); setConsoleMode('exec'); setTimeout(() => setShowConsole(true), 0); }
                }}>
                $ Shell
              </button>
              <Show when={inst()!.type === 'virtual-machine'}>
                    <button class="btn btn-sm btn-purple"
                        onClick={() => window.open(`/instances/${inst()!.name}/vga?remote=${encodeURIComponent(remote())}&project=${encodeURIComponent(project())}`, '_blank', 'width=1280,height=800,menubar=no,toolbar=no')}>
                        ⬛ VGA
                </button>
              </Show>
            </Show>
            <button class="btn btn-sm" onClick={() => refetch()}>↻ Refresh</button>
          </div>
        </div>
        <Show when={actionErr()}>
          <div class="error-banner">{actionErr()} <button class="btn btn-xs btn-ghost" onClick={() => setActionErr(null)}>✕</button></div>
        </Show>
      </div>

      <Show when={detail.loading}><div class="loading">Loading instance…</div></Show>
      <Show when={detail.error}><div class="error">Failed to load instance: {String(detail.error)}</div></Show>

      <Show when={inst()}>
        {/* Two-column grid: overview left, perf+terminal right */}
        <div class="idet-grid">
          {/* Overview card */}
          <div class="card">
            <div class="card-header"><span>Overview</span></div>
            <div class="kv-list" style="border:none;border-radius:0">
              <span class="kv-list-key">Type</span>
              <span class="kv-list-val">{inst()!.type}</span>
              <span class="kv-list-key">Architecture</span>
              <span class="kv-list-val">{inst()!.architecture}</span>
              <span class="kv-list-key">Profiles</span>
              <span class="kv-list-val">{inst()!.profiles?.join(', ') || '—'}</span>
              <span class="kv-list-key">Created</span>
              <span class="kv-list-val">{fmtDate(inst()!.created_at)}</span>
              <span class="kv-list-key">Last used</span>
              <span class="kv-list-val">{fmtDate(inst()!.last_used_at)}</span>
              <Show when={inst()!.description}>
                <span class="kv-list-key">Description</span>
                <span class="kv-list-val">{inst()!.description}</span>
              </Show>
              {/* Network addresses */}
              <Show when={inst()!.state?.network}>
                <For each={Object.entries(inst()!.state!.network!)}>
                  {([iface, info]) => (
                    <For each={info.addresses?.filter(a => a.scope === 'global') ?? []}>
                      {addr => (
                        <>
                          <span class="kv-list-key">{iface} ({addr.family})</span>
                          <span class="kv-list-val mono">{addr.address}/{addr.netmask}</span>
                        </>
                      )}
                    </For>
                  )}
                </For>
              </Show>
              {/* Memory */}
              <Show when={inst()!.state?.memory?.total}>
                <span class="kv-list-key">Memory</span>
                <span class="kv-list-val">
                  {fmtBytes(inst()!.state!.memory!.usage)} / {fmtBytes(inst()!.state!.memory!.total)}
                </span>
              </Show>
            </div>
          </div>

          {/* Right column: performance only */}
          <div class="idet-right">
            <Show when={inst()!.status === 'Running'}>
              <div class="card">
                <div class="card-header"><span>Performance</span></div>
                <div style="padding:14px 16px">
                  <InstancePerf instanceName={inst()!.name} remote={remote()} project={project()} />
                </div>
              </div>
            </Show>
          </div>
        </div>

        {/* Inline console — expands below header when toggled */}
        <Show when={showConsole() && inst()!.status === 'Running'}>
          <div class="card" style="margin-bottom:20px">
            <div class="card-header">
              <div style="display:flex;gap:6px">
                <button class={`btn btn-xs${consoleMode()==='console'?' btn-primary':''}`} onClick={() => {
                  if (consoleMode() !== 'console') { setShowConsole(false); setConsoleMode('console'); setTimeout(() => setShowConsole(true), 0); }
                }}>⌨ TTY</button>
                <button class={`btn btn-xs${consoleMode()==='exec'?' btn-primary':''}`} onClick={() => {
                  if (consoleMode() !== 'exec') { setShowConsole(false); setConsoleMode('exec'); setTimeout(() => setShowConsole(true), 0); }
                }}>$ Shell</button>
              </div>
              <button class="btn btn-xs btn-ghost" onClick={() => setShowConsole(false)}>✕ Close</button>
            </div>
            <InstanceConsole instanceName={inst()!.name} mode={consoleMode()} remote={remote()} project={project()} />
          </div>
        </Show>

        {/* Tab bar */}
        <div class="idet-tabs">
          <For each={TABS}>
            {t => (
              <button
                class={`idet-tab${tab() === t.id ? ' active' : ''}`}
                onClick={() => setTab(t.id)}
              >{t.label}</button>
            )}
          </For>
        </div>

        {/* Tab content */}
        <div class="idet-tab-content">

          {/* ── Config ── */}
          <Show when={tab() === 'config'}>
            <div class="card">
              <div class="card-header"><span>Config</span></div>
              <div style="padding:16px">
                <KVList entries={Object.entries(inst()!.config ?? {})} />
              </div>
            </div>
            <Show when={Object.keys(inst()!.expanded_config ?? {}).length > Object.keys(inst()!.config ?? {}).length}>
              <div class="card">
                <div class="card-header"><span>Expanded Config <span class="muted small" style="font-weight:400">(includes profiles)</span></span></div>
                <div style="padding:16px">
                  <KVList entries={Object.entries(inst()!.expanded_config ?? {})} />
                </div>
              </div>
            </Show>
            <Show when={inst()!.state?.network}>
              <div class="card">
                <div class="card-header"><span>Network Interfaces</span></div>
                <div style="padding:16px;display:flex;flex-direction:column;gap:12px">
                  <For each={Object.entries(inst()!.state!.network!)}>
                    {([iface, info]) => (
                      <div>
                        <div class="muted small fw-medium" style="margin-bottom:6px">{iface}</div>
                        <div class="kv-list">
                          <For each={info.addresses ?? []}>
                            {addr => (<>
                              <span class="kv-list-key">{addr.family}</span>
                              <span class="kv-list-val">{addr.address}/{addr.netmask} <span class="muted">({addr.scope})</span></span>
                            </>)}
                          </For>
                          <span class="kv-list-key">RX / TX</span>
                          <span class="kv-list-val">{fmtBytes(info.counters?.bytes_received ?? 0)} / {fmtBytes(info.counters?.bytes_sent ?? 0)}</span>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>
          </Show>

          {/* ── Edit ── */}
          <Show when={tab() === 'edit'}>
            <div class="card">
              <div class="card-header"><span>Edit Instance</span></div>
              <div style="padding:20px">
                <InstanceEditSection
                  instance={inst()!}
                  project={project()}
                  onSaved={newName => {
                    if (newName !== params.name) navigate(`/instances/${newName}`);
                    else refetch();
                  }}
                />
              </div>
            </div>
          </Show>

          {/* ── Resource Limits ── */}
          <Show when={tab() === 'limits'}>
            <div class="card">
              <div class="card-header"><span>Resource Limits</span></div>
              <div style="padding:20px">
                <LimitsSection instance={inst()!} project={project()} onSaved={() => refetch()} />
              </div>
            </div>
          </Show>

          {/* ── Snapshots ── */}
          <Show when={tab() === 'snapshots'}>
            <div class="card">
              <div class="card-header"><span>Snapshots</span></div>
              <div style="padding:16px">
                <Show when={snapErr()}>
                  <div class="error" style="margin-bottom:.75rem;padding:.4rem .6rem">{snapErr()}</div>
                </Show>
                <div style="display:flex;gap:.5rem;margin-bottom:1rem">
                  <input class="form-input" style="flex:1" placeholder="snapshot name (leave blank for auto)"
                    value={newSnapName()} onInput={e => setNewSnapName(e.currentTarget.value)} disabled={!!snapBusy()} />
                  <button class="btn btn-primary" disabled={!!snapBusy()} onClick={snapCreate}>
                    {snapBusy() === 'create' ? 'Creating…' : '+ Snapshot'}
                  </button>
                </div>
                <Show when={snapshots.loading}><div class="loading">Loading…</div></Show>
                <Show when={!snapshots.loading && (snapshots()?.metadata?.length ?? 0) === 0}>
                  <div class="empty">No snapshots yet</div>
                </Show>
                <Show when={(snapshots()?.metadata?.length ?? 0) > 0}>
                  <table class="data-table">
                    <thead><tr><th>Name</th><th>Created</th><th>Stateful</th><th></th></tr></thead>
                    <tbody>
                      <For each={snapshots()!.metadata}>
                        {snap => {
                          const isDeleting  = () => snapBusy() === `${snap.name}:delete`;
                          const isRestoring = () => snapBusy() === `${snap.name}:restore`;
                          const isBusy      = () => !!snapBusy();
                          return (
                            <tr>
                              <td class="fw-medium">{snap.name}</td>
                              <td>{fmtDate(snap.created_at)}</td>
                              <td>{snap.stateful ? 'Yes' : 'No'}</td>
                              <td class="actions-cell">
                                <button class="btn btn-sm" disabled={isBusy()} onClick={() => snapRestore(snap.name)}>
                                  {isRestoring() ? 'Restoring…' : '↩ Restore'}
                                </button>
                                <button class="btn btn-sm btn-danger" disabled={isBusy()} onClick={() => snapDelete(snap.name)}>
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
            </div>
          </Show>

          {/* ── Backups ── */}
          <Show when={tab() === 'backups'}>
            <div class="card">
              <div class="card-header"><span>Backups</span></div>
              <div style="padding:16px">
                <Show when={backupErr()}>
                  <div class="error" style="margin-bottom:.75rem;padding:.4rem .6rem">{backupErr()}</div>
                </Show>
                <div style="display:flex;gap:.5rem;margin-bottom:1rem">
                  <input class="form-input" style="flex:1" placeholder="backup name (leave blank for auto)"
                    value={newBackupName()} onInput={e => setNewBackupName(e.currentTarget.value)} disabled={!!backupBusy()} />
                  <button class="btn btn-primary" disabled={!!backupBusy()} onClick={backupCreate}>
                    {backupBusy() === 'create' ? 'Creating…' : '+ Backup'}
                  </button>
                </div>
                <Show when={backups.loading}><div class="loading">Loading…</div></Show>
                <Show when={!backups.loading && (backups()?.metadata?.length ?? 0) === 0}>
                  <div class="empty">No backups yet</div>
                </Show>
                <Show when={(backups()?.metadata?.length ?? 0) > 0}>
                  <table class="data-table">
                    <thead><tr><th>Name</th><th>Created</th><th>Expires</th><th></th></tr></thead>
                    <tbody>
                      <For each={backups()!.metadata}>
                        {(bk: InstanceBackup) => {
                          const isDeleting = () => backupBusy() === `${bk.name}:delete`;
                          const isBusy     = () => !!backupBusy();
                          return (
                            <tr>
                              <td class="fw-medium">{bk.name}</td>
                              <td>{fmtDate(bk.created_at)}</td>
                              <td>{fmtDate(bk.expires_at)}</td>
                              <td class="actions-cell">
                                <button class="btn btn-sm" disabled={isBusy()} onClick={() => backupDownload(bk.name)}>↓ Download</button>
                                <button class="btn btn-sm btn-danger" disabled={isBusy()} onClick={() => backupDelete(bk.name)}>
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
            </div>
          </Show>

          {/* ── Files ── */}
          <Show when={tab() === 'files'}>
            <div class="card">
              <div class="card-header">
                <span>Files</span>
                <div class="card-toolbar">
                  <span class="mono small muted">{filePath()}</span>
                  <button class="btn btn-sm" disabled={fileBusy()} onClick={() => {
                    const parent = filePath().replace(/\/$/, '').split('/').slice(0,-1).join('/') || '/';
                    fileBrowse(parent);
                  }}>↑ Up</button>
                  <button class="btn btn-sm" disabled={fileBusy()} onClick={() => fileBrowse(filePath())}>↻ Refresh</button>
                </div>
              </div>
              <div style="padding:16px">
                <Show when={fileErr()}>
                  <div class="error" style="margin-bottom:.75rem;padding:.4rem .6rem">{fileErr()}</div>
                </Show>
                <Show when={fileBusy()}><div class="loading">Loading…</div></Show>
                <Show when={fileEntries().length === 0 && !fileBusy()}>
                  <div class="empty">
                    <button class="btn btn-sm" onClick={() => fileBrowse('/')}>Browse files</button>
                  </div>
                </Show>
                <Show when={fileEntries().length > 0}>
                  <table class="data-table">
                    <thead><tr><th>Name</th><th></th></tr></thead>
                    <tbody>
                      <For each={fileEntries()}>
                        {entry => {
                          const isDir = entry.endsWith('/');
                          const fullPath = (filePath().endsWith('/') ? filePath() : filePath() + '/') + entry;
                          return (
                            <tr class={isDir ? 'row-clickable' : ''} onClick={() => isDir && fileBrowse(fullPath)}>
                              <td><span style="margin-right:.5rem">{isDir ? '📁' : '📄'}</span><span class="mono">{entry}</span></td>
                              <td>
                                <Show when={!isDir}>
                                  <button class="btn btn-xs" onClick={e => { e.stopPropagation(); fileBrowse(fullPath); }}>↓ Download</button>
                                </Show>
                              </td>
                            </tr>
                          );
                        }}
                      </For>
                    </tbody>
                  </table>
                </Show>

                {/* Upload */}
                <div style="margin-top:1.5rem;padding-top:1rem;border-top:1px solid var(--border)">
                  <div class="form-label" style="margin-bottom:.5rem">Upload to {filePath()}</div>
                  <div style="display:flex;gap:.5rem;margin-bottom:.5rem">
                    <input class="form-input" style="flex:1" placeholder="filename"
                      value={uploadName()} onInput={e => setUploadName(e.currentTarget.value)} disabled={fileBusy()} />
                  </div>
                  <textarea class="form-input" style="resize:vertical;min-height:80px;font-family:monospace;font-size:.82rem"
                    placeholder="File content (text)" value={uploadContent()}
                    onInput={e => setUploadContent(e.currentTarget.value)} disabled={fileBusy()} />
                  <button class="btn btn-primary btn-sm" style="margin-top:.5rem"
                    disabled={fileBusy() || !uploadName().trim()} onClick={fileUpload}>
                    {fileBusy() ? 'Uploading…' : '↑ Upload'}
                  </button>
                </div>
              </div>
            </div>
          </Show>

          {/* ── Logs ── */}
          <Show when={tab() === 'logs'}>
            <div class="card">
              <div class="card-header">
                <span>Logs{logFile() ? ` — ${logFile()}` : ''}</span>
                <div class="card-toolbar">
                  <Show when={logFile()}>
                    <button class="btn btn-sm" onClick={() => { setLogContent(null); setLogFile(null); }}>← All logs</button>
                  </Show>
                  <button class="btn btn-sm" disabled={logBusy()} onClick={logFile() ? () => viewLog(logFile()!) : loadLogs}>
                    {logBusy() ? '…' : logs().length === 0 && !logContent() ? 'Load Logs' : '↻ Refresh'}
                  </button>
                </div>
              </div>
              <div style="padding:16px">
                <Show when={logErr()}>
                  <div class="error" style="margin-bottom:.75rem;padding:.4rem .6rem">{logErr()}</div>
                </Show>
                <Show when={logBusy()}><div class="loading">Loading…</div></Show>
                <Show when={!logContent() && logs().length > 0}>
                  <table class="data-table">
                    <thead><tr><th>File</th><th></th></tr></thead>
                    <tbody>
                      <For each={logs()}>
                        {file => (
                          <tr>
                            <td class="mono">{file}</td>
                            <td><button class="btn btn-sm" onClick={() => viewLog(file)}>View</button></td>
                          </tr>
                        )}
                      </For>
                    </tbody>
                  </table>
                </Show>
                <Show when={!logContent() && logs().length === 0 && !logBusy() && !logErr()}>
                  <div class="empty">Click "Load Logs" to list available log files</div>
                </Show>
                <Show when={logContent()}>
                  <pre style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius);padding:12px;font-size:.75rem;overflow:auto;max-height:60vh;white-space:pre-wrap;word-break:break-all">{logContent()}</pre>
                </Show>
              </div>
            </div>
          </Show>

          {/* ── Metadata ── */}
          <Show when={tab() === 'metadata'}>
            <div class="card">
              <div class="card-header">
                <span>Metadata</span>
                <div class="card-toolbar">
                  <Show when={!metadata()}>
                    <button class="btn btn-sm" disabled={metaBusy()} onClick={loadMetadata}>
                      {metaBusy() ? '…' : 'Load'}
                    </button>
                  </Show>
                  <Show when={metadata() && !metaEditing()}>
                    <button class="btn btn-sm" onClick={() => setMetaEditing(true)}>✎ Edit Properties</button>
                  </Show>
                  <Show when={metaEditing()}>
                    <button class="btn btn-sm" onClick={() => setMetaEditing(false)} disabled={metaBusy()}>Cancel</button>
                    <button class="btn btn-sm btn-primary" onClick={saveMetadata} disabled={metaBusy()}>
                      {metaBusy() ? 'Saving…' : 'Save'}
                    </button>
                  </Show>
                </div>
              </div>
              <div style="padding:16px">
                <Show when={metaErr()}>
                  <div class="error" style="margin-bottom:.75rem;padding:.4rem .6rem">{metaErr()}</div>
                </Show>
                <Show when={!metadata() && !metaBusy() && !metaErr()}>
                  <div class="empty">Click "Load" to read instance metadata</div>
                </Show>
                <Show when={metadata()}>
                  <div class="kv-list" style="margin-bottom:1.25rem">
                    <span class="kv-list-key">Architecture</span>
                    <span class="kv-list-val">{metadata()!.architecture}</span>
                    <span class="kv-list-key">Created</span>
                    <span class="kv-list-val">{metadata()!.creation_date ? new Date(metadata()!.creation_date * 1000).toLocaleDateString() : '—'}</span>
                    <span class="kv-list-key">Expires</span>
                    <span class="kv-list-val">{metadata()!.expiry_date ? new Date(metadata()!.expiry_date * 1000).toLocaleDateString() : '—'}</span>
                  </div>
                  <div class="form-label" style="margin-bottom:.5rem">Properties</div>
                  <Show when={!metaEditing()}>
                    <Show when={Object.keys(metadata()!.properties ?? {}).length > 0} fallback={<div class="muted small">No properties</div>}>
                      <KVList entries={Object.entries(metadata()!.properties ?? {})} />
                    </Show>
                  </Show>
                  <Show when={metaEditing()}>
                    <Index each={metaProps()}>
                      {(entry, i) => (
                        <div style="display:flex;gap:.5rem;margin-bottom:.4rem">
                          <input class="form-input" style="flex:1" placeholder="key"
                            value={entry().key} onInput={e => setMetaProps(p => p.map((x,j) => j===i?{...x,key:e.currentTarget.value}:x))} />
                          <input class="form-input" style="flex:2" placeholder="value"
                            value={entry().value} onInput={e => setMetaProps(p => p.map((x,j) => j===i?{...x,value:e.currentTarget.value}:x))} />
                          <button class="btn btn-sm" onClick={() => setMetaProps(p => p.filter((_,j) => j!==i))}>✕</button>
                        </div>
                      )}
                    </Index>
                    <button class="btn btn-sm" style="margin-top:.25rem" onClick={() => setMetaProps(p => [...p, {key:'',value:''}])}>+ Add property</button>
                  </Show>
                </Show>
              </div>
            </div>
          </Show>

        </div>{/* end tab content */}
      </Show>

      {/* Copy/migrate modal */}
      <Show when={showCopy() && inst()}>
        <CopyMigrateModal
          instance={inst()!}
          project={project()}
          onClose={() => setShowCopy(false)}
          onDone={() => { setShowCopy(false); navigate('/instances'); }}
        />
      </Show>
    </div>
  );
}
