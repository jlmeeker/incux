import { createResource, createSignal, For, Show, Index } from 'solid-js';
import {
  getProjects, createProject, updateProject, deleteProject,
  baseForRemote,
  type Project,
} from '../api';
import { Drawer } from '../components/Drawer';
import { useRemote } from '../RemoteContext';
import { useRbac } from '../RbacContext';

interface KVEntry { key: string; value: string }
function kvToRecord(entries: KVEntry[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) if (e.key.trim()) out[e.key.trim()] = e.value;
  return out;
}

function KVList(props: { entries: [string, string][] }) {
  return (
    <Show when={props.entries.length > 0} fallback={<div class="drawer-empty">—</div>}>
      <div class="kv-list">
        <For each={props.entries}>
          {([k, v]) => (<><span class="kv-list-key">{k}</span><span class="kv-list-val mono small">{v}</span></>)}
        </For>
      </div>
    </Show>
  );
}

// ── Feature config checkboxes ─────────────────────────────────────────────────

const FEATURES: { key: string; label: string }[] = [
  { key: 'features.images',           label: 'Images (own image list)' },
  { key: 'features.networks',         label: 'Networks (own networks)' },
  { key: 'features.networks.zones',   label: 'Network zones' },
  { key: 'features.profiles',         label: 'Profiles (own profiles)' },
  { key: 'features.storage.volumes',  label: 'Storage volumes' },
  { key: 'features.storage.buckets',  label: 'Storage buckets' },
];

interface ProjectModalProps {
  existing?: Project;
  onClose: () => void;
  onSaved: () => void;
}

function ProjectModal(props: ProjectModalProps) {
  const editing = () => !!props.existing;

  const [name,   setName]   = createSignal(props.existing?.name ?? '');
  const [desc,   setDesc]   = createSignal(props.existing?.description ?? '');
  // Feature flags — default all on for new projects
  const defaultFeatures = () => {
    const cfg = props.existing?.config ?? {};
    return FEATURES.reduce((acc, f) => {
      acc[f.key] = cfg[f.key] !== 'false';
      return acc;
    }, {} as Record<string, boolean>);
  };
  const [features, setFeatures] = createSignal<Record<string, boolean>>(defaultFeatures());
  // Extra config KV pairs (non-feature keys)
  const [extra, setExtra] = createSignal<KVEntry[]>(
    Object.entries(props.existing?.config ?? {})
      .filter(([k]) => !FEATURES.some(f => f.key === k))
      .map(([k, v]) => ({ key: k, value: v }))
  );

  const [busy,  setBusy]  = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  function toggleFeature(key: string) {
    setFeatures(f => ({ ...f, [key]: !f[key] }));
  }
  function addExtra()    { setExtra(e => [...e, { key: '', value: '' }]); }
  function removeExtra(i: number) { setExtra(e => e.filter((_, idx) => idx !== i)); }
  function setExtraKey(i: number, k: string) { setExtra(e => e.map((en, idx) => idx === i ? { ...en, key: k }   : en)); }
  function setExtraVal(i: number, v: string) { setExtra(e => e.map((en, idx) => idx === i ? { ...en, value: v } : en)); }

  async function submit(ev: Event) {
    ev.preventDefault();
    setBusy(true); setError(null);
    const config: Record<string, string> = {};
    for (const f of FEATURES) config[f.key] = features()[f.key] ? 'true' : 'false';
    for (const e of extra()) if (e.key.trim()) config[e.key.trim()] = e.value;
    try {
      if (editing()) {
        await updateProject(props.existing!.name, { description: desc(), config });
      } else {
        await createProject({ name: name(), description: desc(), config });
      }
      props.onSaved();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally { setBusy(false); }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('modal-backdrop')) props.onClose(); }}>
      <div class="modal" style="max-width:520px">
        <div class="modal-header">
          <span class="modal-title">{editing() ? `Edit Project: ${props.existing!.name}` : 'Create Project'}</span>
          <button class="modal-close" onClick={props.onClose} disabled={busy()}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div class="modal-body">
            <Show when={error()}><div class="error" style="margin-bottom:.75rem">{error()}</div></Show>

            <Show when={!editing()}>
              <div class="form-row">
                <label class="form-label">Name <span style="color:var(--red)">*</span></label>
                <input class="form-input" value={name()} onInput={e => setName(e.currentTarget.value)}
                  placeholder="my-project" required disabled={busy()} />
              </div>
            </Show>

            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Description</label>
              <input class="form-input" value={desc()} onInput={e => setDesc(e.currentTarget.value)}
                placeholder="Optional" disabled={busy()} />
            </div>

            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Features</label>
              <div style="display:flex;flex-direction:column;gap:.35rem;margin-top:.25rem">
                <For each={FEATURES}>
                  {f => (
                    <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer;font-size:.85rem">
                      <input type="checkbox" checked={features()[f.key]}
                        onChange={() => toggleFeature(f.key)} disabled={busy()} />
                      {f.label}
                    </label>
                  )}
                </For>
              </div>
            </div>

            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Extra Config</label>
              <Index each={extra()}>
                {(entry, i) => (
                  <div style="display:flex;gap:.5rem;margin-bottom:.4rem">
                    <input class="form-input" style="flex:1" placeholder="key"
                      value={entry().key} onInput={e => setExtraKey(i, e.currentTarget.value)} disabled={busy()} />
                    <input class="form-input" style="flex:2" placeholder="value"
                      value={entry().value} onInput={e => setExtraVal(i, e.currentTarget.value)} disabled={busy()} />
                    <button type="button" class="btn btn-sm" onClick={() => removeExtra(i)} disabled={busy()}>✕</button>
                  </div>
                )}
              </Index>
              <button type="button" class="btn btn-sm" onClick={addExtra} disabled={busy()} style="margin-top:.25rem">+ Add key</button>
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

export default function Projects() {
  const { remote } = useRemote();
  const { readOnly } = useRbac();
  const [projects, { refetch }] = createResource(remote, r =>
    fetch(`${baseForRemote(r)}/projects?recursion=1`).then(res => res.json())
  );
  const [selected,    setSelected]    = createSignal<string | null>(null);
  const [showCreate,  setShowCreate]  = createSignal(false);
  const [editTarget,  setEditTarget]  = createSignal<Project | null>(null);
  const [actionError, setActionError] = createSignal<string | null>(null);
  const [q, setQ] = createSignal('');

  const project = () => projects()?.metadata?.find(p => p.name === selected());

  const filtered = () => {
    const rows = projects()?.metadata ?? [];
    const s = q().toLowerCase();
    if (!s) return rows;
    return rows.filter(p =>
      p.name.toLowerCase().includes(s) ||
      (p.description ?? '').toLowerCase().includes(s)
    );
  };

  async function handleDelete(name: string) {
    setActionError(null);
    if (!confirm(`Delete project "${name}"? All resources within it will be lost.`)) return;
    try {
      await deleteProject(name);
      if (selected() === name) setSelected(null);
      refetch();
    } catch (err: any) { setActionError(err.message ?? String(err)); }
  }

  return (
    <div>
      <Show when={showCreate()}>
        <ProjectModal onClose={() => setShowCreate(false)} onSaved={() => { setShowCreate(false); refetch(); }} />
      </Show>
      <Show when={editTarget()}>
        <ProjectModal existing={editTarget()!} onClose={() => setEditTarget(null)} onSaved={() => { setEditTarget(null); refetch(); }} />
      </Show>

      <div class="card">
        <div class="card-header">
          <span>Projects</span>
          <div class="card-toolbar">
            <input class="search-input" placeholder="Filter projects…" value={q()} onInput={e => setQ(e.currentTarget.value)} />
            <Show when={!readOnly()}>
              <button class="btn btn-sm btn-primary" onClick={() => setShowCreate(true)}>+ Create</button>
            </Show>
            <button class="btn btn-sm" onClick={() => refetch()}>↻ Refresh</button>
          </div>
        </div>

        <Show when={actionError()}><div class="error" style="margin:.5rem 1rem">{actionError()}</div></Show>
        <Show when={projects.loading}><div class="loading">Loading…</div></Show>
        <Show when={projects.error}><div class="error">Failed to load projects</div></Show>

        <Show when={projects()}>
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Description</th>
                <th>Used By</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()} fallback={<tr><td colspan="4" class="empty">{q() ? 'No projects match your filter' : 'No projects'}</td></tr>}>
                {(proj: Project) => {
                  const isSel = () => selected() === proj.name;
                  return (
                    <tr
                      class={`row-clickable${isSel() ? ' row-selected' : ''}`}
                      onClick={() => isSel() ? setSelected(null) : setSelected(proj.name)}
                    >
                      <td class="fw-medium">{proj.name}</td>
                      <td>{proj.description || '—'}</td>
                      <td>{proj.used_by?.length ?? 0}</td>
                      <td onClick={e => e.stopPropagation()} style="white-space:nowrap">
                        <Show when={!readOnly()}>
                          <button class="btn btn-sm" style="margin-right:.3rem"
                            onClick={() => setEditTarget(proj)}>Edit</button>
                          <Show when={proj.name !== 'default'}>
                            <button class="btn btn-sm btn-danger"
                              onClick={() => handleDelete(proj.name)}>Delete</button>
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
        title={`Project: ${selected() ?? ''}`}
        onClose={() => setSelected(null)}
      >
        <Show when={project()}>
          <div class="drawer-section">
            <div class="drawer-section-title">Overview</div>
            <div class="kv-list">
              <Show when={project()!.description}>
                <span class="kv-list-key">Description</span>
                <span class="kv-list-val">{project()!.description}</span>
              </Show>
              <span class="kv-list-key">Used By</span>
              <span class="kv-list-val">{project()!.used_by?.length ?? 0} resource(s)</span>
            </div>
          </div>

          <div class="drawer-section">
            <div class="drawer-section-title">Features</div>
            <div class="kv-list">
              <For each={FEATURES}>
                {f => (
                  <>
                    <span class="kv-list-key small">{f.label}</span>
                    <span class="kv-list-val">
                      <span class={project()!.config?.[f.key] === 'false' ? 'badge badge-gray' : 'badge badge-green'}>
                        {project()!.config?.[f.key] === 'false' ? 'Inherited' : 'Own'}
                      </span>
                    </span>
                  </>
                )}
              </For>
            </div>
          </div>

          <div class="drawer-section">
            <div class="drawer-section-title">Config</div>
            <KVList entries={Object.entries(project()!.config ?? {}).filter(([k]) => !FEATURES.some(f => f.key === k))} />
          </div>

          <Show when={(project()!.used_by?.length ?? 0) > 0}>
            <div class="drawer-section">
              <div class="drawer-section-title">Used By</div>
              <div class="kv-list">
                <For each={project()!.used_by}>
                  {ref => {
                    const parts = ref.replace(/^\/1\.0\//, '').split('/');
                    return (
                      <>
                        <span class="kv-list-key">{parts[0]}</span>
                        <span class="kv-list-val">{parts.slice(1).join('/') || ref}</span>
                      </>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>
        </Show>
      </Drawer>
    </div>
  );
}
