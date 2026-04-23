import { createContext, useContext, createSignal, onMount, JSX } from 'solid-js';
import { getRemotes } from './api';

export interface RemoteInfo {
  name: string;
  address: string;
}

interface RemoteContextValue {
  remote: () => string;           // active remote name, e.g. "local" or "prod"
  setRemote: (name: string) => void;
}

const RemoteContext = createContext<RemoteContextValue>({
  remote: () => 'local',
  setRemote: () => {},
});

export function RemoteProvider(props: { children: JSX.Element }) {
  const stored = localStorage.getItem('active-remote') || 'local';
  const [remote, setRemoteSignal] = createSignal(stored);

  function setRemote(name: string) {
    setRemoteSignal(name);
    localStorage.setItem('active-remote', name);
  }

  // On startup, fetch the available remotes and make sure the stored selection
  // is actually in the list.  If not (e.g. no local Incus on this machine),
  // fall back to the first available remote.
  onMount(async () => {
    try {
      const remotes = await getRemotes();
      if (remotes.length === 0) return;
      const names = remotes.map(r => r.name);
      if (!names.includes(remote())) {
        setRemote(names[0]);
      }
    } catch {
      // Network error during bootstrap — leave the current selection as-is.
    }
  });

  return (
    <RemoteContext.Provider value={{ remote, setRemote }}>
      {props.children}
    </RemoteContext.Provider>
  );
}

export function useRemote() {
  return useContext(RemoteContext);
}
