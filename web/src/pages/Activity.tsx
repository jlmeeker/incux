import { onMount, onCleanup, createSignal, createEffect, For, Show } from 'solid-js';
import { useProject } from '../ProjectContext';
import { useRemote } from '../RemoteContext';
import { baseForRemote } from '../api';

// ── Types ─────────────────────────────────────────────────────────────────────

interface IncusEvent {
  type: 'lifecycle' | 'operation' | 'logging' | 'keepalive' | string;
  timestamp: string;
  metadata: Record<string, any>;
}

interface DisplayEvent {
  id: number;
  ts: Date;
  type: string;
  action: string;
  source: string;
  raw: IncusEvent;
}

const MAX_EVENTS = 200;
const RECONNECT_DELAY_MS = 3000;
let _idSeq = 0;

// ── Helpers ───────────────────────────────────────────────────────────────────

function typeBadgeClass(t: string) {
  if (t === 'lifecycle')  return 'badge badge-green';
  if (t === 'operation')  return 'badge badge-blue';
  if (t === 'logging')    return 'badge badge-yellow';
  return 'badge badge-gray';
}

function extractAction(ev: IncusEvent): string {
  if (ev.type === 'lifecycle') return ev.metadata?.action ?? '—';
  if (ev.type === 'operation') return ev.metadata?.description ?? ev.metadata?.status ?? '—';
  if (ev.type === 'logging')   return ev.metadata?.message ?? '—';
  return ev.type;
}

function extractSource(ev: IncusEvent): string {
  if (ev.type === 'lifecycle') {
    const src: string = ev.metadata?.source ?? '';
    return src.replace(/^\/1\.0\//, '');
  }
  if (ev.type === 'operation') {
    const instances: string[] = ev.metadata?.resources?.instances ?? ev.metadata?.resources?.containers ?? [];
    if (instances.length > 0) return instances[0].replace(/^\/1\.0\/instances\//, '');
    return '';
  }
  return '';
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function Activity() {
  const { project } = useProject();
  const { remote }  = useRemote();

  const [events,  setEvents]  = createSignal<DisplayEvent[]>([]);
  const [status,  setStatus]  = createSignal('Connecting…');
  const [paused,  setPaused]  = createSignal(false);
  const [q,       setQ]       = createSignal('');
  const [connErr, setConnErr] = createSignal<string | null>(null);

  let destroyed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let ws: WebSocket | null = null;
  let listRef!: HTMLDivElement;

  // Pending events buffered while paused
  const pending: DisplayEvent[] = [];

  function appendEvents(batch: DisplayEvent[]) {
    setEvents(prev => {
      const next = [...prev, ...batch];
      return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
    });
    // Auto-scroll to bottom
    requestAnimationFrame(() => {
      if (listRef) listRef.scrollTop = listRef.scrollHeight;
    });
  }

  function handleMessage(data: string) {
    let ev: IncusEvent;
    try { ev = JSON.parse(data); } catch { return; }
    if (ev.type === 'keepalive') return;

    const display: DisplayEvent = {
      id:     ++_idSeq,
      ts:     new Date(ev.timestamp),
      type:   ev.type,
      action: extractAction(ev),
      source: extractSource(ev),
      raw:    ev,
    };

    if (paused()) {
      pending.push(display);
    } else {
      appendEvents([display]);
    }
  }

  function scheduleReconnect(reason: string) {
    if (destroyed) return;
    setStatus(`Reconnecting in ${RECONNECT_DELAY_MS / 1000}s… (${reason})`);
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, RECONNECT_DELAY_MS);
  }

  function connect() {
    if (destroyed) return;
    setConnErr(null);
    setStatus('Connecting…');

    const proj    = project();
    const apiPath = baseForRemote(remote());            // e.g. /api/1.0 or /api/remotes/prod/1.0
    const wsBase  = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    const qs = proj && proj !== 'default'
      ? `?type=lifecycle,operation,logging&project=${encodeURIComponent(proj)}`
      : '?type=lifecycle,operation,logging';
    ws = new WebSocket(`${wsBase}${apiPath}/events${qs}`);

    ws.addEventListener('open', () => {
      if (destroyed) { ws?.close(); return; }
      setStatus('Connected');
      setConnErr(null);
    });

    ws.addEventListener('message', ev => handleMessage(ev.data));

    ws.addEventListener('close', () => {
      ws = null;
      if (!destroyed) scheduleReconnect('disconnected');
    });

    ws.addEventListener('error', () => {
      // close fires after error; reconnect logic handled there
    });
  }

  onMount(() => { connect(); });

  // Reconnect when remote changes
  createEffect((prev: string | undefined) => {
    const r = remote();
    if (prev !== undefined && r !== prev) {
      ws?.close();
      if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
      setEvents([]);
      connect();
    }
    return r;
  });

  onCleanup(() => {
    destroyed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    ws?.close();
  });

  // Toggle pause/resume
  function togglePause() {
    const nowPaused = !paused();
    setPaused(nowPaused);
    if (!nowPaused && pending.length > 0) {
      appendEvents(pending.splice(0));
    }
  }

  // Filtered view
  const filtered = () => {
    const s = q().toLowerCase();
    if (!s) return events();
    return events().filter(e =>
      e.action.toLowerCase().includes(s) ||
      e.source.toLowerCase().includes(s) ||
      e.type.toLowerCase().includes(s)
    );
  };

  return (
    <div style="display:flex;flex-direction:column;height:100%">
      <div class="card" style="flex:1;display:flex;flex-direction:column;min-height:0">
        {/* Header */}
        <div class="card-header" style="flex-shrink:0">
          <div style="display:flex;align-items:center;gap:.75rem">
            <span>Activity</span>
            <span class="muted small" style="font-weight:400">{status()}</span>
            <Show when={paused()}>
              <span class="badge badge-yellow">Paused — {pending.length} buffered</span>
            </Show>
          </div>
          <div class="card-toolbar">
            <input
              class="search-input"
              placeholder="Filter events…"
              value={q()}
              onInput={e => setQ(e.currentTarget.value)}
            />
            <button class="btn btn-sm" onClick={togglePause}>
              {paused() ? '▶ Resume' : '⏸ Pause'}
            </button>
            <button class="btn btn-sm" onClick={() => setEvents([])}>✕ Clear</button>
          </div>
        </div>

        <Show when={connErr()}>
          <div class="error" style="flex-shrink:0">{connErr()}</div>
        </Show>

        {/* Event list */}
        <div
          ref={listRef!}
          style="flex:1;overflow-y:auto;min-height:0"
        >
          <Show when={filtered().length === 0}>
            <div class="drawer-empty" style="padding:2rem 1rem">
              {q() ? 'No events match your filter.' : 'Waiting for events…'}
            </div>
          </Show>

          <Show when={filtered().length > 0}>
            <table class="data-table" style="font-size:.8rem">
              <thead style="position:sticky;top:0;background:var(--surface);z-index:1">
                <tr>
                  <th style="width:9rem">Time</th>
                  <th style="width:7rem">Type</th>
                  <th>Action / Description</th>
                  <th>Source</th>
                </tr>
              </thead>
              <tbody>
                <For each={filtered()}>
                  {ev => (
                    <tr>
                      <td class="mono small" style="white-space:nowrap;color:var(--text-muted)">{fmtTime(ev.ts)}</td>
                      <td><span class={typeBadgeClass(ev.type)}>{ev.type}</span></td>
                      <td>{ev.action}</td>
                      <td class="mono small muted">{ev.source}</td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </div>

        {/* Footer count */}
        <div style="flex-shrink:0;padding:.4rem 1rem;border-top:1px solid var(--border);font-size:.75rem;color:var(--text-muted);display:flex;justify-content:space-between">
          <span>{events().length} event{events().length !== 1 ? 's' : ''} (last {MAX_EVENTS} kept)</span>
          <Show when={q() && filtered().length !== events().length}>
            <span>{filtered().length} shown</span>
          </Show>
        </div>
      </div>
    </div>
  );
}
