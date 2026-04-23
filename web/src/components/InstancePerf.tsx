import { createSignal, onMount, onCleanup, For, Show } from 'solid-js';
import { getInstanceState, fmtBytes, type InstanceState, baseForRemote } from '../api';

interface Props {
  instanceName: string;
  remote?: string;
  project?: string;
}

const POLL_MS = 2000;

function pct(n: number, total: number): number {
  if (!total) return 0;
  return Math.min(100, Math.round((n / total) * 100));
}

function fmtRate(bytesPerSec: number): string {
  if (bytesPerSec < 1024)       return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${(bytesPerSec / 1024 / 1024).toFixed(1)} MB/s`;
}

// A simple bar with a label.
function Bar(props: { pct: number; color: string; label: string }) {
  return (
    <div class="perf-bar-row">
      <span class="perf-bar-label">{props.label}</span>
      <div class="perf-bar-track">
        <div
          class="perf-bar-fill"
          style={{ width: `${props.pct}%`, background: props.color }}
        />
      </div>
      <span class="perf-bar-pct">{props.pct}%</span>
    </div>
  );
}

export function InstancePerf(props: Props) {
  const [state,   setState]   = createSignal<InstanceState | null>(null);
  const [cpuPct,  setCpuPct]  = createSignal(0);
  const [rxRate,  setRxRate]  = createSignal(0);
  const [txRate,  setTxRate]  = createSignal(0);
  const [err,     setErr]     = createSignal<string | null>(null);

  // Previous sample for delta calculations.
  let prevCpuNs  = 0;
  let prevTs     = 0;
  let prevRxBytes = 0;
  let prevTxBytes = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function poll() {
    try {
      const resp = await getInstanceState(props.instanceName, props.project, props.remote);
      const s = resp.metadata;
      setState(s);
      setErr(null);

      const now = Date.now();

      // ── CPU % ────────────────────────────────────────────────────────────
      // cpu.usage is cumulative nanoseconds of CPU time used.
      // We divide by the wall-clock delta (in ns) to get a 0-100% value.
      if (prevTs > 0) {
        const wallNs    = (now - prevTs) * 1_000_000;
        const cpuDelta  = s.cpu.usage - prevCpuNs;
        setCpuPct(Math.min(100, Math.round((cpuDelta / wallNs) * 100)));
      }

      // ── Network rates ────────────────────────────────────────────────────
      // Sum all non-loopback interfaces.
      let totalRx = 0, totalTx = 0;
      for (const [iface, info] of Object.entries(s.network ?? {})) {
        if (iface === 'lo') continue;
        totalRx += info.counters.bytes_received;
        totalTx += info.counters.bytes_sent;
      }
      if (prevRxBytes > 0 && prevTs > 0) {
        const secs = (now - prevTs) / 1000;
        setRxRate(Math.max(0, (totalRx - prevRxBytes) / secs));
        setTxRate(Math.max(0, (totalTx - prevTxBytes) / secs));
      }
      prevRxBytes = totalRx;
      prevTxBytes = totalTx;
      prevCpuNs   = s.cpu.usage;
      prevTs      = now;
    } catch (e: any) {
      setErr(e.message ?? String(e));
    }
  }

  onMount(() => {
    poll();
    timer = setInterval(poll, POLL_MS);
    onCleanup(() => { if (timer !== null) clearInterval(timer); });
  });

  const memPct  = () => {
    const s = state();
    return s ? pct(s.memory.usage, s.memory.total) : 0;
  };
  const swapPct = () => {
    const s = state();
    if (!s || !s.memory.swap_usage || !s.memory.total) return 0;
    return pct(s.memory.swap_usage, s.memory.total);
  };

  // Bar colour: green → yellow → red
  function barColor(p: number) {
    if (p < 60) return 'var(--green)';
    if (p < 85) return 'var(--yellow)';
    return 'var(--red)';
  }

  return (
    <div class="perf-panel">
      <Show when={err()}>
        <div class="error small">{err()}</div>
      </Show>
      <Show when={state()}>
        {/* CPU */}
        <Bar pct={cpuPct()} color={barColor(cpuPct())} label="CPU" />

        {/* Memory */}
        <Bar pct={memPct()} color={barColor(memPct())} label="Memory" />
        <div class="perf-sub">
          {fmtBytes(state()!.memory.usage)} / {fmtBytes(state()!.memory.total)}
          <Show when={state()!.memory.swap_usage > 0}>
            {' · '}Swap {fmtBytes(state()!.memory.swap_usage)}
          </Show>
        </div>

        {/* Disk usage per volume */}
        <Show when={state()!.disk && Object.keys(state()!.disk!).length > 0}>
          <For each={Object.entries(state()!.disk!)}>
            {([vol, info]) => (
              <div class="perf-sub">Disk ({vol}): {fmtBytes(info.usage)}</div>
            )}
          </For>
        </Show>

        {/* Network rates */}
        <div class="perf-net-row">
          <span class="perf-net-label">Network</span>
          <span class="perf-net-val">↓ {fmtRate(rxRate())}</span>
          <span class="perf-net-val">↑ {fmtRate(txRate())}</span>
        </div>

        {/* Processes */}
        <Show when={state()!.processes != null}>
          <div class="perf-sub">Processes: {state()!.processes}</div>
        </Show>
      </Show>
    </div>
  );
}
