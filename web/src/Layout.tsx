import { createResource, createSignal, For, Show, JSX } from 'solid-js';
import { A, useLocation } from '@solidjs/router';
import { useProject } from './ProjectContext';
import { useRemote } from './RemoteContext';
import { useRbac } from './RbacContext';
import { getProjects, getRemotes, setActiveRemote } from './api';

interface NavItem {
  href: string;
  label: string;
  icon: string;
}

const NAV: NavItem[] = [
  { href: '/',           label: 'Dashboard',  icon: '⬡' },
  { href: '/instances',  label: 'Instances',  icon: '▣' },
  { href: '/images',     label: 'Images',     icon: '◫' },
  { href: '/networks',   label: 'Networks',   icon: '⬡' },
  { href: '/storage',    label: 'Storage',    icon: '◨' },
  { href: '/profiles',   label: 'Profiles',   icon: '◈' },
  { href: '/projects',   label: 'Projects',   icon: '◧' },
  { href: '/cluster',    label: 'Cluster',    icon: '⬡' },
  { href: '/operations', label: 'Operations', icon: '⚙' },
  { href: '/warnings',   label: 'Warnings',   icon: '⚠' },
  { href: '/activity',   label: 'Activity',   icon: '◉' },
];

interface LayoutProps {
  children: JSX.Element;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
}

export function Layout(props: LayoutProps) {
  const location = useLocation();
  const { project, setProject } = useProject();
  const { remote, setRemote }   = useRemote();
  const { isAdmin, readOnly }   = useRbac();
  const [projects, { refetch: refetchProjects }] = createResource(remote, (r) => getProjects(r));
  const [remotes]  = createResource(getRemotes);
  const [whoami]   = createResource(() => fetch('/whoami').then(r => r.json()).catch(() => ({ user: '', roles: [], is_admin: false })));

  const [projOpen,   setProjOpen]   = createSignal(false);
  const [remoteOpen, setRemoteOpen] = createSignal(false);

  function selectProject(name: string) {
    setProject(name);
    setProjOpen(false);
  }

  function selectRemote(name: string) {
    setRemote(name);
    setActiveRemote(name);
    setProject('default');
    setRemoteOpen(false);
  }

  // Keep api.ts in sync with the stored remote on mount
  setActiveRemote(remote());

  return (
    <div class="app-shell">
      <nav class="sidebar">
        <div class="sidebar-brand">
          <span class="brand-icon">⬡</span>
          <span class="brand-name">IncUX</span>
        </div>
        <ul class="nav-list">
          {NAV.map(item => (
            <li>
              <A
                href={item.href}
                class="nav-link"
                classList={{ active: location.pathname === item.href }}
                end={item.href === '/'}
              >
                <span class="nav-icon">{item.icon}</span>
                <span class="nav-label">{item.label}</span>
              </A>
            </li>
          ))}
        </ul>
      </nav>

      <div class="main-area">
        <header class="topbar">
          <div class="topbar-title">
            {NAV.find(n => n.href === location.pathname)?.label ?? 'IncUX'}
          </div>

          {/* Remote switcher — always visible */}
          <div style="position:relative">
            <button
              class="btn btn-sm"
              style="display:flex;align-items:center;gap:.4rem"
              onClick={() => setRemoteOpen(o => !o)}
            >
              <span class="muted small">remote:</span>
              <span style="font-weight:600;color:var(--primary)">{remote()}</span>
              <span style="font-size:.7rem;opacity:.6">{remoteOpen() ? '▲' : '▼'}</span>
            </button>

            <Show when={remoteOpen()}>
              <div
                style="position:fixed;inset:0;z-index:99"
                onClick={() => setRemoteOpen(false)}
              />
              <div style="position:absolute;right:0;top:calc(100% + 4px);z-index:100;min-width:180px;background:var(--surface);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.18);padding:.25rem 0">
                <Show when={remotes.loading}>
                  <div class="muted small" style="padding:.4rem .75rem">Loading…</div>
                </Show>
                <For each={(remotes() ?? []).filter(r => r.name !== 'images')}>
                  {r => (
                    <button
                      class="btn btn-ghost"
                      style={`display:block;width:100%;text-align:left;padding:.35rem .75rem;border-radius:0;font-size:.85rem;${remote() === r.name ? 'font-weight:700;color:var(--primary)' : ''}`}
                      onClick={() => selectRemote(r.name)}
                    >
                        <span style="display:flex;flex-direction:column;gap:1px">
                          <span>{r.name}</span>
                          <span class="muted" style="font-size:.72rem;font-weight:400">{r.address}</span>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            </div>

          {/* Project switcher */}
          <div class="project-switcher" style="position:relative">
            <button
              class="btn btn-sm"
              style="display:flex;align-items:center;gap:.4rem"
              onClick={() => setProjOpen(o => !o)}
            >
              <span class="muted small">project:</span>
              <span style="font-weight:600">{project() === '*' ? 'all projects' : project()}</span>
              <span style="font-size:.7rem;opacity:.6">{projOpen() ? '▲' : '▼'}</span>
            </button>

            <Show when={projOpen()}>
              {/* click-outside backdrop */}
              <div
                style="position:fixed;inset:0;z-index:99"
                onClick={() => setProjOpen(false)}
              />
              <div class="project-dropdown" style="position:absolute;right:0;top:calc(100% + 4px);z-index:100;min-width:160px;background:var(--surface);border:1px solid var(--border);border-radius:6px;box-shadow:0 4px 16px rgba(0,0,0,.18);padding:.25rem 0">
                <Show when={projects.loading}>
                  <div class="muted small" style="padding:.4rem .75rem">Loading…</div>
                </Show>
                {/* All-projects option */}
                <button
                  class="btn btn-ghost"
                  style={`display:block;width:100%;text-align:left;padding:.35rem .75rem;border-radius:0;font-size:.85rem;${project() === '*' ? 'font-weight:700;color:var(--primary)' : 'color:var(--text-muted)'}`}
                  onClick={() => selectProject('*')}
                >
                  all projects
                </button>
                <div style="height:1px;background:var(--border);margin:.2rem 0" />
                <For each={projects()?.metadata ?? []}>
                  {proj => (
                    <button
                      class="btn btn-ghost"
                      style={`display:block;width:100%;text-align:left;padding:.35rem .75rem;border-radius:0;font-size:.85rem;${project() === proj.name ? 'font-weight:700;color:var(--primary)' : ''}`}
                      onClick={() => selectProject(proj.name)}
                    >
                      {proj.name}
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* Authenticated user + RBAC indicator */}
          <Show when={whoami()?.user}>
            <span class="muted small" style="display:flex;align-items:center;gap:.3rem;padding:0 .25rem" title={`Roles: ${whoami()!.roles.join(', ') || 'none'}`}>
              <span style="font-size:.8rem">👤</span>
              <span>{whoami()!.user}</span>
            </span>
          </Show>
          <Show when={readOnly()}>
            <span class="badge badge-yellow" style="font-size:.7rem" title="Your role does not include 'admin' — write operations are disabled">
              read-only
            </span>
          </Show>

          <button class="theme-toggle" onClick={props.onToggleTheme} title="Toggle theme">
            {props.theme === 'dark' ? '☀' : '☾'}
          </button>
        </header>
        <main class="page-content">
          {props.children}
        </main>
      </div>
    </div>
  );
}
