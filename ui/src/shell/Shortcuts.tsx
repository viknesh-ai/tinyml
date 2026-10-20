import { useEffect } from "react";
import { useLocation } from "wouter";
import { Modal } from "../components/ui";
import { NAV, usePanel, useOptionalWorkspace, viewPath } from "../data";
import { useMediaQuery } from "../theme";
import { useNavState } from "./Sidebar";

const LIST: [string, string][] = [
  ["⌘K", "Search views, runs and workspaces, or run a stage"],
  ["[  ]", "Previous or next page in the sidebar"],
  ["G  D", "Go to the dashboard"],
  ["G  R", "Go to runs"],
  ["⌘J", "Show or hide the console"],
  ["⌘B", "Show or hide the sidebar"],
  ["A", "Show or hide the assistant"],
  ["?", "This list"],
];

function typing(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));
}

/** ⌘K works everywhere, including the workspace list. */
export function usePaletteShortcut() {
  const panel = usePanel();
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        panel.setPalette(!panel.palette);
      }
      if (e.key === "?" && !typing(e) && !document.querySelector('[role="dialog"]')) panel.setShortcuts(true);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [panel]);
}

/** Studio shortcuts. Single keys only fire when no field has focus and no dialog is open. */
export function useStudioShortcuts() {
  const panel = usePanel();
  const ws = useOptionalWorkspace()!;
  const state = useNavState();
  const wide = useMediaQuery("(min-width: 1024px)");
  const [, navigate] = useLocation();

  useEffect(() => {
    let pendingG = false;
    const on = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "j") {
        e.preventDefault();
        panel.setConsoleOpen(!panel.consoleOpen);
        return;
      }
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        if (wide) panel.setRailOpen(!panel.railOpen);
        else panel.setNavDrawer(!panel.navDrawer);
        return;
      }
      if (mod || e.altKey || typing(e) || document.querySelector('[role="dialog"]')) return;
      if (pendingG) {
        pendingG = false;
        if (e.key === "d") navigate(viewPath(ws.pid, "dashboard"));
        if (e.key === "r") navigate(viewPath(ws.pid, "runs"));
        return;
      }
      if (e.key === "g") {
        pendingG = true;
        setTimeout(() => (pendingG = false), 900);
      } else if (e.key === "a") {
        panel.setOpen(!panel.open);
      } else if (e.key === "[" || e.key === "]") {
        const open = NAV.filter((n) => !state[n.slug]?.locked);
        const at = open.findIndex((n) => n.slug === ws.view);
        const next = open[at + (e.key === "]" ? 1 : -1)];
        if (next) navigate(viewPath(ws.pid, next.slug));
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [panel, ws, state, wide, navigate]);
}

export function ShortcutsDialog() {
  const panel = usePanel();
  return (
    <Modal open={panel.shortcuts} onOpenChange={panel.setShortcuts} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2.5 text-[13px]">
        {LIST.map(([k, what]) => (
          <div key={k} className="contents">
            <dt className="flex gap-1">
              {k.split("  ").map((part) => (
                <kbd key={part} className="kbd">
                  {part}
                </kbd>
              ))}
            </dt>
            <dd className="m-0 text-ink-2">{what}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
