import { createResource, createSignal, For, Show } from 'solid-js';
import {
  getCluster, getClusterMembers, getClusterMember,
  getClusterMemberStoragePools, getClusterMemberNetworks,
  getClusterGroups, createClusterGroup, updateClusterGroup, deleteClusterGroup,
  evacuateClusterMember, waitForOperation,
  fmtBytes, baseForRemote,
  type ClusterMember, type ClusterGroup,
} from '../api';
import { Drawer } from '../components/Drawer';
import { useRemote } from '../RemoteContext';
import { useRbac } from '../RbacContext';

function statusBadge(s: string) {
  if (s === 'Online')    return 'badge badge-green';
  if (s === 'Offline')   return 'badge badge-red';
  if (s === 'Evacuated') return 'badge badge-yellow';
  return 'badge badge-gray';
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

// ── Cluster Group Modal ───────────────────────────────────────────────────────

interface GroupModalProps {
  existing?: ClusterGroup;
  memberNames: string[];
  onClose: () => void;
  onSaved: () => void;
}

function GroupModal(props: GroupModalProps) {
  const editing = () => !!props.existing;
  const [name,    setName]    = createSignal(props.existing?.name ?? '');
  const [desc,    setDesc]    = createSignal(props.existing?.description ?? '');
  const [members, setMembers] = createSignal<string[]>(props.existing?.members ?? []);
  const [busy,    setBusy]    = createSignal(false);
  const [error,   setError]   = createSignal<string | null>(null);

  function toggleMember(m: string) {
    setMembers(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  }

  async function submit(e: Event) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (editing()) {
        await updateClusterGroup(props.existing!.name, { description: desc(), members: members() });
      } else {
        await createClusterGroup({ name: name(), description: desc(), members: members() });
      }
      props.onSaved();
    } catch (err: any) {
      setError(err.message ?? String(err));
    } finally { setBusy(false); }
  }

  return (
    <div class="modal-backdrop" onClick={e => { if ((e.target as HTMLElement).classList.contains('modal-backdrop')) props.onClose(); }}>
      <div class="modal" style="max-width:480px">
        <div class="modal-header">
          <span class="modal-title">{editing() ? `Edit Group: ${props.existing!.name}` : 'Create Cluster Group'}</span>
          <button class="modal-close" onClick={props.onClose} disabled={busy()}>✕</button>
        </div>
        <form onSubmit={submit}>
          <div class="modal-body">
            <Show when={error()}><div class="error" style="margin-bottom:.75rem">{error()}</div></Show>

            <Show when={!editing()}>
              <div class="form-row">
                <label class="form-label">Name <span style="color:var(--red)">*</span></label>
                <input class="form-input" value={name()} onInput={e => setName(e.currentTarget.value)}
                  placeholder="my-group" required disabled={busy()} />
              </div>
            </Show>

            <div class="form-row" style="margin-top:.75rem">
              <label class="form-label">Description</label>
              <input class="form-input" value={desc()} onInput={e => setDesc(e.currentTarget.value)}
                placeholder="Optional" disabled={busy()} />
            </div>

            <Show when={props.memberNames.length > 0}>
              <div class="form-row" style="margin-top:.75rem">
                <label class="form-label">Members</label>
                <div style="display:flex;flex-direction:column;gap:.3rem;margin-top:.25rem">
                  <For each={props.memberNames}>
                    {m => (
                      <label style="display:flex;align-items:center;gap:.5rem;cursor:pointer">
                        <input type="checkbox" checked={members().includes(m)} disabled={busy()}
                          onChange={() => toggleMember(m)} />
                        <span class="mono small">{m}</span>
                      </label>
                    )}
                  </For>
                </div>
              </div>
            </Show>
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

export default function Cluster() {
  const { remote } = useRemote();
  const { readOnly } = useRbac();

  const [info, { refetch: refetchInfo }] = createResource(remote, r =>
    fetch(`${baseForRemote(r)}/cluster`).then(res => res.json())
  );

  // Only fetch members/groups when clustering is actually enabled
  const clusterEnabled = () => info()?.metadata?.enabled === true;

  const [members, { refetch: refetchMembers }] = createResource(
    () => ({ r: remote(), enabled: clusterEnabled() }),
    ({ r, enabled }) => enabled
      ? fetch(`${baseForRemote(r)}/cluster/members?recursion=1`).then(res => res.json())
      : null,
  );
  const [groups, { refetch: refetchGroups }] = createResource(
    () => ({ r: remote(), enabled: clusterEnabled() }),
    ({ r, enabled }) => enabled
      ? fetch(`${baseForRemote(r)}/cluster/groups?recursion=1`).then(res => res.json())
      : null,
  );

  // Member detail drawer
  const [selectedMember, setSelectedMember] = createSignal<string | null>(null);
  const [memberDetail]  = createResource(
    () => ({ r: remote(), name: selectedMember() }),
    ({ r, name }) => name ? fetch(`${baseForRemote(r)}/cluster/members/${encodeURIComponent(name)}`).then(res => res.json()) : null,
  );
  const [memberPools] = createResource(
    () => ({ r: remote(), name: selectedMember() }),
    ({ r, name }) => name
      ? fetch(`${baseForRemote(r)}/storage-pools?recursion=1&target=${encodeURIComponent(name)}`).then(res => res.json()).catch(() => null)
      : null,
  );
  const [memberNets] = createResource(
    () => ({ r: remote(), name: selectedMember() }),
    ({ r, name }) => name
      ? fetch(`${baseForRemote(r)}/networks?recursion=1&target=${encodeURIComponent(name)}`).then(res => res.json()).catch(() => null)
      : null,
  );
  const [qMember, setQMember] = createSignal('');

  // Group modal
  const [showCreateGroup, setShowCreateGroup] = createSignal(false);
  const [editGroup,       setEditGroup]       = createSignal<ClusterGroup | null>(null);
  const [groupError,      setGroupError]      = createSignal<string | null>(null);
  const [qGroup,          setQGroup]          = createSignal('');

  // Member actions
  const [memberBusy,  setMemberBusy]  = createSignal<string | null>(null);
  const [memberError, setMemberError] = createSignal<string | null>(null);

  const member = () => memberDetail()?.metadata;
  const memberNames = () => (members()?.metadata ?? []).map(m => m.server_name);

  const filteredMembers = () => {
    const rows = members()?.metadata ?? [];
    const s = qMember().toLowerCase();
    if (!s) return rows;
    return rows.filter(m =>
      m.server_name.toLowerCase().includes(s) ||
      m.status.toLowerCase().includes(s) ||
      m.architecture.toLowerCase().includes(s) ||
      (m.roles ?? []).join(' ').toLowerCase().includes(s)
    );
  };

  const filteredGroups = () => {
    const rows = groups()?.metadata ?? [];
    const s = qGroup().toLowerCase();
    if (!s) return rows;
    return rows.filter(g =>
      g.name.toLowerCase().includes(s) ||
      (g.description ?? '').toLowerCase().includes(s)
    );
  };

  async function handleEvacuate(name: string, action: 'evacuate' | 'restore') {
    const label = action === 'evacuate' ? 'evacuate' : 'restore';
    if (!confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} member "${name}"?`)) return;
    setMemberError(null);
    setMemberBusy(`${name}:${action}`);
    try {
      const resp = await evacuateClusterMember(name, action);
      if ((resp as any).operation) await waitForOperation((resp as any).operation);
      refetchMembers();
    } catch (e: any) { setMemberError(e.message ?? String(e)); }
    finally { setMemberBusy(null); }
  }

  function refetch() {
    refetchInfo();
    if (clusterEnabled()) { refetchMembers(); refetchGroups(); }
  }

  async function handleDeleteGroup(name: string) {
    setGroupError(null);
    if (!confirm(`Delete cluster group "${name}"? This cannot be undone.`)) return;
    try {
      await deleteClusterGroup(name);
      refetchGroups();
    } catch (err: any) { setGroupError(err.message ?? String(err)); }
  }

  return (
    <div>
      {/* ── Cluster Group modals ──────────────────────────────────────────── */}
      <Show when={showCreateGroup()}>
        <GroupModal
          memberNames={memberNames()}
          onClose={() => setShowCreateGroup(false)}
          onSaved={() => { setShowCreateGroup(false); refetchGroups(); }}
        />
      </Show>
      <Show when={editGroup()}>
        <GroupModal
          existing={editGroup()!}
          memberNames={memberNames()}
          onClose={() => setEditGroup(null)}
          onSaved={() => { setEditGroup(null); refetchGroups(); }}
        />
      </Show>

      {/* ── Cluster Info card ─────────────────────────────────────────────── */}
      <Show when={info()}>
        <div class="card" style="margin-bottom:1rem">
          <div class="card-header">
            <span>Cluster Info</span>
          </div>
          <div class="kv-list" style="padding:.75rem 1rem">
            <span class="kv-list-key">Enabled</span>
            <span class="kv-list-val">{info()!.metadata.enabled ? 'Yes' : 'No'}</span>
            <Show when={info()!.metadata.server_name}>
              <span class="kv-list-key">This server</span>
              <span class="kv-list-val fw-medium">{info()!.metadata.server_name}</span>
            </Show>
            <Show when={info()!.metadata.server_address}>
              <span class="kv-list-key">Address</span>
              <span class="kv-list-val mono small">{info()!.metadata.server_address}</span>
            </Show>
          </div>
        </div>
      </Show>

      {/* ── Members table ─────────────────────────────────────────────────── */}
      <div class="card" style="margin-bottom:1rem">
        <div class="card-header">
          <span>Cluster Members</span>
          <div class="card-toolbar">
            <input class="search-input" placeholder="Filter members…" value={qMember()} onInput={e => setQMember(e.currentTarget.value)} />
            <button class="btn btn-sm" onClick={refetch}>↻ Refresh</button>
          </div>
        </div>

        <Show when={memberError()}>
          <div class="error" style="margin:.5rem 1rem">{memberError()}</div>
        </Show>

        <Show when={info.loading}><div class="loading">Loading…</div></Show>
        <Show when={info.error}><div class="error">Failed to load cluster info</div></Show>

        <Show when={info() && !clusterEnabled()}>
          <div class="drawer-empty" style="padding:1.5rem 1rem">
            This server is not part of a cluster.
          </div>
        </Show>

        <Show when={clusterEnabled()}>
          <Show when={members.loading}><div class="loading">Loading members…</div></Show>
          <Show when={members.error}><div class="error">Failed to load cluster members</div></Show>
          <Show when={members()}>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>URL</th>
                  <th>Architecture</th>
                  <th>Roles</th>
                  <th>Database</th>
                  <th>Message</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <For
                  each={filteredMembers()}
                  fallback={<tr><td colspan="8" class="empty">{qMember() ? 'No members match your filter' : 'No cluster members'}</td></tr>}
                >
                  {(m: ClusterMember) => {
                    const isSel   = () => selectedMember() === m.server_name;
                    const isBusy  = () => memberBusy()?.startsWith(m.server_name + ':') ?? false;
                    return (
                      <tr
                        class={`row-clickable${isSel() ? ' row-selected' : ''}`}
                        onClick={() => isSel() ? setSelectedMember(null) : setSelectedMember(m.server_name)}
                      >
                        <td class="fw-medium">{m.server_name}</td>
                        <td><span class={statusBadge(m.status)}>{m.status}</span></td>
                        <td class="mono small">{m.url}</td>
                        <td>{m.architecture}</td>
                        <td>{m.roles?.join(', ') || '—'}</td>
                        <td>{m.database ? 'Yes' : 'No'}</td>
                        <td class="muted small">{m.message || '—'}</td>
                        <td style="white-space:nowrap" onClick={e => e.stopPropagation()}>
                          <Show when={!readOnly()}>
                            <Show when={m.status !== 'Evacuated'}>
                              <button class="btn btn-sm btn-yellow" disabled={isBusy()}
                                onClick={() => handleEvacuate(m.server_name, 'evacuate')}>
                                {memberBusy() === `${m.server_name}:evacuate` ? '…' : 'Evacuate'}
                              </button>
                            </Show>
                            <Show when={m.status === 'Evacuated'}>
                              <button class="btn btn-sm btn-green" disabled={isBusy()}
                                onClick={() => handleEvacuate(m.server_name, 'restore')}>
                                {memberBusy() === `${m.server_name}:restore` ? '…' : 'Restore'}
                              </button>
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
        </Show>
      </div>

      {/* ── Cluster Groups table ──────────────────────────────────────────── */}
      <Show when={clusterEnabled()}>
        <div class="card">
          <div class="card-header">
            <span>Cluster Groups</span>
            <div class="card-toolbar">
              <input class="search-input" placeholder="Filter groups…" value={qGroup()} onInput={e => setQGroup(e.currentTarget.value)} />
              <Show when={!readOnly()}>
                <button class="btn btn-sm btn-primary" onClick={() => setShowCreateGroup(true)}>+ Create</button>
              </Show>
              <button class="btn btn-sm" onClick={() => refetchGroups()}>↻ Refresh</button>
            </div>
          </div>

          <Show when={groupError()}><div class="error" style="margin:.5rem 1rem">{groupError()}</div></Show>
          <Show when={groups.loading}><div class="loading">Loading groups…</div></Show>
          <Show when={groups.error}><div class="error">Failed to load cluster groups</div></Show>

          <Show when={groups()}>
            <table class="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Description</th>
                  <th>Members</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <For
                  each={filteredGroups()}
                  fallback={<tr><td colspan="4" class="empty">{qGroup() ? 'No groups match your filter' : 'No cluster groups'}</td></tr>}
                >
                  {(g: ClusterGroup) => (
                    <tr>
                      <td class="fw-medium">{g.name}</td>
                      <td>{g.description || '—'}</td>
                      <td class="mono small">{(g.members ?? []).join(', ') || '—'}</td>
                      <td style="white-space:nowrap">
                        <Show when={!readOnly()}>
                          <button class="btn btn-sm" style="margin-right:.3rem"
                            onClick={() => setEditGroup(g)}>Edit</button>
                          <button class="btn btn-sm btn-danger"
                            onClick={() => handleDeleteGroup(g.name)}>Delete</button>
                        </Show>
                      </td>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>
        </div>
      </Show>

      {/* ── Member detail drawer ──────────────────────────────────────────── */}
      <Drawer
        open={!!selectedMember()}
        title={`Member: ${selectedMember() ?? ''}`}
        onClose={() => setSelectedMember(null)}
      >
        <Show when={memberDetail.loading}><div class="loading">Loading…</div></Show>
        <Show when={member()}>
          <div class="drawer-section">
            <div class="drawer-section-title">Overview</div>
            <div class="kv-list">
              <span class="kv-list-key">Status</span>
              <span class="kv-list-val">
                <span class={statusBadge(member()!.status)}>{member()!.status}</span>
              </span>
              <span class="kv-list-key">URL</span>
              <span class="kv-list-val mono small">{member()!.url}</span>
              <span class="kv-list-key">Architecture</span>
              <span class="kv-list-val">{member()!.architecture}</span>
              <span class="kv-list-key">Database</span>
              <span class="kv-list-val">{member()!.database ? 'Yes' : 'No'}</span>
              <Show when={member()!.message}>
                <span class="kv-list-key">Message</span>
                <span class="kv-list-val muted">{member()!.message}</span>
              </Show>
            </div>
          </div>

          <div class="drawer-section">
            <div class="drawer-section-title">Roles</div>
            <Show
              when={(member()!.roles?.length ?? 0) > 0}
              fallback={<div class="drawer-empty">No roles assigned</div>}
            >
              <div class="kv-list">
                <For each={member()!.roles}>
                  {role => (
                    <>
                      <span class="kv-list-key">role</span>
                      <span class="kv-list-val">{role}</span>
                    </>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Storage Pools */}
          <div class="drawer-section">
            <div class="drawer-section-title">Storage Pools</div>
            <Show when={memberPools.loading}><div class="loading">Loading…</div></Show>
            <Show when={!memberPools.loading && (memberPools()?.metadata?.length ?? 0) === 0}>
              <div class="drawer-empty">No storage pools</div>
            </Show>
            <Show when={(memberPools()?.metadata?.length ?? 0) > 0}>
              <table class="data-table" style={{ 'font-size': '.82rem' }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Driver</th>
                    <th>Status</th>
                    <th>Used by</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={memberPools()!.metadata}>
                    {pool => (
                      <tr>
                        <td class="fw-medium">{pool.name}</td>
                        <td><span class="badge badge-gray" style={{ 'font-size': '.68rem' }}>{pool.driver}</span></td>
                        <td>
                          <span class={pool.status === 'Created' ? 'badge badge-green' : 'badge badge-yellow'}
                            style={{ 'font-size': '.68rem' }}>
                            {pool.status}
                          </span>
                        </td>
                        <td class="muted">{pool.used_by?.length ?? 0}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </div>

          {/* Networks */}
          <div class="drawer-section">
            <div class="drawer-section-title">Networks</div>
            <Show when={memberNets.loading}><div class="loading">Loading…</div></Show>
            <Show when={!memberNets.loading && (memberNets()?.metadata?.length ?? 0) === 0}>
              <div class="drawer-empty">No networks</div>
            </Show>
            <Show when={(memberNets()?.metadata?.length ?? 0) > 0}>
              <table class="data-table" style={{ 'font-size': '.82rem' }}>
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Managed</th>
                    <th>Address</th>
                  </tr>
                </thead>
                <tbody>
                  <For each={memberNets()!.metadata}>
                    {net => (
                      <tr>
                        <td class="fw-medium">{net.name}</td>
                        <td><span class="badge badge-gray" style={{ 'font-size': '.68rem' }}>{net.type}</span></td>
                        <td>
                          <Show when={net.managed} fallback={<span class="muted">—</span>}>
                            <span class="badge badge-green" style={{ 'font-size': '.68rem' }}>managed</span>
                          </Show>
                        </td>
                        <td class="mono small muted">
                          {net.config?.['ipv4.address'] ?? net.config?.['ipv6.address'] ?? '—'}
                        </td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </div>

          <div class="drawer-section">
            <div class="drawer-section-title">Config</div>
            <KVList entries={Object.entries(member()!.config ?? {})} />
          </div>
        </Show>
      </Drawer>
    </div>
  );
}
