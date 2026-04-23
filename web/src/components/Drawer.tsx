import { JSX, Show, createEffect } from 'solid-js';

interface DrawerProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: JSX.Element;
}

export function Drawer(props: DrawerProps) {
  // Close on Escape
  createEffect(() => {
    if (!props.open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') props.onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  });

  return (
    <>
      {/* Backdrop */}
      <div
        class="drawer-backdrop"
        classList={{ 'drawer-backdrop--open': props.open }}
        onClick={props.onClose}
      />
      {/* Panel */}
      <div class="drawer" classList={{ 'drawer--open': props.open }} role="dialog" aria-modal="true">
        <div class="drawer-header">
          <span class="drawer-title">{props.title}</span>
          <button class="modal-close" onClick={props.onClose}>✕</button>
        </div>
        <div class="drawer-body">
          <Show when={props.open}>
            {props.children}
          </Show>
        </div>
      </div>
    </>
  );
}
