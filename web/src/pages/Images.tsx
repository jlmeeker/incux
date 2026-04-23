import { createResource, createSignal, For, Show } from 'solid-js';
import { getImages, deleteImage, fmtBytes, fmtDate, baseForRemote, type Image } from '../api';
import { useProject } from '../ProjectContext';
import { useRemote } from '../RemoteContext';
import { useRbac } from '../RbacContext';
import { Drawer } from '../components/Drawer';

export default function Images() {
  const { project } = useProject();
  const { remote }  = useRemote();
  const { readOnly } = useRbac();
  const [images, { refetch }] = createResource(
    () => ({ r: remote(), p: project() }),
    ({ r, p }) => {
      const url = p && p !== 'default'
        ? `${baseForRemote(r)}/images?recursion=1&project=${encodeURIComponent(p)}`
        : `${baseForRemote(r)}/images?recursion=1`;
      return fetch(url).then(res => res.json());
    },
  );
  const [busy,     setBusy]   = createSignal<string | null>(null);
  const [err,      setErr]    = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<Image | null>(null);
  const [q, setQ] = createSignal('');

  async function remove(fp: string) {
    if (!confirm(`Delete image ${fp.slice(0, 12)}…?`)) return;
    setErr(null);
    setBusy(fp);
    try {
      await deleteImage(fp, project());
      if (selected()?.fingerprint === fp) setSelected(null);
      await refetch();
    } catch (e: any) { setErr(e.message ?? String(e)); }
    finally { setBusy(null); }
  }

  const img = () => selected();

  const filtered = () => {
    const rows = images()?.metadata ?? [];
    const s = q().toLowerCase();
    if (!s) return rows;
    return rows.filter(i =>
      (i.aliases?.[0]?.name ?? '').toLowerCase().includes(s) ||
      (i.properties?.description ?? '').toLowerCase().includes(s) ||
      (i.properties?.os ?? '').toLowerCase().includes(s) ||
      (i.properties?.release ?? '').toLowerCase().includes(s) ||
      i.fingerprint.toLowerCase().includes(s)
    );
  };

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
          <span>Local Images</span>
          <div class="card-toolbar">
            <input class="search-input" placeholder="Filter images…" value={q()} onInput={e => setQ(e.currentTarget.value)} />
            <button class="btn btn-sm" onClick={() => refetch()}>↻ Refresh</button>
          </div>
        </div>

        <Show when={images.loading}><div class="loading">Loading…</div></Show>
        <Show when={images.error}><div class="error">Failed to load images</div></Show>

        <Show when={images()}>
          <table class="data-table">
            <thead>
              <tr>
                <th>Alias / Description</th>
                <th>Fingerprint</th>
                <th>OS</th>
                <th>Architecture</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <For each={filtered()} fallback={<tr><td colspan="7" class="empty">{q() ? 'No images match your filter' : 'No images'}</td></tr>}>
                {(i: Image) => {
                  const label = () => i.aliases?.[0]?.name ?? i.properties?.description ?? '—';
                  const os    = () => [i.properties?.os, i.properties?.release].filter(Boolean).join(' ') || '—';
                  const isSel = () => selected()?.fingerprint === i.fingerprint;
                  return (
                    <tr
                      class={`row-clickable${isSel() ? ' row-selected' : ''}`}
                      onClick={() => isSel() ? setSelected(null) : setSelected(i)}
                    >
                      <td>{label()}</td>
                      <td class="mono small">{i.fingerprint.slice(0, 12)}</td>
                      <td>{os()}</td>
                      <td>{i.architecture}</td>
                      <td>{fmtBytes(i.size)}</td>
                      <td>{fmtDate(i.uploaded_at)}</td>
                      <td onClick={e => e.stopPropagation()}>
                        <button
                          class="btn btn-xs btn-ghost"
                          disabled={busy() === i.fingerprint}
                          onClick={() => remove(i.fingerprint)}
                        >✕</button>
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
        title={img()?.aliases?.[0]?.name ?? img()?.fingerprint?.slice(0, 12) ?? ''}
        onClose={() => setSelected(null)}
      >
        <Show when={img()}>
          {/* Overview */}
          <div class="drawer-section">
            <div class="drawer-section-title">Overview</div>
            <div class="kv-list">
              <span class="kv-list-key">Fingerprint</span>
              <span class="kv-list-val mono">{img()!.fingerprint}</span>
              <span class="kv-list-key">Architecture</span>
              <span class="kv-list-val">{img()!.architecture}</span>
              <span class="kv-list-key">Type</span>
              <span class="kv-list-val">{img()!.type || '—'}</span>
              <span class="kv-list-key">Size</span>
              <span class="kv-list-val">{fmtBytes(img()!.size)}</span>
              <span class="kv-list-key">Public</span>
              <span class="kv-list-val">{img()!.public ? 'Yes' : 'No'}</span>
              <span class="kv-list-key">Cached</span>
              <span class="kv-list-val">{img()!.cached ? 'Yes' : 'No'}</span>
              <span class="kv-list-key">Created</span>
              <span class="kv-list-val">{fmtDate(img()!.created_at)}</span>
              <span class="kv-list-key">Uploaded</span>
              <span class="kv-list-val">{fmtDate(img()!.uploaded_at)}</span>
            </div>
          </div>

          {/* Aliases */}
          <Show when={(img()!.aliases?.length ?? 0) > 0}>
            <div class="drawer-section">
              <div class="drawer-section-title">Aliases</div>
              <div class="kv-list">
                <For each={img()!.aliases}>
                  {a => (
                    <>
                      <span class="kv-list-key mono">{a.name}</span>
                      <span class="kv-list-val">{a.description || '—'}</span>
                    </>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Properties */}
          <Show when={Object.keys(img()!.properties ?? {}).length > 0}>
            <div class="drawer-section">
              <div class="drawer-section-title">Properties</div>
              <div class="kv-list">
                <For each={Object.entries(img()!.properties ?? {})}>
                  {([k, v]) => (
                    <>
                      <span class="kv-list-key">{k}</span>
                      <span class="kv-list-val">{v}</span>
                    </>
                  )}
                </For>
              </div>
            </div>
          </Show>

          {/* Delete */}
          <Show when={!readOnly()}>
            <div class="drawer-section">
              <button
                class="btn btn-red"
                disabled={busy() === img()!.fingerprint}
                onClick={() => remove(img()!.fingerprint)}
              >
                Delete image
              </button>
            </div>
          </Show>
        </Show>
      </Drawer>
    </div>
  );
}
