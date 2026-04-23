/**
 * Known Incus instance/profile configuration keys.
 * Used to populate datalist suggestions on config key inputs.
 * Free-form prefixes (user.*, environment.*, etc.) are listed with a
 * representative placeholder — users can still type any value.
 */
export const KNOWN_CONFIG_KEYS: { key: string; desc: string }[] = [
  // Misc
  { key: 'agent.nic_config',           desc: 'Use default NIC name/MTU in VM (bool)' },
  { key: 'cluster.evacuate',           desc: 'Evacuation mode: auto|live-migrate|migrate|stop|stateful-stop|force-stop' },
  { key: 'linux.kernel_modules',       desc: 'Comma-separated kernel modules to load (container)' },
  { key: 'environment.',               desc: 'Environment variable prefix, e.g. environment.FOO' },
  { key: 'user.',                       desc: 'Free-form user metadata prefix, e.g. user.mykey' },
  { key: 'linux.sysctl.',              desc: 'Sysctl override prefix, e.g. linux.sysctl.net.ipv4.ip_forward' },
  { key: 'smbios11.',                  desc: 'SMBIOS Type 11 key prefix (VM)' },
  { key: 'systemd.credential.',        desc: 'Systemd credential prefix' },

  // Boot
  { key: 'boot.autorestart',           desc: 'Auto-restart on unexpected exit (bool)' },
  { key: 'boot.autostart',             desc: 'Start on daemon start (bool)' },
  { key: 'boot.autostart.delay',       desc: 'Seconds to wait before starting next instance (int)' },
  { key: 'boot.autostart.priority',    desc: 'Start order priority (int, higher = first)' },
  { key: 'boot.host_shutdown_action',  desc: 'Action on host shutdown: stop|force-stop|stateful-stop' },
  { key: 'boot.host_shutdown_timeout', desc: 'Seconds before force-stop on host shutdown (int, default 30)' },
  { key: 'boot.stop.priority',         desc: 'Shutdown order priority (int, higher = first)' },

  // cloud-init
  { key: 'cloud-init.network-config',  desc: 'cloud-init network config (YAML)' },
  { key: 'cloud-init.user-data',       desc: 'cloud-init user-data' },
  { key: 'cloud-init.vendor-data',     desc: 'cloud-init vendor-data' },

  // Resource limits
  { key: 'limits.cpu',                 desc: 'CPU count or pinned range, e.g. 2 or 0-3' },
  { key: 'limits.cpu.allowance',       desc: 'CPU soft/hard limit, e.g. 50% or 25ms/100ms (container)' },
  { key: 'limits.cpu.nodes',           desc: 'NUMA node IDs or "balanced"' },
  { key: 'limits.cpu.priority',        desc: 'CPU scheduling priority 0-10 (container)' },
  { key: 'limits.disk.priority',       desc: 'I/O priority 0-10 (default 5)' },
  { key: 'limits.memory',              desc: 'Memory limit, e.g. 512MB or 2GB' },
  { key: 'limits.memory.enforce',      desc: 'hard or soft (container)' },
  { key: 'limits.memory.hotplug',      desc: 'Hotplug upper limit or false (VM)' },
  { key: 'limits.memory.hugepages',    desc: 'Back instance with huge pages (bool, VM, requires restart)' },
  { key: 'limits.memory.oom_priority', desc: 'OOM score adjustment -1000 to 1000' },
  { key: 'limits.memory.swap',         desc: 'Allow swap: true|false or bytes value (container)' },
  { key: 'limits.memory.swap.priority',desc: 'Swap priority 0-10 (container)' },
  { key: 'limits.processes',           desc: 'Max processes (container)' },
  { key: 'limits.hugepages.64KB',      desc: 'Huge page limit (container)' },
  { key: 'limits.hugepages.1MB',       desc: 'Huge page limit (container)' },
  { key: 'limits.hugepages.2MB',       desc: 'Huge page limit (container)' },
  { key: 'limits.hugepages.1GB',       desc: 'Huge page limit (container)' },

  // Migration
  { key: 'migration.stateful',         desc: 'Enable stateful stop/start for live migration (bool, VM)' },

  // Security
  { key: 'security.devlxd',            desc: 'Expose /dev/incus (bool, container)' },
  { key: 'security.idmap.isolated',    desc: 'Use isolated idmap (bool, container)' },
  { key: 'security.nesting',           desc: 'Allow nested containers (bool, container)' },
  { key: 'security.privileged',        desc: 'Run privileged/unconfined (bool, container)' },
  { key: 'security.protection.delete', desc: 'Prevent deletion (bool)' },
  { key: 'security.protection.shift',  desc: 'Prevent idmap shift (bool, container)' },
  { key: 'security.secureboot',        desc: 'Enable Secure Boot (bool, VM)' },
  { key: 'security.syscalls.deny',     desc: 'Comma-separated syscalls to block (container)' },
  { key: 'security.syscalls.allow',    desc: 'Comma-separated syscalls to allow (container)' },
  { key: 'security.tpm',               desc: 'Add virtual TPM (bool, VM)' },

  // Snapshots
  { key: 'snapshots.schedule',         desc: 'Cron expression for auto-snapshots, e.g. @daily' },
  { key: 'snapshots.schedule.stopped', desc: 'Snapshot stopped instances too (bool)' },
  { key: 'snapshots.expiry',           desc: 'Snapshot TTL, e.g. 24h or 7d' },
  { key: 'snapshots.pattern',          desc: 'Snapshot name template, e.g. snap%d' },

  // Raw overrides
  { key: 'raw.apparmor',               desc: 'Extra AppArmor rules (container)' },
  { key: 'raw.idmap',                  desc: 'Raw idmap overrides (container)' },
  { key: 'raw.lxc',                    desc: 'Raw LXC config (container)' },
  { key: 'raw.qemu',                   desc: 'Raw QEMU config (VM)' },
  { key: 'raw.qemu.conf',              desc: 'Raw QEMU conf override (VM)' },
  { key: 'raw.seccomp',                desc: 'Raw seccomp policy (container)' },

  // NVIDIA / CUDA
  { key: 'nvidia.driver.capabilities', desc: 'NVIDIA driver capabilities (container)' },
  { key: 'nvidia.runtime',             desc: 'Pass NVIDIA runtime into container (bool)' },
];
