import { createResource, createSignal, createMemo, For, Show, Index } from 'solid-js';
import {
  getImageAliases, getImages, getProfiles,
  createInstance, waitForOperation, putInstanceState,
  type Image, type Profile,
} from '../api';
import { useProject } from '../ProjectContext';
import { Combobox, type ComboOption } from './Combobox';

interface ConfigEntry { key: string; value: string }
interface LaunchModalProps { onClose: () => void; onLaunched: () => void; }

export function LaunchModal(props: LaunchModalProps) {
  const { project } = useProject();
  const [localAliases] = createResource(() => getImageAliases(project()));
  const [localImages]  = createResource(() => getImages(project()));
  const [profiles]     = createResource(() => getProfiles(project()));

  // Build combobox options from local images only.
  // Users can type any "remote:alias" (e.g. "images:ubuntu/24.04") and Incus
  // will resolve it natively — no need to fetch remote alias lists here.
  const imageOptions = createMemo<ComboOption[]>(() => {
    const opts: ComboOption[] = [];
    const seen = new Set<string>();

    for (const a of localAliases()?.metadata ?? []) {
      if (seen.has(a.name)) continue;
      seen.add(a.name);
      opts.push({ value: a.name, label: a.name, sub: a.description ? `${a.description} · local` : 'local' });
    }

    for (const img of localImages()?.metadata ?? []) {
      const os   = img.properties?.os ?? '';
      const rel  = img.properties?.release ?? '';
      const desc = img.properties?.description ?? '';
      const humanLabel = desc || [os, rel].filter(Boolean).join(' ');

      for (const alias of img.aliases ?? []) {
        if (seen.has(alias.name)) continue;
        seen.add(alias.name);
        opts.push({
          value: alias.name,
          label: humanLabel ? `${alias.name} — ${humanLabel}` : alias.name,
          sub: 'local',
        });
      }
      if ((img.aliases?.length ?? 0) === 0 && !seen.has(img.fingerprint)) {
        seen.add(img.fingerprint);
        opts.push({
          value: img.fingerprint,
          label: humanLabel || img.fingerprint.slice(0, 12),
          sub: 'local · ' + img.fingerprint.slice(0, 12),
        });
      }
    }

    return opts;
  });

  const [srcMode,     setSrcMode]     = createSignal<'alias' | 'fingerprint' | 'url'>('alias');
  const [name,        setName]        = createSignal('');
  const [instType,    setInstType]    = createSignal<'container' | 'virtual-machine'>('container');
  const [imgAlias,    setImgAlias]    = createSignal('');
  const [imgFP,       setImgFP]       = createSignal('');
  const [imgURL,      setImgURL]      = createSignal('');
  const [selProfiles, setSelProfiles] = createSignal<string[]>(['default']);
  const [ephemeral,   setEphemeral]   = createSignal(false);
  const [autoStart,   setAutoStart]   = createSignal(true);
  const [configRows,  setConfigRows]  = createSignal<ConfigEntry[]>([]);
  const [submitting,  setSubmitting]  = createSignal(false);
  const [progress,    setProgress]    = createSignal('');
  const [err,         setErr]         = createSignal('');

  function toggleProfile(p: string) {
    setSelProfiles(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);
  }
  function addConfigRow() { setConfigRows(r => [...r, { key: '', value: '' }]); }
  function removeRow(i: number) { setConfigRows(r => r.filter((_, idx) => idx !== i)); }
  function setRowKey(i: number, k: string) { setConfigRows(r => r.map((e, idx) => idx === i ? { ...e, key: k } : e)); }
  function setRowVal(i: number, v: string) { setConfigRows(r => r.map((e, idx) => idx === i ? { ...e, value: v } : e)); }

  async function submit(e: Event) {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      // Build source — pass alias straight to Incus. It handles both local
      // aliases and remote-prefixed ones like "images:ubuntu/24.04" natively.
      let source: Record<string, string>;
      if (srcMode() === 'fingerprint') {
        const fp = imgFP().trim();
        if (!fp) throw new Error('Please enter an image fingerprint.');
        source = { type: 'image', fingerprint: fp };
      } else if (srcMode() === 'url') {
        const u = imgURL().trim();
        if (!u) throw new Error('Please enter a remote URL.');
        source = { type: 'url', url: u };
      } else {
        const alias = imgAlias().trim();
        if (!alias) throw new Error('Please select or type an image.');
        source = { type: 'image', alias };
      }

      const config: Record<string, string> = {};
      for (const row of configRows()) {
        if (row.key.trim()) config[row.key.trim()] = row.value;
      }

      setProgress('Creating instance…');
      const resp = await createInstance({
        name:      name().trim() || undefined,
        type:      instType(),
        ephemeral: ephemeral(),
        profiles:  selProfiles(),
        source,
        ...(Object.keys(config).length ? { config } : {}),
      }, project());

      const opUrl = (resp as any).operation as string | undefined;
      let instName = name().trim();
      if (opUrl) {
        setProgress('Waiting for instance to be created…');
        const op = await waitForOperation(opUrl);
        if (!instName) {
          const ref = op.resources?.instances?.[0] ?? op.resources?.containers?.[0] ?? '';
          instName = ref.replace(/^\/1\.0\/(instances|containers)\//, '');
        }
      }

      if (autoStart() && instName) {
        setProgress(`Starting ${instName}…`);
        const startResp = await putInstanceState(instName, 'start', false, project());
        const startOp = (startResp as any).operation as string | undefined;
        if (startOp) await waitForOperation(startOp);
      }

      setProgress('');
      props.onLaunched();
    } catch (e: any) {
      setErr(e.message ?? String(e));
      setProgress('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('modal-backdrop')) props.onClose(); }}>
      <div class="modal" role="dialog" aria-modal="true" aria-label="Launch instance">
        <div class="modal-header">
          <span class="modal-title">Launch Instance</span>
          <button class="modal-close" onClick={props.onClose} disabled={submitting()}>✕</button>
        </div>

        <form class="modal-body" onSubmit={submit}>
          <Show when={err()}>
            <div class="error-banner">{err()}</div>
          </Show>
          <Show when={progress()}>
            <div class="info-banner">{progress()}</div>
          </Show>

          {/* ── Basic ── */}
          <fieldset class="form-section">
            <legend>Basic</legend>
            <div class="form-row">
              <label class="form-label">Name <span class="muted">(optional)</span></label>
              <input class="form-input" type="text" placeholder="auto-generated if blank"
                value={name()} onInput={e => setName(e.currentTarget.value)} disabled={submitting()} />
            </div>
            <div class="form-row">
              <label class="form-label">Type</label>
              <div class="radio-group">
                <label class="radio-label">
                  <input type="radio" name="instType" value="container"
                    checked={instType() === 'container'} onChange={() => setInstType('container')} disabled={submitting()} />
                  Container
                </label>
                <label class="radio-label">
                  <input type="radio" name="instType" value="virtual-machine"
                    checked={instType() === 'virtual-machine'} onChange={() => setInstType('virtual-machine')} disabled={submitting()} />
                  Virtual Machine
                </label>
              </div>
            </div>
            <div class="form-row">
              <label class="form-label">
                <input type="checkbox" checked={ephemeral()} onChange={e => setEphemeral(e.currentTarget.checked)} disabled={submitting()} />
                {' '}Ephemeral (deleted on stop)
              </label>
            </div>
            <div class="form-row">
              <label class="form-label">
                <input type="checkbox" checked={autoStart()} onChange={e => setAutoStart(e.currentTarget.checked)} disabled={submitting()} />
                {' '}Start after creation
              </label>
            </div>
          </fieldset>

          {/* ── Image ── */}
          <fieldset class="form-section">
            <legend>Image</legend>
            <div class="form-row">
              <div class="tab-row">
                {(['alias', 'fingerprint', 'url'] as const).map(m => (
                  <button type="button" class={`tab-btn${srcMode() === m ? ' active' : ''}`}
                    onClick={() => setSrcMode(m)} disabled={submitting()}>
                    {m === 'alias' ? 'Alias / Name' : m === 'fingerprint' ? 'Fingerprint' : 'Remote URL'}
                  </button>
                ))}
              </div>
            </div>

            <Show when={srcMode() === 'alias'}>
              <div class="form-row">
                <label class="form-label">Image</label>
                <Combobox
                  options={imageOptions()}
                  value={imgAlias()}
                  onChange={setImgAlias}
                  placeholder="images:ubuntu/24.04, alpine/edge, …"
                  loading={localAliases.loading}
                  disabled={submitting()}
                />
                <span class="form-hint">
                  Local aliases shown above. Prefix with a remote name to pull from it,
                  e.g. <code>images:ubuntu/24.04</code>, <code>ubuntu:24.04</code>.
                </span>
              </div>
            </Show>

            <Show when={srcMode() === 'fingerprint'}>
              <div class="form-row">
                <label class="form-label">Fingerprint</label>
                <input class="form-input mono" type="text" placeholder="sha256 fingerprint"
                  value={imgFP()} onInput={e => setImgFP(e.currentTarget.value)} disabled={submitting()} />
              </div>
            </Show>

            <Show when={srcMode() === 'url'}>
              <div class="form-row">
                <label class="form-label">Remote URL</label>
                <input class="form-input" type="url" placeholder="https://images.linuxcontainers.org"
                  value={imgURL()} onInput={e => setImgURL(e.currentTarget.value)} disabled={submitting()} />
              </div>
            </Show>
          </fieldset>

          {/* ── Profiles ── */}
          <fieldset class="form-section">
            <legend>Profiles</legend>
            <Show when={profiles.loading}><div class="muted small">Loading profiles…</div></Show>
            <div class="profile-grid">
              <For each={profiles()?.metadata ?? []}>
                {(p: Profile) => (
                  <label class={`profile-chip${selProfiles().includes(p.name) ? ' selected' : ''}`}>
                    <input type="checkbox" checked={selProfiles().includes(p.name)}
                      onChange={() => toggleProfile(p.name)} disabled={submitting()} />
                    {p.name}
                  </label>
                )}
              </For>
            </div>
            <Show when={(profiles()?.metadata?.length ?? 0) === 0 && !profiles.loading}>
              <div class="muted small">No profiles found</div>
            </Show>
          </fieldset>

          {/* ── Extra config ── */}
          <fieldset class="form-section">
            <legend>
              Extra Config
              <button type="button" class="btn btn-xs" style={{ 'margin-left': '10px' }}
                onClick={addConfigRow} disabled={submitting()}>+ Add</button>
            </legend>
            <Show when={configRows().length > 0}>
              <div class="config-rows">
                <Index each={configRows()}>
                  {(row, i) => (
                    <div class="config-row">
                      <input class="form-input mono" placeholder="key" value={row().key}
                        onInput={e => setRowKey(i, e.currentTarget.value)} disabled={submitting()} />
                      <input class="form-input" placeholder="value" value={row().value}
                        onInput={e => setRowVal(i, e.currentTarget.value)} disabled={submitting()} />
                      <button type="button" class="btn btn-xs btn-ghost"
                        onClick={() => removeRow(i)} disabled={submitting()}>✕</button>
                    </div>
                  )}
                </Index>
              </div>
            </Show>
            <Show when={configRows().length === 0}>
              <div class="muted small">No extra config — click Add to set key/value pairs.</div>
            </Show>
          </fieldset>

          {/* ── Footer ── */}
          <div class="modal-footer">
            <button type="button" class="btn" onClick={props.onClose} disabled={submitting()}>Cancel</button>
            <button type="submit" class="btn btn-primary" disabled={submitting()}>
              {submitting() ? 'Launching…' : 'Launch'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
