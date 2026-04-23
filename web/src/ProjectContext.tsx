import { createContext, useContext, createSignal, JSX } from 'solid-js';

interface ProjectContextValue {
  project: () => string;
  setProject: (name: string) => void;
}

const ProjectContext = createContext<ProjectContextValue>({
  project: () => 'default',
  setProject: () => {},
});

export function ProjectProvider(props: { children: JSX.Element }) {
  const stored = localStorage.getItem('active-project') || 'default';
  const [project, setProjectSignal] = createSignal(stored);

  function setProject(name: string) {
    setProjectSignal(name);
    localStorage.setItem('active-project', name);
  }

  return (
    <ProjectContext.Provider value={{ project, setProject }}>
      {props.children}
    </ProjectContext.Provider>
  );
}

export function useProject() {
  return useContext(ProjectContext);
}
