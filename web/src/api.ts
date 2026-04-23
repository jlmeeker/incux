// api.ts — typed wrappers around the Incus REST API proxied at /api/1.0

// Active remote name — "local" means use the default /api/1.0 path.
// Non-local remotes proxy through /api/remotes/<name>/1.0.
let _activeRemote = 'local';

export function setActiveRemote(name: string) {
  _activeRemote = name || 'local';
}

export function getActiveRemote(): string {
  return _activeRemote;
}

/** Returns the base API path for a given remote name. */
export function baseForRemote(remote: string): string {
  return remote === 'local'
    ? '/api/1.0'
    : `/api/remotes/${encodeURIComponent(remote)}/1.0`;
}

function base(): string {
  return baseForRemote(_activeRemote);
}

// BASE is kept for the handful of raw fetch() calls that build URLs directly.
// They call base() at call time so they always use the current remote.
const BASE = { get value() { return base(); } };

async function req<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(base() + path, options);
  if (!res.ok) {
    // Try to extract Incus's structured error message from the JSON envelope.
    // Falls back to the raw text if parsing fails.
    let message = res.statusText;
    try {
      const body = await res.json() as { error?: string };
      message = body.error || JSON.stringify(body);
    } catch {
      message = await res.text().catch(() => res.statusText);
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

/** Returns "?project=<name>" when project is non-empty and not "default".
 *  The special value "*" emits "?all-projects=true" to fetch across all projects.
 *  Incus treats the absence of the param as "default". */
function p(project?: string): string {
  if (!project) return '';
  if (project === '*') return '?all-projects=true';
  if (project === 'default') return '';
  return `?project=${encodeURIComponent(project)}`;
}

/** Appends project param to an already-parameterised URL (one that already
 *  has a '?' in it, e.g. "/instances?recursion=2").
 *  The special value "*" appends "&all-projects=true". */
function ap(url: string, project?: string): string {
  if (!project) return url;
  if (project === '*') return `${url}&all-projects=true`;
  if (project === 'default') return url;
  return `${url}&project=${encodeURIComponent(project)}`;
}

// ---------------------------------------------------------------------------
// Generic Incus response envelope
// ---------------------------------------------------------------------------
export interface IncusResponse<T> {
  type: string;       // "sync" | "async" | "error"
  status: string;
  status_code: number;
  metadata: T;
  operation?: string; // present on async responses, e.g. "/1.0/operations/<id>"
}

// ---------------------------------------------------------------------------
// Remotes (Incux-internal endpoint, not part of Incus API)
// ---------------------------------------------------------------------------
export interface RemoteInfo {
  name: string;
  address: string;
}

export async function getRemotes(): Promise<RemoteInfo[]> {
  const res = await fetch('/api/remotes');
  if (!res.ok) return [{ name: 'local', address: '' }];
  return res.json();
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------
export interface Project {
  name: string;
  description: string;
  config: Record<string, string>;
  used_by: string[];
}

export const getProjects = (remote?: string) => {
  const b = remote ? baseForRemote(remote) : base();
  return fetch(b + '/projects?recursion=1').then(r => r.json()) as Promise<IncusResponse<Project[]>>;
};
export const getProject  = (name: string) => req<IncusResponse<Project>>(`/projects/${name}`);

export const createProject = (body: { name: string; description?: string; config?: Record<string, string> }) =>
  req<IncusResponse<unknown>>('/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const updateProject = (name: string, body: { description?: string; config?: Record<string, string> }) =>
  req<IncusResponse<unknown>>(`/projects/${name}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const deleteProject = (name: string) =>
  req<IncusResponse<unknown>>(`/projects/${name}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Server / resources
// ---------------------------------------------------------------------------
export interface ServerInfo {
  api_version: string;
  api_status: string;
  auth: string;
  environment: {
    server: string;
    server_version: string;
    kernel: string;
    kernel_version: string;
    os: string;
    architectures: string[];
    driver: string;
    driver_version: string;
    storage: string;
    storage_version: string;
  };
}

export interface Resources {
  cpu: { total: number; architecture: string };
  memory: { total: number; used: number };
  storage: Record<string, { total: number; used: number }>;
}

export const getServerInfo = () => req<IncusResponse<ServerInfo>>('');
export const getResources  = () => req<IncusResponse<Resources>>('/resources');

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------
export type InstanceStatus = 'Running' | 'Stopped' | 'Frozen' | 'Error' | string;
export type InstanceType   = 'container' | 'virtual-machine';

export interface Instance {
  name: string;
  description: string;
  status: InstanceStatus;
  type: InstanceType;
  architecture: string;
  created_at: string;
  last_used_at: string;
  profiles: string[];
  config: Record<string, string>;
  expanded_config: Record<string, string>;
  state?: InstanceState;
  project?: string;
  devices?: Record<string, Record<string, string>>;
}

export interface InstanceState {
  status: InstanceStatus;
  status_code: number;
  cpu: { usage: number };
  memory: { usage: number; usage_peak: number; total: number; swap_usage: number; swap_usage_peak: number };
  network?: Record<string, NetworkInterface>;
  disk?: Record<string, { usage: number }>;
  pid: number;
  processes: number;
}

export interface NetworkInterface {
  addresses: Array<{ family: string; address: string; netmask: string; scope: string }>;
  counters: {
    bytes_received: number;
    bytes_sent: number;
    packets_received: number;
    packets_sent: number;
    errors_received: number;
    errors_sent: number;
  };
  state: string;
  type: string;
}

/** Makes a typed request against a specific remote's base URL. */
export async function reqFor<T>(remote: string, path: string, options?: RequestInit): Promise<T> {
  const b = baseForRemote(remote);
  const res = await fetch(b + path, options);
  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json() as { error?: string };
      message = body.error || JSON.stringify(body);
    } catch {
      message = await res.text().catch(() => res.statusText);
    }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export const getInstances     = (project?: string) => req<IncusResponse<Instance[]>>(ap('/instances?recursion=2', project));
export const getInstance      = (name: string, project?: string) => req<IncusResponse<Instance>>(`/instances/${name}${p(project)}`);
export const getInstanceState = (name: string, project?: string, remote?: string) =>
  remote
    ? reqFor<IncusResponse<InstanceState>>(remote, `/instances/${name}/state${p(project)}`)
    : req<IncusResponse<InstanceState>>(`/instances/${name}/state${p(project)}`);

export type InstanceAction = 'start' | 'stop' | 'restart' | 'freeze' | 'unfreeze';
export const putInstanceState = (name: string, action: InstanceAction, force = false, project?: string) =>
  req<IncusResponse<unknown>>(`/instances/${name}/state${p(project)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, force }),
  });

export const createInstance = (body: unknown, project?: string) =>
  req<IncusResponse<unknown>>(`/instances${p(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const deleteInstance = (name: string, project?: string) =>
  req<IncusResponse<unknown>>(`/instances/${name}${p(project)}`, { method: 'DELETE' });

export const patchInstance = (
  name: string,
  body: { description?: string; config?: Record<string, string>; profiles?: string[]; devices?: Record<string, Record<string, string>> },
  project?: string,
) =>
  req<IncusResponse<unknown>>(`/instances/${name}${p(project)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const renameInstance = (name: string, newName: string, project?: string) =>
  req<IncusResponse<unknown>>(`/instances/${name}${p(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: newName }),
  });

// Poll an async operation until it reaches a terminal state. Returns the completed Operation.
export async function waitForOperation(opUrl: string, timeoutMs = 120_000): Promise<Operation> {
  const path = opUrl.replace(/^\/1\.0/, '');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await req<IncusResponse<Operation>>(`${path}/wait?timeout=5`);
    const st = res.metadata?.status;
    if (st === 'Success') return res.metadata;
    if (st === 'Failure' || st === 'Cancelled') {
      throw new Error(res.metadata?.err || `Operation ${st.toLowerCase()}`);
    }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error('Timed out waiting for operation');
}

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

export interface Image {
  fingerprint: string;
  filename: string;
  size: number;
  architecture: string;
  type: string;
  public: boolean;
  cached: boolean;
  created_at: string;
  uploaded_at: string;
  properties: { description?: string; os?: string; release?: string; variant?: string };
  aliases: Array<{ name: string; description: string }>;
}

export interface ImageAlias {
  name: string;
  description: string;
  target: string; // fingerprint
  type: string;   // "container" | "virtual-machine"
}

export const getImages       = (project?: string) => req<IncusResponse<Image[]>>(ap('/images?recursion=1', project));
export const getImageAliases = (project?: string) => req<IncusResponse<ImageAlias[]>>(ap('/images/aliases?recursion=1', project));
export const deleteImage     = (fingerprint: string, project?: string) =>
  req<IncusResponse<unknown>>(`/images/${fingerprint}${p(project)}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Networks
// ---------------------------------------------------------------------------
export interface Network {
  name: string;
  description: string;
  type: string;
  managed: boolean;
  status: string;
  config: Record<string, string>;
  used_by: string[];
}

export interface NetworkState {
  addresses: Array<{ family: string; address: string; netmask: string; scope: string }>;
  counters: { bytes_received: number; bytes_sent: number; packets_received: number; packets_sent: number };
  hwaddr: string;
  mtu: number;
  state: string;
  type: string;
}

export const getNetworks     = (project?: string) => req<IncusResponse<Network[]>>(ap('/networks?recursion=1', project));
export const getNetworkState = (name: string, project?: string) => req<IncusResponse<NetworkState>>(`/networks/${name}/state${p(project)}`);

export const createNetwork = (body: { name: string; description?: string; type: string; config?: Record<string, string> }, project?: string) =>
  req<IncusResponse<unknown>>(`/networks${p(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const updateNetwork = (name: string, body: { description?: string; config?: Record<string, string> }, project?: string) =>
  req<IncusResponse<unknown>>(`/networks/${name}${p(project)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const deleteNetwork = (name: string, project?: string) =>
  req<IncusResponse<unknown>>(`/networks/${name}${p(project)}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Storage pools
// ---------------------------------------------------------------------------
export interface StoragePool {
  name: string;
  description: string;
  driver: string;
  status: string;
  config: Record<string, string>;
  used_by: string[];
}

export interface StoragePoolResources {
  space: { total: number; used: number };
  inodes: { total: number; used: number };
}

export interface StorageVolume {
  name: string;
  type: string;
  description: string;
  config: Record<string, string>;
  pool: string;
  content_type: string;
  created_at: string;
  used_by: string[];
}

export const getStoragePools         = (project?: string) => req<IncusResponse<StoragePool[]>>(ap('/storage-pools?recursion=1', project));
export const getStoragePoolResources = (pool: string, project?: string) => req<IncusResponse<StoragePoolResources>>(`/storage-pools/${pool}/resources${p(project)}`);
export const getStorageVolumes       = (pool: string, project?: string) => req<IncusResponse<StorageVolume[]>>(ap(`/storage-pools/${pool}/volumes?recursion=1`, project));

export const createStoragePool = (body: { name: string; driver: string; description?: string; config?: Record<string, string> }) =>
  req<IncusResponse<unknown>>('/storage-pools', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const deleteStoragePool = (pool: string) =>
  req<IncusResponse<unknown>>(`/storage-pools/${pool}`, { method: 'DELETE' });

export const updateStoragePool = (pool: string, body: { description?: string; config?: Record<string, string> }) =>
  req<IncusResponse<unknown>>(`/storage-pools/${pool}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const createStorageVolume = (pool: string, body: { name: string; type?: string; description?: string; config?: Record<string, string> }, project?: string) =>
  req<IncusResponse<unknown>>(`/storage-pools/${pool}/volumes${p(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const deleteStorageVolume = (pool: string, type: string, name: string, project?: string) =>
  req<IncusResponse<unknown>>(`/storage-pools/${pool}/volumes/${type}/${name}${p(project)}`, { method: 'DELETE' });

export const updateStorageVolume = (pool: string, type: string, name: string, body: { description?: string; config?: Record<string, string> }, project?: string) =>
  req<IncusResponse<unknown>>(`/storage-pools/${pool}/volumes/${type}/${name}${p(project)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Profiles
// ---------------------------------------------------------------------------
export interface Profile {
  name: string;
  description: string;
  config: Record<string, string>;
  devices: Record<string, Record<string, string>>;
  used_by: string[];
}

export const getProfiles = (project?: string) => req<IncusResponse<Profile[]>>(ap('/profiles?recursion=1', project));
export const getProfile  = (name: string, project?: string) => req<IncusResponse<Profile>>(`/profiles/${name}${p(project)}`);

export const createProfile = (body: { name: string; description?: string; config?: Record<string, string>; devices?: Record<string, Record<string, string>> }, project?: string) =>
  req<IncusResponse<unknown>>(`/profiles${p(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const updateProfile = (name: string, body: { description?: string; config?: Record<string, string>; devices?: Record<string, Record<string, string>> }, project?: string) =>
  req<IncusResponse<unknown>>(`/profiles/${name}${p(project)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const deleteProfile = (name: string, project?: string) =>
  req<IncusResponse<unknown>>(`/profiles/${name}${p(project)}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------
export interface Snapshot {
  name: string;
  description: string;
  created_at: string;
  expires_at: string;
  stateful: boolean;
  size: number;
}

export const getSnapshots = (instance: string, project?: string) =>
  req<IncusResponse<Snapshot[]>>(ap(`/instances/${instance}/snapshots?recursion=1`, project));

export const createSnapshot = (instance: string, name: string, stateful = false, project?: string) =>
  req<IncusResponse<unknown>>(`/instances/${instance}/snapshots${p(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, stateful }),
  });

export const deleteSnapshot = (instance: string, snap: string, project?: string) =>
  req<IncusResponse<unknown>>(`/instances/${instance}/snapshots/${snap}${p(project)}`, { method: 'DELETE' });

export const restoreSnapshot = (instance: string, snap: string, project?: string) =>
  req<IncusResponse<unknown>>(`/instances/${instance}${p(project)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restore: snap }),
  });

// ---------------------------------------------------------------------------
// Cluster
// ---------------------------------------------------------------------------
export interface ClusterInfo {
  enabled: boolean;
  server_name: string;
  server_address: string;
}

export interface ClusterMember {
  server_name: string;
  url: string;
  database: boolean;
  status: string;   // "Online" | "Offline" | "Evacuated" | string
  message: string;
  architecture: string;
  roles: string[];
  config: Record<string, string>;
}

export const getCluster        = () => req<IncusResponse<ClusterInfo>>('/cluster');
export const getClusterMembers = () => req<IncusResponse<ClusterMember[]>>('/cluster/members?recursion=1');
export const getClusterMember  = (name: string) => req<IncusResponse<ClusterMember>>(`/cluster/members/${name}`);
export const getClusterMemberStoragePools = (member: string) => req<IncusResponse<StoragePool[]>>(`/storage-pools?recursion=1&target=${encodeURIComponent(member)}`);
export const getClusterMemberNetworks     = (member: string) => req<IncusResponse<Network[]>>(`/networks?recursion=1&target=${encodeURIComponent(member)}`);
export const evacuateClusterMember = (name: string, action: 'evacuate' | 'restore') =>
  req<IncusResponse<unknown>>(`/cluster/members/${name}/state`, { method: 'POST', body: JSON.stringify({ action }) });

export interface ClusterGroup {
  name: string;
  description: string;
  members: string[];
}

export const getClusterGroups     = () => req<IncusResponse<ClusterGroup[]>>('/cluster/groups?recursion=1');
export const getClusterGroup      = (name: string) => req<IncusResponse<ClusterGroup>>(`/cluster/groups/${name}`);
export const createClusterGroup   = (body: { name: string; description?: string; members?: string[] }) =>
  req<IncusResponse<unknown>>('/cluster/groups', { method: 'POST', body: JSON.stringify(body) });
export const updateClusterGroup   = (name: string, body: { description?: string; members?: string[] }) =>
  req<IncusResponse<unknown>>(`/cluster/groups/${name}`, { method: 'PUT', body: JSON.stringify(body) });
export const deleteClusterGroup   = (name: string) =>
  req<IncusResponse<unknown>>(`/cluster/groups/${name}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------
export interface Operation {
  id: string;
  class: string;
  description: string;
  created_at: string;
  updated_at: string;
  status: string;
  status_code: number;
  may_cancel: boolean;
  err: string;
  metadata: unknown;
  resources?: { instances?: string[]; containers?: string[] };
}

export const getOperations    = () => req<IncusResponse<Record<string, Operation[]>>>('/operations?recursion=1');
export const cancelOperation  = (id: string) => req<IncusResponse<unknown>>(`/operations/${id}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Instance Backups
// ---------------------------------------------------------------------------
export interface InstanceBackup {
  name: string;
  created_at: string;
  expires_at: string;
  instance_only: boolean;
  optimized_storage: boolean;
}

export const getBackups    = (instance: string, project?: string) =>
  req<IncusResponse<InstanceBackup[]>>(`/instances/${instance}/backups?recursion=1${project && project !== 'default' ? '&project=' + encodeURIComponent(project) : ''}`);
export const createBackup  = (instance: string, body: { name?: string; expires_at?: string; instance_only?: boolean; optimized_storage?: boolean }, project?: string) =>
  req<IncusResponse<unknown>>(`/instances/${instance}/backups${p(project)}`, { method: 'POST', body: JSON.stringify(body) });
export const deleteBackup  = (instance: string, backup: string, project?: string) =>
  req<IncusResponse<unknown>>(`/instances/${instance}/backups/${backup}${p(project)}`, { method: 'DELETE' });
export const downloadBackupUrl = (instance: string, backup: string, project?: string) =>
  `${BASE.value}/instances/${instance}/backups/${backup}/export${p(project)}`;

// ---------------------------------------------------------------------------
// Instance Files
// ---------------------------------------------------------------------------
export const getInstanceFile = (instance: string, path: string, project?: string) =>
  fetch(`${BASE.value}/instances/${instance}/files?path=${encodeURIComponent(path)}${project && project !== 'default' ? '&project=' + encodeURIComponent(project) : ''}`);
export const putInstanceFile = (instance: string, path: string, content: Blob | string, project?: string) =>
  fetch(`${BASE.value}/instances/${instance}/files?path=${encodeURIComponent(path)}${project && project !== 'default' ? '&project=' + encodeURIComponent(project) : ''}`, {
    method: 'POST',
    body: content,
    headers: typeof content === 'string' ? { 'Content-Type': 'text/plain' } : {},
  });
export const listInstanceFiles = (instance: string, path: string, project?: string) =>
  req<IncusResponse<string[]>>(`/instances/${instance}/files?path=${encodeURIComponent(path)}${project && project !== 'default' ? '&project=' + encodeURIComponent(project) : ''}`);

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------
export interface Warning {
  uuid: string;
  type: string;
  status: string;
  severity: string;
  count: number;
  first_seen_at: string;
  last_seen_at: string;
  last_message: string;
  entity_url: string;
  project: string;
  location: string;
}

export const getWarnings        = () => req<IncusResponse<Warning[]>>('/warnings?recursion=1');
export const acknowledgeWarning = (uuid: string) =>
  req<IncusResponse<unknown>>(`/warnings/${uuid}`, { method: 'PATCH', body: JSON.stringify({ status: 'acknowledged' }) });
export const deleteWarning      = (uuid: string) =>
  req<IncusResponse<unknown>>(`/warnings/${uuid}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------
// Instance Logs
// ---------------------------------------------------------------------------
export const getInstanceLogs = (instance: string, project?: string) =>
  req<IncusResponse<string[]>>(`/instances/${instance}/logs${p(project)}`);
export const getInstanceLog  = (instance: string, filename: string, project?: string) =>
  fetch(`${BASE.value}/instances/${instance}/logs/${filename}${p(project)}`);

// ---------------------------------------------------------------------------
// Instance Metadata
// ---------------------------------------------------------------------------
export interface InstanceMetadata {
  architecture: string;
  creation_date: number;
  expiry_date: number;
  properties: Record<string, string>;
  templates: Record<string, unknown> | null;
}

export const getInstanceMetadata    = (instance: string, project?: string) =>
  req<IncusResponse<InstanceMetadata>>(`/instances/${instance}/metadata${p(project)}`);
export const updateInstanceMetadata = (instance: string, body: Partial<InstanceMetadata>, project?: string) =>
  req<IncusResponse<unknown>>(`/instances/${instance}/metadata${p(project)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

// ---------------------------------------------------------------------------
// Instance Copy / Migrate
// ---------------------------------------------------------------------------
export const copyInstance = (body: {
  name: string;
  type?: string;
  source: { type: 'copy'; source: string; project?: string };
  project?: string;
  profiles?: string[];
  config?: Record<string, string>;
}, project?: string) =>
  req<IncusResponse<unknown>>(`/instances${p(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

export const migrateInstance = (name: string, target: string, project?: string) =>
  req<IncusResponse<unknown>>(`/instances/${name}${p(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ migration: true, target }),
  });

// ---------------------------------------------------------------------------
// Storage Volume Snapshots
// ---------------------------------------------------------------------------
export interface VolumeSnapshot {
  name: string;
  description: string;
  created_at: string;
  expires_at: string;
  config: Record<string, string>;
}

export const getVolumeSnapshots    = (pool: string, volType: string, vol: string, project?: string) =>
  req<IncusResponse<VolumeSnapshot[]>>(
    `/storage-pools/${pool}/volumes/${volType}/${vol}/snapshots?recursion=1${project && project !== 'default' ? '&project=' + encodeURIComponent(project) : ''}`
  );
export const createVolumeSnapshot  = (pool: string, volType: string, vol: string, name: string, project?: string) =>
  req<IncusResponse<unknown>>(`/storage-pools/${pool}/volumes/${volType}/${vol}/snapshots${p(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
export const deleteVolumeSnapshot  = (pool: string, volType: string, vol: string, snap: string, project?: string) =>
  req<IncusResponse<unknown>>(`/storage-pools/${pool}/volumes/${volType}/${vol}/snapshots/${snap}${p(project)}`, { method: 'DELETE' });
export const restoreVolumeSnapshot = (pool: string, volType: string, vol: string, snap: string, project?: string) =>
  req<IncusResponse<unknown>>(`/storage-pools/${pool}/volumes/${volType}/${vol}${p(project)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ restore: snap }),
  });

// ---------------------------------------------------------------------------
// Storage Volume Backups
// ---------------------------------------------------------------------------
export interface VolumeBackup {
  name: string;
  created_at: string;
  expires_at: string;
  volume_only: boolean;
  optimized_storage: boolean;
}

export const getVolumeBackups   = (pool: string, volType: string, vol: string, project?: string) =>
  req<IncusResponse<VolumeBackup[]>>(
    `/storage-pools/${pool}/volumes/${volType}/${vol}/backups?recursion=1${project && project !== 'default' ? '&project=' + encodeURIComponent(project) : ''}`
  );
export const createVolumeBackup = (pool: string, volType: string, vol: string, body: { name?: string; expires_at?: string; volume_only?: boolean; optimized_storage?: boolean }, project?: string) =>
  req<IncusResponse<unknown>>(`/storage-pools/${pool}/volumes/${volType}/${vol}/backups${p(project)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
export const deleteVolumeBackup = (pool: string, volType: string, vol: string, backup: string, project?: string) =>
  req<IncusResponse<unknown>>(`/storage-pools/${pool}/volumes/${volType}/${vol}/backups/${backup}${p(project)}`, { method: 'DELETE' });
export const downloadVolumeBackupUrl = (pool: string, volType: string, vol: string, backup: string, project?: string) =>
  `${BASE.value}/storage-pools/${pool}/volumes/${volType}/${vol}/backups/${backup}/export${p(project)}`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function fmtBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

export function fmtDate(iso: string): string {
  if (!iso || iso.startsWith('0001')) return '—';
  return new Date(iso).toLocaleString();
}
