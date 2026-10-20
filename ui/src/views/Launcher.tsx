import { FolderSimplePlus, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { api, errorMessage } from "../api";
import { Button, Callout, Empty, Modal, PageHeader } from "../components/ui";
import { keys, useAction, useProjects, useRecipes, viewPath } from "../data";
import { relativeTime } from "../format";
import { DURATION, EASE_OUT, useDelayed } from "../motion";
import { STATUS_WORDS } from "../shell/TitleBar";
import type { Project } from "../types";

export function Launcher({ startCreating = false }: { startCreating?: boolean }) {
  const projects = useProjects();
  const recipes = useRecipes();
  const calm = useReducedMotion();
  const [creating, setCreating] = useState(startCreating);
  const [query, setQuery] = useState("");
  const showLoading = useDelayed(projects.isPending);

  useEffect(() => {
    setCreating(startCreating);
  }, [startCreating]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = projects.data ?? [];
    return q ? all.filter((p) => p.description.toLowerCase().includes(q)) : all;
  }, [projects.data, query]);
  const recipeTitle = (id?: string) => recipes.data?.find((r) => r.id === id)?.title ?? "–";

  return (
    <div>
      <PageHeader
        title="Workspaces"

        actions={
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
            New workspace
          </Button>
        }
      />

      {projects.error ? (
        <Callout level="block" title="Workspaces could not be loaded">
          {errorMessage(projects.error)}. Check that <code>tinyml serve</code> is running.
        </Callout>
      ) : projects.isPending ? (
        showLoading ? (
          <div className="flex items-center gap-2 py-10 text-ink-2" role="status">
            <span className="spinner" /> Loading workspaces…
          </div>
        ) : null
      ) : !projects.data.length ? (
        <Empty
          icon={FolderSimplePlus}
          title="No workspaces yet"
          action={
            <Button variant="primary" icon={Plus} onClick={() => setCreating(true)}>
              New workspace
            </Button>
          }
        >
          Start with an objective. Add recordings on the Data page.
        </Empty>
      ) : (
        <section className="panel overflow-hidden">
          <div className="flex items-center gap-3 border-b border-line px-4 py-2.5">
            <span className="text-[13px] font-semibold">Recent</span>
            <span className="text-[12px] text-ink-3">{projects.data.length} workspaces</span>
            <label className="relative ml-auto w-[min(260px,50%)]">
              <span className="sr-only">Search workspaces</span>
              <MagnifyingGlass size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                className="field-input !min-h-8 !py-1 pl-7 text-[13px]"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          {list.length ? (
            <div className="overflow-x-auto">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Objective</th>
                    <th>Use case</th>
                    <th>Stage</th>
                    <th>Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((p, i) => (
                    <motion.tr
                      key={p.id}
                      initial={calm ? false : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: Math.min(i, 12) * 0.03 }}
                      className="hover:bg-surface-2"
                    >
                      <td className="max-w-[460px]">
                        <Link href={viewPath(p.id, "dashboard")} className="line-clamp-1 font-medium hover:underline">
                          {p.description}
                        </Link>
                        <div className="font-mono text-[11.5px] text-ink-3">{p.id}</div>
                      </td>
                      <td className="whitespace-nowrap text-ink-2">{recipeTitle(p.spec?.recipe)}</td>
                      <td className="whitespace-nowrap text-ink-2">{STATUS_WORDS[p.status] ?? p.status}</td>
                      <td className="whitespace-nowrap text-ink-3">{relativeTime(p.updated_at)}</td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-4 py-6 text-[13px] text-ink-2">Nothing matches “{query}”.</p>
          )}
        </section>
      )}

      <NewWorkspace open={creating} onOpenChange={setCreating} />
    </div>
  );
}

function NewWorkspace({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const action = useAction();
  const [text, setText] = useState("");

  const create = () =>
    action.run(async () => {
      const res = await api<{ project: Project }>("/projects", { json: { description: text.trim() } });
      await client.invalidateQueries({ queryKey: keys.projects });
      onOpenChange(false);
      setText("");
      navigate(viewPath(res.project.id, "dashboard"));
    });

  return (
    <Modal
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o && window.location.hash.startsWith("#/new")) navigate("/", { replace: true });
      }}
      title="New workspace"
      description="Describe what the device should detect. The use case and limits are read from it, and you can change them on the Brief page."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (text.trim()) create();
        }}
      >
        <label htmlFor="objective" className="mb-1.5 block text-[13px] font-medium">
          Objective
        </label>
        <textarea
          id="objective"
          autoFocus
          className="field-input min-h-[120px] resize-y text-[14px] leading-relaxed"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && text.trim()) create();
          }}
          aria-describedby="objective-help"
        />
        <p id="objective-help" className="mt-1.5 text-[12.5px] text-ink-3">
          What it should detect, its power source and radio, and a budget per chip.
        </p>
        <div className="mt-5 flex items-center justify-end gap-2">
          <span className="mr-auto text-[12px] text-ink-3">
            <span className="kbd">⌘</span> <span className="kbd">Enter</span>
          </span>
          <Button onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="primary" busy={action.busy} disabled={!text.trim()}>
            Create workspace
          </Button>
        </div>
      </form>
    </Modal>
  );
}
