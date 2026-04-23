import { render } from 'solid-js/web';
import { Router, Route, useLocation } from '@solidjs/router';
import { createSignal, Show } from 'solid-js';
import './index.css';
import '@xterm/xterm/css/xterm.css';

import { Layout }         from './Layout';
import { ProjectProvider } from './ProjectContext';
import { RemoteProvider }  from './RemoteContext';
import { RbacProvider }    from './RbacContext';
import Dashboard          from './pages/Dashboard';
import Instances          from './pages/Instances';
import InstanceDetail     from './pages/InstanceDetail';
import Images             from './pages/Images';
import Networks           from './pages/Networks';
import Storage            from './pages/Storage';
import Profiles           from './pages/Profiles';
import Projects           from './pages/Projects';
import Cluster            from './pages/Cluster';
import Activity           from './pages/Activity';
import Operations         from './pages/Operations';
import Warnings           from './pages/Warnings';
import VgaConsole         from './pages/VgaConsole';

function Root(props: { children?: any }) {
  const location = useLocation();

  const stored = (): 'dark' | 'light' =>
    (localStorage.getItem('theme') as 'dark' | 'light') ?? 'light';
  const [theme, setTheme] = createSignal<'light' | 'dark'>(stored());

  const applyTheme = (t: 'light' | 'dark') => {
    document.documentElement.setAttribute('data-theme', t);
    localStorage.setItem('theme', t);
  };
  applyTheme(theme());

  const toggleTheme = () => {
    const next = theme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    applyTheme(next);
  };

  return (
    <Show
      when={!location.pathname.endsWith('/vga')}
      fallback={<>{props.children}</>}
    >
      <RemoteProvider>
        <ProjectProvider>
          <RbacProvider>
            <Layout theme={theme()} onToggleTheme={toggleTheme}>
              {props.children}
            </Layout>
          </RbacProvider>
        </ProjectProvider>
      </RemoteProvider>
    </Show>
  );
}

render(() => (
  <Router root={Root}>
    <Route path="/"                        component={Dashboard} />
    <Route path="/instances"               component={Instances} />
    <Route path="/instances/:name"         component={InstanceDetail} />
    <Route path="/instances/:name/vga"     component={VgaConsole} />
    <Route path="/images"                  component={Images} />
    <Route path="/networks"                component={Networks} />
    <Route path="/storage"                 component={Storage} />
    <Route path="/profiles"                component={Profiles} />
    <Route path="/projects"                component={Projects} />
    <Route path="/cluster"                 component={Cluster} />
    <Route path="/operations"              component={Operations} />
    <Route path="/warnings"               component={Warnings} />
    <Route path="/activity"                component={Activity} />
  </Router>
), document.getElementById('root')!);
