import { createContext, useContext, createResource, JSX } from 'solid-js';

interface WhoamiResponse {
  user:     string;
  roles:    string[];
  is_admin: boolean;
}

interface RbacContextValue {
  isAdmin:  () => boolean;
  // true when auth is enabled but no admin role — read-only mode
  readOnly: () => boolean;
  // true while /whoami is still loading (don't render action buttons yet)
  loading:  () => boolean;
}

const RbacContext = createContext<RbacContextValue>({
  isAdmin:  () => true,
  readOnly: () => false,
  loading:  () => false,
});

async function fetchWhoami(): Promise<WhoamiResponse> {
  const res = await fetch('/whoami');
  if (!res.ok) return { user: '', roles: [], is_admin: true }; // fail open
  return res.json();
}

export function RbacProvider(props: { children: JSX.Element }) {
  const [whoami] = createResource(fetchWhoami);

  // When auth is disabled the backend returns is_admin: false with an empty
  // user — in that case treat everyone as admin (no auth = no restrictions).
  const authEnabled = () => !!(whoami()?.user);
  const isAdmin     = () => !authEnabled() || (whoami()?.is_admin ?? true);
  const readOnly    = () => authEnabled() && !isAdmin();
  const loading     = () => whoami.loading;

  return (
    <RbacContext.Provider value={{ isAdmin, readOnly, loading }}>
      {props.children}
    </RbacContext.Provider>
  );
}

export function useRbac() {
  return useContext(RbacContext);
}
