import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { api, errorMessage } from "./api";
import type { Catalog, Chip, Doctor, ProjectData, Project, Recipe, Settings, Stage } from "./types";
import { toast } from "./components/Toast";

/** The pipeline stages, in order. `key` is the engine's name, `slug` is the URL. */
export const STEPS = [
  { key: "describe", slug: "spec", title: "Specification", hint: "Objective and constraints" },
  { key: "target", slug: "targets", title: "Targets", hint: "Silicon to evaluate" },
  { key: "data", slug: "dataset", title: "Dataset", hint: "Recordings and checks" },
  { key: "model", slug: "training", title: "Training", hint: "Experiments" },
  { key: "rank", slug: "benchmark", title: "Benchmark", hint: "Per-chip results" },
  { key: "build", slug: "deploy", title: "Deploy", hint: "Verified package" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];

/** Workspace views that are not pipeline stages. */
export const TOOLS = [
  { slug: "dashboard", title: "Dashboard" },
  { slug: "design", title: "Pipeline design" },
  { slug: "runs", title: "Runs" },
  { slug: "decisions", title: "Decision log" },
] as const;

export type ViewSlug = (typeof STEPS)[number]["slug"] | (typeof TOOLS)[number]["slug"];

/**
 * The sidebar, top to bottom: the project flow in order, then the project's history. An entry with a `parent`
 * sits indented under it, the way a stage's sub-page does.
 */
export const NAV: { slug: ViewSlug; title: string; step?: StepKey; parent?: ViewSlug; group: "flow" | "history" }[] = [
  { slug: "dashboard", title: "Dashboard", group: "flow" },
  { slug: "spec", title: "Brief", step: "describe", group: "flow" },
  { slug: "targets", title: "Targets", step: "target", group: "flow" },
  { slug: "dataset", title: "Data", step: "data", group: "flow" },
  { slug: "training", title: "Training", step: "model", group: "flow" },
  { slug: "design", title: "Pipeline design", parent: "training", group: "flow" },
  { slug: "benchmark", title: "Benchmark", step: "rank", group: "flow" },
  { slug: "deploy", title: "Deployment", step: "build", group: "flow" },
  { slug: "runs", title: "Runs", group: "history" },
  { slug: "decisions", title: "Decision log", group: "history" },
];

export const navTitle = (slug: ViewSlug) => NAV.find((n) => n.slug === slug)?.title ?? slug;

export const stepPath = (pid: string, key: StepKey) => `/w/${pid}/${STEPS.find((s) => s.key === key)!.slug}`;
export const viewPath = (pid: string, slug: ViewSlug) => `/w/${pid}/${slug}`;

/** The step before `key`, for the Back link in a step's footer. */
export function backTo(pid: string, key: StepKey) {
  const i = STEPS.findIndex((s) => s.key === key);
  if (i <= 0) return undefined;
  const prev = STEPS[i - 1];
  return { href: viewPath(pid, prev.slug), label: navTitle(prev.slug) };
}
export const STEP_STAGE: Partial<Record<StepKey, Stage>> = { data: "data", model: "model", rank: "rank", build: "build" };
export const ACTIVE = ["queued", "running", "pausing", "paused", "cancelling"];
export const JOB_TITLES: Record<string, string> = {
  train: "Training",
  select: "Switching model",
  rank: "Benchmark",
  build: "Deploy build",
};

export const keys = {
  projects: ["projects"] as const,
  project: (pid: string) => ["project", pid] as const,
  catalog: ["catalog"] as const,
  recipes: ["recipes"] as const,
  settings: ["settings"] as const,
  doctor: ["doctor"] as const,
};

export function useProjects() {
  return useQuery({ queryKey: keys.projects, queryFn: () => api<Project[]>("/projects") });
}

export function useProjectData(pid: string | null) {
  return useQuery({
    queryKey: keys.project(pid ?? ""),
    queryFn: () => api<ProjectData>(`/projects/${pid}`),
    enabled: !!pid,
    refetchInterval: (q) => (q.state.data?.active_job ? 1200 : false),
  });
}

export function useCatalog() {
  return useQuery({ queryKey: keys.catalog, queryFn: () => api<Catalog>("/catalog"), staleTime: 60_000 });
}

export function useRecipes() {
  return useQuery({ queryKey: keys.recipes, queryFn: () => api<Recipe[]>("/recipes"), staleTime: Infinity });
}

export function useDoctor() {
  return useQuery({ queryKey: keys.doctor, queryFn: () => api<Doctor>("/doctor"), staleTime: 5 * 60_000 });
}

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api<Settings>("/settings") });
}

interface Workspace {
  pid: string;
  data: ProjectData;
  catalog: Catalog;
  recipes: Recipe[];
  settings: Settings;
  step: StepKey | null;
  view: ViewSlug;
  chip: (id: string) => Chip | undefined;
  chipName: (id: string) => string;
  vendorName: (id: string) => string;
  review: (stage: Stage) => ProjectData["reviews"][number] | undefined;
  needsApproval: (stage: Stage) => boolean;
  singleChip: string | null;
  refresh: () => Promise<void>;
}

const WorkspaceContext = createContext<Workspace | null>(null);

export function WorkspaceProvider(props: {
  pid: string;
  step: StepKey | null;
  view: ViewSlug;
  data: ProjectData;
  catalog: Catalog;
  recipes: Recipe[];
  settings: Settings;
  children: ReactNode;
}) {
  const client = useQueryClient();
  const { pid, step, view, data, catalog, recipes, settings } = props;
  const value = useMemo<Workspace>(() => {
    const byId = new Map(catalog.chips.map((c) => [c.id, c]));
    const review = (stage: Stage) => data.reviews.find((r) => r.stage === stage);
    return {
      pid,
      data,
      catalog,
      recipes,
      settings,
      step,
      view,
      chip: (id) => byId.get(id),
      chipName: (id) => byId.get(id)?.name ?? id,
      vendorName: (id) => (id === "any" ? "Any maker" : (catalog.vendors.find((v) => v.id === id)?.name ?? id)),
      review,
      needsApproval: (stage) => {
        if (!data.review_gates) return false;
        const r = review(stage);
        return !!r && r.status !== "approved";
      },
      singleChip: data.chip_ids.length === 1 ? data.chip_ids[0] : null,
      refresh: async () => {
        await Promise.all([
          client.invalidateQueries({ queryKey: keys.project(pid) }),
          client.invalidateQueries({ queryKey: keys.projects }),
        ]);
      },
    };
  }, [pid, step, view, data, catalog, recipes, settings, client]);
  return <WorkspaceContext.Provider value={value}>{props.children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error("useWorkspace outside a workspace");
  return ws;
}

export function useOptionalWorkspace() {
  return useContext(WorkspaceContext);
}

interface PanelState {
  open: boolean;
  setOpen: (open: boolean) => void;
  consoleOpen: boolean;
  setConsoleOpen: (open: boolean) => void;
  consoleJob: string | null;
  showJob: (jobId: string | null) => void;
  /** The run shown in the Runs view, without opening the console. */
  selectJob: (jobId: string | null) => void;
  focus: Stage | null;
  setFocus: (stage: Stage | null) => void;
  showReview: (stage: Stage) => void;
  railOpen: boolean;
  setRailOpen: (open: boolean) => void;
  /** The explorer as a drawer on narrow screens. */
  navDrawer: boolean;
  setNavDrawer: (open: boolean) => void;
  palette: boolean;
  setPalette: (open: boolean) => void;
  shortcuts: boolean;
  setShortcuts: (open: boolean) => void;
}

const PanelContext = createContext<PanelState | null>(null);

function readFlag(key: string, fallback: boolean) {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : JSON.parse(raw) === true;
  } catch {
    return fallback;
  }
}

function remember(key: string, value: boolean) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* not essential */
  }
}

export function PanelProvider({
  children,
  initialOpen,
  initialConsole,
}: {
  children: ReactNode;
  initialOpen: boolean;
  initialConsole: boolean;
}) {
  const [open, setOpenState] = useState(initialOpen);
  const [consoleOpen, setConsoleState] = useState(initialConsole);
  const [focus, setFocus] = useState<Stage | null>(null);
  const [consoleJob, setConsoleJob] = useState<string | null>(null);
  const [railOpen, setRailState] = useState(() => readFlag("tinyml.railOpen", true));
  const [palette, setPalette] = useState(false);
  const [navDrawer, setNavDrawer] = useState(false);
  const [shortcuts, setShortcuts] = useState(false);
  const setRailOpen = useCallback((next: boolean) => {
    setRailState(next);
    remember("tinyml.railOpen", next);
  }, []);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    remember("tinyml.panelOpen", next);
  }, []);
  const setConsoleOpen = useCallback((next: boolean) => {
    setConsoleState(next);
    remember("tinyml.consoleOpen", next);
  }, []);
  const showReview = useCallback(
    (stage: Stage) => {
      setFocus(stage);
      setOpen(true);
      requestAnimationFrame(() => document.getElementById(`review-${stage}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
    },
    [setOpen],
  );
  const showJob = useCallback(
    (jobId: string | null) => {
      setConsoleJob(jobId);
      setConsoleOpen(true);
    },
    [setConsoleOpen],
  );
  const value = useMemo(
    () => ({
      open,
      setOpen,
      consoleOpen,
      setConsoleOpen,
      consoleJob,
      showJob,
      selectJob: setConsoleJob,
      focus,
      setFocus,
      showReview,
      railOpen,
      setRailOpen,
      navDrawer,
      setNavDrawer,
      palette,
      setPalette,
      shortcuts,
      setShortcuts,
    }),
    [
      open,
      setOpen,
      consoleOpen,
      setConsoleOpen,
      consoleJob,
      showJob,
      focus,
      showReview,
      railOpen,
      setRailOpen,
      navDrawer,
      palette,
      shortcuts,
    ],
  );
  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}

export function usePanel() {
  const p = useContext(PanelContext);
  if (!p) throw new Error("usePanel outside PanelProvider");
  return p;
}

/** Runs an async action, keeps a busy flag for its button and turns errors into a toast. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      toast(errorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, run };
}

/** Job and review actions shared by the steps and the review panel. */
export function useJobs() {
  const ws = useWorkspace();
  const panel = usePanel();
  const start = useCallback(
    async (path: string, body: unknown = {}) => {
      await api(`/projects/${ws.pid}/${path}`, { json: body });
      panel.showJob(null);
      await ws.refresh();
    },
    [ws, panel],
  );
  const approve = useCallback(
    async (stage: Stage, note: string | null = null) => {
      await api(`/projects/${ws.pid}/reviews`, { json: { stage, status: "approved", note } });
      toast(`${ws.review(stage)?.title ?? "Step"} approved`);
      await ws.refresh();
    },
    [ws],
  );
  return { start, approve };
}

/** The two tabs on the History pages. */
export function historyTabs(pid: string, current: "runs" | "decisions", runs: number) {
  return [
    { label: "Runs", href: viewPath(pid, "runs"), current: current === "runs", count: runs },
    { label: "Decision log", href: viewPath(pid, "decisions"), current: current === "decisions" },
  ];
}
