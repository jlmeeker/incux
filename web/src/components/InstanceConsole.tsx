import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { baseForRemote } from '../api';

interface Props {
  instanceName: string;
  /** 'console' attaches to the persistent TTY (auto-reconnects on disconnect).
   *  'exec'    spawns a fresh bash shell each time (no reconnect). */
  mode: 'console' | 'exec';
  remote?: string;
  project?: string;
}

interface ConsoleResponse {
  operation: string;
  metadata: {
    metadata: {
      fds: { [fd: string]: string };
    };
  };
}

const RECONNECT_DELAY_MS = 3000;

export function InstanceConsole(props: Props) {
  let containerRef!: HTMLDivElement;
  const [pasteToast, setPasteToast] = createSignal(false);
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  function showPasteToast() {
    if (toastTimer) clearTimeout(toastTimer);
    setPasteToast(true);
    toastTimer = setTimeout(() => setPasteToast(false), 1500);
  }

  onMount(() => {
    // ── 1. Init terminal (once — persists across reconnects) ─────────────────
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", "Menlo", monospace',
      theme: {
        background: '#0d1117',
        foreground: '#e6edf3',
        cursor:     '#58a6ff',
        black:      '#484f58',
        red:        '#ff7b72',
        green:      '#3fb950',
        yellow:     '#d29922',
        blue:       '#58a6ff',
        magenta:    '#bc8cff',
        cyan:       '#39c5cf',
        white:      '#b1bac4',
        brightBlack:   '#6e7681',
        brightRed:     '#ffa198',
        brightGreen:   '#56d364',
        brightYellow:  '#e3b341',
        brightBlue:    '#79c0ff',
        brightMagenta: '#d2a8ff',
        brightCyan:    '#56d4dd',
        brightWhite:   '#f0f6fc',
      },
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(containerRef);
    fitAddon.fit();

    // ── 2. State shared across reconnect attempts ─────────────────────────────
    let destroyed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let activeIoWs:  WebSocket | null = null;
    let activeCtlWs: WebSocket | null = null;

    // ── 3. Resize helpers (wired once; sendResize references activeCtlWs) ────
    function sendResize() {
      if (!activeCtlWs || activeCtlWs.readyState !== WebSocket.OPEN) return;
      fitAddon.fit();
      activeCtlWs.send(JSON.stringify({
        command: 'window-resize',
        args: {
          width:  String(term.cols),
          height: String(term.rows),
        },
      }));
    }

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      sendResize();
    });
    resizeObserver.observe(containerRef);

    // Terminal input goes to whichever WS is currently open.
    const encoder = new TextEncoder();
    term.onData((data) => {
      if (activeIoWs && activeIoWs.readyState === WebSocket.OPEN) {
        activeIoWs.send(encoder.encode(data));
      }
    });

    // ── Clipboard paste ───────────────────────────────────────────────────────
    // 1. Ctrl+Shift+V (common terminal paste shortcut)
    // 2. Right-click context menu (browser native paste via 'paste' DOM event)
    // 3. Middle-click is handled natively by xterm via onData above
    function sendPaste(text: string) {
      if (!text) return;
      if (activeIoWs && activeIoWs.readyState === WebSocket.OPEN) {
        activeIoWs.send(encoder.encode(text));
        showPasteToast();
      }
    }

    // DOM paste event fires for Ctrl+Shift+V and right-click > Paste
    containerRef.addEventListener('paste', (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text') ?? '';
      sendPaste(text);
    });

    // Also try async clipboard API on Ctrl+Shift+V since some browsers don't
    // fire the paste event on non-input elements
    containerRef.addEventListener('keydown', (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'V') {
        e.preventDefault();
        navigator.clipboard?.readText().then(text => sendPaste(text)).catch(() => {});
      }
    });

    // ── 4. Schedule a reconnect (console mode only) ───────────────────────────
    function scheduleReconnect(reason: string) {
      if (destroyed || props.mode !== 'console') return;
      term.writeln(`\r\n\x1b[90m[${reason} — reconnecting in ${RECONNECT_DELAY_MS / 1000}s…]\x1b[0m`);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_DELAY_MS);
    }

    // ── 5. Connect (called on first mount and on each reconnect) ──────────────
    async function connect() {
      if (destroyed) return;

      term.writeln('\r\n\x1b[90m[connecting…]\x1b[0m');

      // Measure current terminal size for the POST body.
      fitAddon.fit();
      const cols = term.cols;
      const rows = term.rows;

      const apiBase = baseForRemote(props.remote ?? 'local');
      const wsApiBase = apiBase.replace(/\/1\.0$/, '');
      const projectQ = props.project && props.project !== 'default'
        ? `?project=${encodeURIComponent(props.project)}`
        : '';

      let opPath: string;
      let ioSecret: string;
      let ctlSecret: string | undefined;

      try {
        if (props.mode === 'console') {
          const res = await fetch(`${apiBase}/instances/${props.instanceName}/console${projectQ}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'console', width: cols, height: rows, force: true }),
          });
          const data: ConsoleResponse = await res.json();
          if (!res.ok) {
            scheduleReconnect(`console POST failed ${res.status}: ${(data as any)?.error ?? res.statusText}`);
            return;
          }
          opPath    = data.operation;
          ioSecret  = data.metadata?.metadata?.fds?.['0'];
          ctlSecret = data.metadata?.metadata?.fds?.['control'];
        } else {
          const res = await fetch(`${apiBase}/instances/${props.instanceName}/exec${projectQ}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              command: ['bash'],
              interactive: true,
              'wait-for-websocket': true,
              'record-output': false,
              width: cols,
              height: rows,
              environment: { TERM: 'xterm-256color', LANG: 'en_US.UTF-8', COLORTERM: 'truecolor' },
            }),
          });
          const data: ConsoleResponse = await res.json();
          if (!res.ok) {
            scheduleReconnect(`exec POST failed ${res.status}: ${(data as any)?.error ?? res.statusText}`);
            return;
          }
          opPath    = data.operation;
          ioSecret  = data.metadata?.metadata?.fds?.['0'];
          ctlSecret = data.metadata?.metadata?.fds?.['control'];
        }
      } catch (e: any) {
        scheduleReconnect(`fetch failed: ${(e as any).message ?? e}`);
        return;
      }

      if (!ioSecret) {
        // Log the full response shape to help diagnose missing secrets
        console.error('[InstanceConsole] no I/O secret — opPath:', opPath!, 'remote:', props.remote ?? 'local');
        scheduleReconnect('no I/O secret returned');
        return;
      }

      if (destroyed) return; // component was unmounted while fetch was in-flight

      // ── 6. Open WebSockets ─────────────────────────────────────────────────
      const wsBase = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
      const ioWs  = new WebSocket(`${wsBase}${wsApiBase}${opPath}/websocket?secret=${ioSecret}`);
      const ctlWs = ctlSecret ? new WebSocket(`${wsBase}${wsApiBase}${opPath}/websocket?secret=${ctlSecret}`) : null;

      ioWs.binaryType = 'arraybuffer';
      if (ctlWs) ctlWs.binaryType = 'arraybuffer';

      activeIoWs  = ioWs;
      activeCtlWs = ctlWs;

      // ── 7. Wire I/O WebSocket → terminal ───────────────────────────────────
      ioWs.addEventListener('message', (ev) => {
        if (ev.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(ev.data));
        } else {
          term.write(ev.data as string);
        }
      });

      // ── 8. Send initial resize once control socket is open ─────────────────
      if (ctlWs) {
        ctlWs.addEventListener('open', sendResize);
      }

      // ── 9. Handle closure ──────────────────────────────────────────────────
      ioWs.addEventListener('close', () => {
        activeIoWs  = null;
        activeCtlWs = null;
        if (destroyed) {
          // Clean unmount — show detached message only for console mode.
          if (props.mode === 'console') {
            term.writeln('\r\n\x1b[90m[console detached]\x1b[0m');
          }
        } else if (props.mode === 'exec') {
          term.writeln('\r\n\x1b[90m[shell exited]\x1b[0m');
        } else {
          scheduleReconnect('disconnected');
        }
      });

      ioWs.addEventListener('error', () => {
        // The 'close' event always fires after 'error', so reconnect logic
        // is handled there — just swallow the error event itself.
      });
    }

    // ── 10. Cleanup on unmount ────────────────────────────────────────────────
    onCleanup(() => {
      destroyed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      resizeObserver.disconnect();
      activeIoWs?.close();
      activeCtlWs?.close();
      term.dispose();
    });

    // Kick off the first connection.
    connect();
  });

  return (
    <div class="console-wrap">
      <div class="console-toolbar">
        <span class="console-hint">Ctrl+Shift+V or right-click to paste</span>
        <button
          class="btn btn-sm console-paste-btn"
          title="Paste clipboard"
          onClick={() => navigator.clipboard?.readText().then(text => {
            const encoder = new TextEncoder();
            // find the active WS via the shared ref exposed on containerRef
            const ev = new ClipboardEvent('paste', { clipboardData: new DataTransfer() });
            ev.clipboardData!.setData('text', text);
            containerRef.dispatchEvent(ev);
          }).catch(() => {})}
        >
          ⎘ Paste
        </button>
      </div>
      <div class="console-container" ref={containerRef} />
      <Show when={pasteToast()}>
        <div class="console-paste-toast">Pasted</div>
      </Show>
    </div>
  );
}
