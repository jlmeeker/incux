import { onMount, onCleanup, createSignal, Show } from 'solid-js';
import { useParams } from '@solidjs/router';
import { SpiceMainConn, handle_resize, sendCtrlAltDel } from '@spice-project/spice-html5';
import { baseForRemote } from '../api';

const RECONNECT_DELAY_MS = 3000;
const CTL_TIMEOUT_MS     = 10000;

export default function VgaConsole() {
  const params = useParams<{ name: string }>();
  const [status, setStatus]   = createSignal('Connecting…');
  const [error,  setError]    = createSignal<string | null>(null);

  // Remote is passed as a URL query param since this page opens in a new window
  // with no access to the RemoteContext.
  const remote  = new URLSearchParams(location.search).get('remote')  ?? 'local';
  const project = new URLSearchParams(location.search).get('project') ?? 'default';
  const apiBase   = baseForRemote(remote);
  const wsApiBase = apiBase.replace(/\/1\.0$/, '');
  const projectQ  = project !== 'default' ? `?project=${encodeURIComponent(project)}` : '';

  // Set to true when the component unmounts so reconnect loops stop.
  let destroyed = false;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function cleanup() {
    try { ((window as any).spice_connection as any)?.stop(); } catch (_) {}
    (window as any).spice_connection = undefined;
    (window as any).sc               = undefined;
  }

  async function connect() {
    if (destroyed) return;
    setError(null);
    setStatus('Connecting…');

    // ── 1. POST /console type=vga — get a fresh operation each attempt ───────
    let opPath: string;
    let ioSecret: string;
    let ctlSecret: string;

    try {
      const res = await fetch(`${apiBase}/instances/${params.name}/console${projectQ}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'vga', force: true }),
      });
      const data = await res.json();
      opPath    = data.operation;
      ioSecret  = data.metadata?.metadata?.fds?.['0'];
      ctlSecret = data.metadata?.metadata?.fds?.['control'];
    } catch (e: any) {
      scheduleReconnect(`Fetch failed: ${e.message ?? e}`);
      return;
    }

    if (!ioSecret) {
      scheduleReconnect('No I/O secret returned — VM may not be running yet');
      return;
    }

    const wsBase  = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`;
    const dataUrl = `${wsBase}${wsApiBase}${opPath}/websocket?secret=${ioSecret}`;
    const ctlUrl  = `${wsBase}${wsApiBase}${opPath}/websocket?secret=${ctlSecret}`;

    // ── 2. Connect control socket first ─────────────────────────────────────
    const ctlWs = new WebSocket(ctlUrl);
    ctlWs.binaryType = 'arraybuffer';

    try {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Control socket timed out')), CTL_TIMEOUT_MS);
        ctlWs.onopen  = () => { clearTimeout(t); resolve(); };
        ctlWs.onerror = () => { clearTimeout(t); reject(new Error('Control socket error')); };
      });
    } catch (e: any) {
      ctlWs.close();
      scheduleReconnect(e.message);
      return;
    }

    if (destroyed) { ctlWs.close(); return; }

    // ── 3. Tear down any previous SPICE connection ───────────────────────────
    cleanup();

    // ── 4. Hand data URL to spice-html5 ─────────────────────────────────────
    let conn: InstanceType<typeof SpiceMainConn>;
    try {
      conn = new SpiceMainConn({
        uri:       dataUrl,
        screen_id: 'spice-screen',
        onerror:   (e: unknown) => {
          const msg = e instanceof Error ? e.message : String(e);
          // 'Disconnected' fires on normal VM shutdown/reboot — reconnect silently.
          if (msg.includes('Disconnected') || msg.includes('Connection refused')) {
            ctlWs.close();
            scheduleReconnect(null);
          } else {
            ctlWs.close();
            scheduleReconnect(msg);
          }
        },
        onsuccess: () => {
          setStatus('');
          setError(null);
          handle_resize();
          // Focus the canvas so keyboard input is captured immediately
          setTimeout(() => {
            const canvas = document.querySelector<HTMLCanvasElement>('#spice-screen canvas');
            canvas?.focus();
          }, 100);
        },
        onagent: () => handle_resize(),
      });
    } catch (e: any) {
      ctlWs.close();
      scheduleReconnect(`SPICE init failed: ${e.message ?? e}`);
      return;
    }

    (window as any).spice_connection = conn;
    (window as any).sc               = conn;
  }

  function scheduleReconnect(msg: string | null) {
    if (destroyed) return;
    if (msg) setError(msg);
    setStatus(`Reconnecting in ${RECONNECT_DELAY_MS / 1000}s…`);
    reconnectTimer = setTimeout(() => {
      if (!destroyed) connect();
    }, RECONNECT_DELAY_MS);
  }

  onMount(() => {
    document.title = `VGA — ${params.name}`;
    const handleResize = () => handle_resize();
    window.addEventListener('resize', handleResize);

    // Re-focus the SPICE canvas whenever the user clicks anywhere in the page,
    // so keystrokes are captured even after interacting with the toolbar.
    function focusCanvas() {
      const canvas = document.querySelector<HTMLCanvasElement>('#spice-screen canvas');
      if (canvas) {
        canvas.focus();
      } else {
        const screen = document.getElementById('spice-screen');
        screen?.focus();
      }
    }

    document.addEventListener('click', focusCanvas);

    // ── Clipboard paste → SPICE ───────────────────────────────────────────────
    // spice-html5 get_scancode() uses e.keyCode (legacy) to look up scancodes.
    // We must supply the correct DOM keyCode for each character, matching the
    // US QWERTY layout that the scanmap was built for.
    // Each entry: [keyCode, shiftRequired]
    const US_KEYMAP: Record<string, [number, boolean]> = {
      'a':[65,false],'b':[66,false],'c':[67,false],'d':[68,false],'e':[69,false],
      'f':[70,false],'g':[71,false],'h':[72,false],'i':[73,false],'j':[74,false],
      'k':[75,false],'l':[76,false],'m':[77,false],'n':[78,false],'o':[79,false],
      'p':[80,false],'q':[81,false],'r':[82,false],'s':[83,false],'t':[84,false],
      'u':[85,false],'v':[86,false],'w':[87,false],'x':[88,false],'y':[89,false],
      'z':[90,false],
      'A':[65,true], 'B':[66,true], 'C':[67,true], 'D':[68,true], 'E':[69,true],
      'F':[70,true], 'G':[71,true], 'H':[72,true], 'I':[73,true], 'J':[74,true],
      'K':[75,true], 'L':[76,true], 'M':[77,true], 'N':[78,true], 'O':[79,true],
      'P':[80,true], 'Q':[81,true], 'R':[82,true], 'S':[83,true], 'T':[84,true],
      'U':[85,true], 'V':[86,true], 'W':[87,true], 'X':[88,true], 'Y':[89,true],
      'Z':[90,true],
      '0':[48,false],'1':[49,false],'2':[50,false],'3':[51,false],'4':[52,false],
      '5':[53,false],'6':[54,false],'7':[55,false],'8':[56,false],'9':[57,false],
      ')':[48,true], '!':[49,true], '@':[50,true], '#':[51,true], '$':[52,true],
      '%':[53,true], '^':[54,true], '&':[55,true], '*':[56,true], '(':[57,true],
      ' ':[32,false],'\r':[13,false],'\n':[13,false],'\t':[9,false],
      '-':[189,false],'_':[189,true],
      '=':[187,false],'+':[187,true],
      '[':[219,false],'{':[219,true],
      ']':[221,false],'}':[221,true],
      '\\':[220,false],'|':[220,true],
      ';':[186,false],':':[186,true],
      "'":[222,false],'"':[222,true],
      ',':[188,false],'<':[188,true],
      '.':[190,false],'>':[190,true],
      '/':[191,false],'?':[191,true],
      '`':[192,false],'~':[192,true],
    };

    function pasteTextToSpice(text: string) {
      const canvas = document.querySelector<HTMLCanvasElement>('#spice-screen canvas');
      if (!canvas) return;
      for (const char of text) {
        const mapping = US_KEYMAP[char];
        if (!mapping) continue; // skip unmappable chars
        const [keyCode, shiftKey] = mapping;
        const init: KeyboardEventInit = {
          key: char, keyCode, which: keyCode, shiftKey,
          bubbles: true, cancelable: true,
        };
        canvas.dispatchEvent(new KeyboardEvent('keydown', init));
        canvas.dispatchEvent(new KeyboardEvent('keyup',   init));
      }
    }

    // Listen for paste events on the window (fires when canvas has focus and
    // user presses Ctrl+V, or from the toolbar button)
    function handlePaste(e: ClipboardEvent) {
      const text = e.clipboardData?.getData('text') ?? '';
      if (text) {
        e.preventDefault();
        pasteTextToSpice(text);
      }
    }
    window.addEventListener('paste', handlePaste);

    // Expose pasteTextToSpice so the toolbar button can call it
    (window as any)._vgaPaste = () => {
      navigator.clipboard?.readText().then(text => pasteTextToSpice(text)).catch(() => {});
    };

    connect();

    onCleanup(() => {
      destroyed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('paste', handlePaste);
      document.removeEventListener('click', focusCanvas);
      delete (window as any)._vgaPaste;
      cleanup();
    });
  });

  return (
    <div class="vga-page">
      <div class="vga-toolbar">
        <span class="vga-title">VGA — {params.name}</span>
        <div class="vga-toolbar-actions">
          <Show when={!status()}>
            <button class="vga-btn" title="Paste clipboard text into VM (Ctrl+V also works)"
              onClick={() => (window as any)._vgaPaste?.()}>
              ⎘ Paste
            </button>
            <button class="vga-btn" title="Send Ctrl+Alt+Del" onClick={() => { try { sendCtrlAltDel(); } catch (_) {} }}>
              Ctrl+Alt+Del
            </button>
          </Show>
          <button class="vga-btn" onClick={() => window.close()}>✕ Close</button>
        </div>
      </div>

      <Show when={status()}>
        <div class="vga-overlay">{status()}</div>
      </Show>
      <Show when={error()}>
        <div class="vga-overlay vga-overlay--error">{error()}</div>
      </Show>

      <div id="spice-screen" class="vga-screen" tabindex="0" />
    </div>
  );
}
