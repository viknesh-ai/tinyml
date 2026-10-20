import { motion, useReducedMotion } from "motion/react";
import { useEffect, useRef, type ReactNode } from "react";
import { useLocation } from "wouter";
import { errorMessage } from "./api";
import { Callout } from "./components/ui";
import { toast } from "./components/Toast";
import {
  JOB_TITLES,
  PanelProvider,
  NAV,
  WorkspaceProvider,
  useCatalog,
  useProjectData,
  useRecipes,
  useSettings,
  viewPath,
  type StepKey,
  type ViewSlug,
} from "./data";
import { local } from "./format";
import { DURATION, EASE_OUT, useDelayed } from "./motion";
import { AssistantPanel } from "./panel/AssistantPanel";
import { Decisions } from "./pages/Decisions";
import { SettingsPage } from "./pages/Settings";
import { CommandPalette, useGlobalCommands, useWorkspaceCommands } from "./shell/CommandPalette";
import { Console } from "./shell/Console";
import { ShortcutsDialog, usePaletteShortcut, useStudioShortcuts } from "./shell/Shortcuts";
import { Sidebar } from "./shell/Sidebar";
import { TitleBar } from "./shell/TitleBar";
import { Build } from "./steps/Build";
import { Chips } from "./steps/Chips";
import { Compare } from "./steps/Compare";
import { DataStep } from "./steps/Data";
import { ModelStep } from "./steps/Model";
import { Spec } from "./steps/Spec";
import type { ProjectData } from "./types";
import { Dashboard } from "./views/Dashboard";
import { Design } from "./views/Design";
import { Launcher } from "./views/Launcher";
import { Runs } from "./views/Runs";

/** Links from earlier versions (`#/p/<id>/<step>`) still land on the right stage. */
const LEGACY: Record<string, ViewSlug> = {
  overview: "dashboard",
  workflow: "dashboard",
  history: "runs",
  describe: "spec",
  target: "targets",
  vendor: "targets",
  data: "dataset",
  model: "training",
  algorithm: "training",
  rank: "benchmark",
  build: "deploy",
};

const ORDER: ViewSlug[] = NAV.map((n) => n.slug);
const VIEWS: Record<ViewSlug, () => ReactNode> = {
  dashboard: () => <Dashboard />,
  design: () => <Design />,
  spec: () => <Spec />,
  targets: () => <Chips />,
  dataset: () => <DataStep />,
  training: () => <ModelStep />,
  benchmark: () => <Compare />,
  deploy: () => <Build />,
  runs: () => <Runs />,
  decisions: () => <Decisions embedded />,
};

export function App() {
  const [location] = useLocation();
  const parts = location.split("?")[0].split("/").filter(Boolean);
  const initialOpen = local.get("tinyml.panelOpen", false);
  const initialConsole = local.get("tinyml.consoleOpen", false);

  let body: ReactNode;
  if (parts[0] === "p" && parts[1]) body = <LegacyRedirect to={viewPath(parts[1], LEGACY[parts[2]] ?? "dashboard")} />;
  else if (parts[0] === "w" && parts[1] && !ORDER.includes(parts[2] as ViewSlug) && LEGACY[parts[2]])
    body = <LegacyRedirect to={viewPath(parts[1], LEGACY[parts[2]])} />;
  else if (parts[0] === "w" && parts[1]) {
    const view = (ORDER.includes(parts[2] as ViewSlug) ? parts[2] : "dashboard") as ViewSlug;
    body = <Studio pid={parts[1]} view={view} />;
  } else {
    const pid = local.get<string | null>("tinyml.lastProject", null);
    body = (
      <Plain>
        {parts[0] === "settings" ? (
          <SettingsPage />
        ) : parts[0] === "decisions" ? (
          <Decisions pid={pid} />
        ) : (
          <Launcher startCreating={parts[0] === "new"} />
        )}
      </Plain>
    );
  }

  return (
    <PanelProvider initialOpen={initialOpen} initialConsole={initialConsole}>
      <div className="flex h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to the content
        </a>
        {body}
      </div>
    </PanelProvider>
  );
}

/** Pages outside a workspace: the workspace list, settings and the global decision log. */
function Plain({ children }: { children: ReactNode }) {
  const commands = useGlobalCommands();
  usePaletteShortcut();
  return (
    <div className="flex min-h-0 grow flex-col">
      <TitleBar />
      <main id="main" className="min-h-0 grow overflow-y-auto bg-paper">
        <div className="px-4 pb-16 sm:px-6">{children}</div>
      </main>
      <CommandPalette commands={commands} />
      <ShortcutsDialog />
    </div>
  );
}

function LegacyRedirect({ to }: { to: string }) {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);
  return null;
}

function useJobNotifications(data: ProjectData | undefined) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!data) return;
    const active = data.active_job?.id ?? null;
    if (last.current && !active) {
      const job = data.jobs.find((j) => j.id === last.current);
      const title = job ? (JOB_TITLES[job.kind] ?? "Run") : "Run";
      if (job?.status === "done") toast(`${title} finished`);
      else if (job?.status === "failed") toast(`${title} failed: ${job.error ?? "see the console"}`, "error");
      else if (job?.status === "cancelled") toast(`${title} stopped`);
    }
    last.current = active;
  }, [data]);
}

function Studio({ pid, view }: { pid: string; view: ViewSlug }) {
  const catalog = useCatalog();
  const recipes = useRecipes();
  const settings = useSettings();
  const project = useProjectData(pid);
  useJobNotifications(project.data);

  useEffect(() => {
    local.set("tinyml.lastProject", pid);
  }, [pid]);
  useEffect(() => {
    document.getElementById("main")?.scrollTo({ top: 0 });
  }, [pid, view]);

  const boot = [catalog, recipes, settings, project];
  const failed = boot.find((q) => q.error);
  const loading = boot.some((q) => q.isPending);
  const showLoading = useDelayed(loading);

  if (failed || loading || !catalog.data || !recipes.data || !settings.data || !project.data) {
    return (
      <>
        <TitleBar />
        <main id="main" className="min-h-0 grow overflow-y-auto">
          <div className="px-4 pt-8 sm:px-6">
            {failed ? (
              <Callout level="block" title="This workspace could not be loaded">
                {errorMessage(failed.error)}. Check that <code>tinyml serve</code> is running, or go back to the workspace list.
              </Callout>
            ) : showLoading ? (
              <div className="flex items-center gap-3 py-16 text-ink-2" role="status">
                <span className="spinner" /> Opening the workspace…
              </div>
            ) : null}
          </div>
        </main>
      </>
    );
  }

  const step = (NAV.find((n) => n.slug === view)?.step ?? null) as StepKey | null;
  const unspecified = project.data.project.spec === null && view !== "dashboard";

  return (
    <WorkspaceProvider
      pid={pid}
      step={step}
      view={view}
      data={project.data}
      catalog={catalog.data}
      recipes={recipes.data}
      settings={settings.data}
    >
      <StudioFrame pid={pid} view={view} unspecified={unspecified} />
    </WorkspaceProvider>
  );
}

function StudioFrame({ pid, view, unspecified }: { pid: string; view: ViewSlug; unspecified: boolean }) {
  const commands = [...useWorkspaceCommands(), ...useGlobalCommands()];
  usePaletteShortcut();
  useStudioShortcuts();
  return (
    <div className="flex min-h-0 grow">
      <Sidebar />
      <div className="flex min-w-0 grow flex-col">
        <TitleBar />
        <div className="flex min-h-0 grow">
          <div className="flex min-w-0 grow flex-col">
            <main id="main" className="min-h-0 grow overflow-y-auto bg-paper">
              <ViewTransition key={`${pid}-${view}`} view={view}>
                {unspecified ? (
                  <Callout level="warn" title="This workspace has no specification">
                    Create a new workspace from an objective.
                  </Callout>
                ) : (
                  VIEWS[view]()
                )}
                <div className="h-10" />
              </ViewTransition>
            </main>
            {view !== "runs" ? <Console /> : null}
          </div>
          <AssistantPanel />
        </div>
      </div>
      <CommandPalette commands={commands} />
      <ShortcutsDialog />
    </div>
  );
}

const lastView = { index: -1 };

/** A view slides in from the side the pipeline is heading: forward from the right, back from the left. */
function ViewTransition({ view, children }: { view: ViewSlug; children: ReactNode }) {
  const calm = useReducedMotion();
  const index = ORDER.indexOf(view);
  const direction = useRef(lastView.index < 0 || index === lastView.index ? 0 : index > lastView.index ? 1 : -1).current;
  useEffect(() => {
    lastView.index = index;
  }, [index]);
  return (
    <motion.div
      initial={calm ? false : { opacity: 0, x: direction * 16, y: direction === 0 ? 6 : 0 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE_OUT }}
      className="px-4 sm:px-6"
    >
      {children}
    </motion.div>
  );
}
