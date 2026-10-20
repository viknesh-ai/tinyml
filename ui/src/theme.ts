import { useEffect, useState } from "react";
import { local } from "./format";

export type Theme = "system" | "light" | "dark";

export function applyTheme(theme: Theme = local.get<Theme>("tinyml.theme", "light")) {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}

export function setTheme(theme: Theme) {
  local.set("tinyml.theme", theme);
  applyTheme(theme);
}

export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const on = () => setMatches(mql.matches);
    mql.addEventListener("change", on);
    return () => mql.removeEventListener("change", on);
  }, [query]);
  return matches;
}
