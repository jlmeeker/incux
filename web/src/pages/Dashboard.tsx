import { createResource, For, Show } from 'solid-js';
import {
  fmtBytes, baseForRemote,
  type StoragePool, type IncusResponse,
} from '../api';
import { useProject } from '../ProjectContext';
import { useRemote } from '../RemoteContext';

function memberStatusClass(s: string) {
  if (s === 'Online')    return 'badge badge-green';
  if (s === 'Offline')   return 'badge badge-red';
  if (s === 'Evacuated') return 'badge badge-blue';
  return 'badge badge-gray';
}

function poolBar(used: number, total: number) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const color = pct > 85 ? 'var(--danger)' : pct > 60 ? 'var(--warning)' : 'var(--primary)';
  return { pct, color };
}

// Each fetcher receives the source tuple and constructs the URL itself using
// baseForRemote(remote) — no reliance on the module-level _activeRemote variable.
export default function Dashboard() {
  const { project } = useProject();
  const { remote }  = useRemote();

  const src       = () => ({ r: remote(), p: project() });
  const [info]      = createResource(remote, (r) => fetch(`${baseForRemote(r)}`).then(res => res.json()));
  const [resources] = createResource(remote, (r) => fetch(`${baseForRemote(r)}/resources`).then(res => res.json()));
  const [instances] = createResource(src, ({ r, p }) => {
    const url = p && p !== 'default' ? `${baseForRemote(r)}/instances?recursion=2&project=${encodeURIComponent(p)}` : `${baseForRemote(r)}/instances?recursion=2`;
    return fetch(url).then(res => res.json());
  });
  const [pools]     = createResource(remote, (r) => fetch(`${baseForRemote(r)}/storage-pools?recursion=1`).then(res => res.json()));
  const [networks]  = createResource(src, ({ r, p }) => {
    const url = p && p !== 'default' ? `${baseForRemote(r)}/networks?recursion=1&project=${encodeURIComponent(p)}` : `${baseForRemote(r)}/networks?recursion=1`;
    return fetch(url).then(res => res.json());
  });
  const [cluster]   = createResource(remote, (r) => fetch(`${baseForRemote(r)}/cluster`).then(res => res.json()));
  const [members]   = createResource(
    () => ({ r: remote(), enabled: cluster()?.metadata?.enabled ?? false }),
    ({ r, enabled }) => enabled
      ? fetch(`${baseForRemote(r)}/cluster/members?recursion=1`).then(res => res.json())
      : Promise.resolve(null),
  );
  const [warnings]  = createResource(remote, (r) => fetch(`${baseForRemote(r)}/warnings?recursion=1`).then(res => res.json()));

  // instance counts
  const running    = () => instances()?.metadata?.filter((i: any) => i.status === 'Running').length ?? 0;
  const stopped    = () => instances()?.metadata?.filter((i: any) => i.status === 'Stopped').length ?? 0;
  const frozen     = () => instances()?.metadata?.filter((i: any) => i.status === 'Frozen').length ?? 0;
  const total      = () => instances()?.metadata?.length ?? 0;
  const containers = () => instances()?.metadata?.filter((i: any) => i.type === 'container').length ?? 0;
  const vms        = () => instances()?.metadata?.filter((i: any) => i.type === 'virtual-machine').length ?? 0;

  // memory
  const memUsed  = () => resources()?.metadata?.memory?.used  ?? 0;
  const memTotal = () => resources()?.metadata?.memory?.total ?? 0;
  const memPct   = () => memTotal() > 0 ? Math.round((memUsed() / memTotal()) * 100) : 0;
  const memColor = () => memPct() > 85 ? 'var(--danger)' : memPct() > 60 ? 'var(--warning)' : 'var(--primary)';

  // cpu
  const cpuCount = () => resources()?.metadata?.cpu?.total ?? 0;
  const cpuArch  = () => resources()?.metadata?.cpu?.architecture ?? '—';

  // storage
  const storagePools = () => pools()?.metadata ?? [];

  // networks
  const allNets     = () => networks()?.metadata ?? [];
  const managedNets = () => allNets().filter((n: any) => n.managed);

  // warnings
  const activeWarnings = () => (warnings()?.metadata ?? []).filter((w: any) => w.status === 'new');

  // cluster
  const isClustered  = () => cluster()?.metadata?.enabled ?? false;
  const clusterNodes = () => members()?.metadata ?? [];
  const onlineCount  = () => clusterNodes().filter((m: any) => m.status === 'Online').length;
  const offlineCount = () => clusterNodes().filter((m: any) => m.status === 'Offline').length;

  return (
    <div class="dashboard">

      {/* ── Top stat cards ── */}
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-label">Instances</div>
          <div class="stat-value">{total()}</div>
          <div class="stat-sub">{running()} running · {stopped()} stopped{frozen() > 0 ? ` · ${frozen()} frozen` : ''}</div>
          <div class="stat-sub" style={{ 'margin-top': '4px' }}>{containers()} containers · {vms()} VMs</div>
        </div>

        <div class="stat-card">
          <div class="stat-label">Memory</div>
          <div class="stat-value">{fmtBytes(memUsed())}</div>
          <div class="stat-sub">of {fmtBytes(memTotal())} ({memPct()}%)</div>
          <div class="progress-bar" style={{ 'margin-top': '10px' }}>
            <div class="progress-fill" style={{ width: `${memPct()}%`, background: memColor() }} />
          </div>
        </div>

        <div class="stat-card">
          <div class="stat-label">CPU</div>
          <div class="stat-value">{cpuCount()}</div>
          <div class="stat-sub">threads · {cpuArch()}</div>
        </div>

        <Show when={info()?.metadata}>
          {srv => (
            <div class="stat-card">
              <div class="stat-label">Server</div>
              <div class="stat-value" style={{ 'font-size': '1rem' }}>{srv().environment?.server ?? 'Incus'}</div>
              <div class="stat-sub">v{srv().environment?.server_version ?? '?'}</div>
              <div class="stat-sub" style={{ 'margin-top': '4px' }}>{srv().auth}</div>
            </div>
          )}
        </Show>

        <Show when={activeWarnings().length > 0}>
          <div class="stat-card" style={{ 'border-color': 'var(--warning)' }}>
            <div class="stat-label">Warnings</div>
            <div class="stat-value" style={{ color: 'var(--warning)' }}>{activeWarnings().length}</div>
            <div class="stat-sub">active · <a href="/warnings" class="link">view all</a></div>
          </div>
        </Show>

        <Show when={isClustered()}>
          <div class="stat-card">
            <div class="stat-label">Cluster</div>
            <div class="stat-value">{clusterNodes().length}</div>
            <div class="stat-sub">
              <span style={{ color: 'var(--success)' }}>{onlineCount()} online</span>
              {offlineCount() > 0 && <span style={{ color: 'var(--danger)' }}> · {offlineCount()} offline</span>}
            </div>
          </div>
        </Show>
      </div>

      {/* ── Masonry area: Environment, Networks, Storage Pools ── */}
      <div class="dash-masonry">

        {/* Environment */}
        <Show when={info()?.metadata?.environment}>
          {env => (
            <div class="card">
              <div class="card-header">Environment</div>
              <div class="kv-grid">
                <span class="kv-key">OS</span>              <span class="kv-val">{env().os}</span>
                <span class="kv-key">Kernel</span>          <span class="kv-val">{env().kernel}</span>
                <span class="kv-key">Kernel version</span>  <span class="kv-val">{info()?.metadata?.environment?.kernel_version ?? '—'}</span>
                <span class="kv-key">API Version</span>     <span class="kv-val">{info()?.metadata?.api_version ?? '—'}</span>
                <span class="kv-key">Auth</span>            <span class="kv-val">{info()?.metadata?.auth ?? '—'}</span>
                <span class="kv-key">Architectures</span>   <span class="kv-val">{env().architectures?.join(', ')}</span>
                <span class="kv-key">Driver</span>          <span class="kv-val">{info()?.metadata?.environment?.driver ?? '—'}</span>
                <span class="kv-key">Driver version</span>  <span class="kv-val">{info()?.metadata?.environment?.driver_version ?? '—'}</span>
                <span class="kv-key">Storage</span>         <span class="kv-val">{info()?.metadata?.environment?.storage ?? '—'}</span>
                <span class="kv-key">Storage version</span> <span class="kv-val">{info()?.metadata?.environment?.storage_version ?? '—'}</span>
              </div>
            </div>
          )}
        </Show>

        {/* Networks */}
        <div class="card">
          <div class="card-header">
            Networks
            <span class="card-header-sub">{allNets().length} total · {managedNets().length} managed</span>
          </div>
          <Show when={networks.loading}><div class="loading">Loading…</div></Show>
          <Show when={allNets().length === 0 && !networks.loading}>
            <div class="empty" style={{ padding: '20px' }}>No networks</div>
          </Show>
          <Show when={allNets().length > 0}>
            <table class="data-table dash-net-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Address</th>
                  <th style={{ 'text-align': 'right' }}>Instances</th>
                </tr>
              </thead>
              <tbody>
                <For each={allNets()}>
                  {(net: any) => {
                    const addr = net.config?.['ipv4.address'] ?? net.config?.['ipv6.address'] ?? '';
                    const instanceCount = (net.used_by ?? []).filter((u: string) => u.includes('/instances/')).length;
                    return (
                      <tr>
                        <td>
                          <span class="dash-net-name">{net.name}</span>
                          <Show when={net.managed}>
                            <span class="badge badge-green dash-net-badge">managed</span>
                          </Show>
                        </td>
                        <td><span class="badge badge-gray dash-net-badge">{net.type}</span></td>
                        <td class="dash-net-addr">{addr || '—'}</td>
                        <td style={{ 'text-align': 'right' }}>
                          <Show when={instanceCount > 0} fallback={<span class="text-muted">—</span>}>
                            <span class="dash-net-instances">{instanceCount}</span>
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

        {/* Storage Pools */}
        <Show when={storagePools().length > 0}>
          <div class="card">
            <div class="card-header">Storage Pools</div>
            <div class="dash-pool-grid">
              <For each={storagePools()}>
                {(pool: any) => <PoolCard pool={pool} remote={remote()} />}
              </For>
            </div>
          </div>
        </Show>

      </div>

      {/* ── Cluster members — always full width ── */}
      <Show when={isClustered() && clusterNodes().length > 0}>
        <div class="card">
          <div class="card-header">Cluster Members</div>
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>Roles</th>
                <th>Architecture</th>
                <th>URL</th>
              </tr>
            </thead>
            <tbody>
              <For each={clusterNodes()}>
                {(m: any) => (
                  <tr>
                    <td><strong>{m.server_name}</strong></td>
                    <td><span class={memberStatusClass(m.status)}>{m.status}</span></td>
                    <td>{m.roles?.join(', ') || '—'}</td>
                    <td>{m.architecture}</td>
                    <td class="text-muted" style={{ 'font-size': '.78rem' }}>{m.url}</td>
                  </tr>
                )}
              </For>
            </tbody>
          </table>
        </div>
      </Show>

    </div>
  );
}

// ── Sub-component: one storage pool card ──────────────────────────────────────
function PoolCard(props: { pool: StoragePool; remote: string }) {
  const [res] = createResource(
    () => [props.remote, props.pool.name] as const,
    ([r, name]) => fetch(`${baseForRemote(r)}/storage-pools/${name}/resources`)
      .then(res => res.json())
      .catch(() => null),
  );

  const spaceUsed  = () => (res() as IncusResponse<{ space: { used: number; total: number } }> | null)?.metadata?.space?.used  ?? 0;
  const spaceTotal = () => (res() as IncusResponse<{ space: { used: number; total: number } }> | null)?.metadata?.space?.total ?? 0;
  const pct   = () => poolBar(spaceUsed(), spaceTotal()).pct;
  const color = () => poolBar(spaceUsed(), spaceTotal()).color;

  return (
    <div class="dash-pool-card">
      <div class="dash-pool-header">
        <span class="dash-pool-name">{props.pool.name}</span>
        <span class="badge badge-gray" style={{ 'font-size': '.7rem' }}>{props.pool.driver}</span>
      </div>
      <Show when={spaceTotal() > 0} fallback={<div class="stat-sub">No space info</div>}>
        <div class="stat-sub">{fmtBytes(spaceUsed())} / {fmtBytes(spaceTotal())} ({pct()}%)</div>
        <div class="progress-bar">
          <div class="progress-fill" style={{ width: `${pct()}%`, background: color() }} />
        </div>
      </Show>
      <div class="stat-sub" style={{ 'margin-top': '6px' }}>
        {props.pool.used_by?.length ?? 0} volumes
      </div>
    </div>
  );
}
