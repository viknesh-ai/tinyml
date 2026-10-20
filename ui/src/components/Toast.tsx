import { CheckCircle, WarningOctagon, X } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";
import { EASE_OUT, SPRING } from "../motion";

type Kind = "info" | "error";
interface Item {
  id: number;
  text: string;
  kind: Kind;
}

let items: Item[] = [];
let nextId = 1;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(text: string, kind: Kind = "info") {
  const item = { id: nextId++, text, kind };
  items = [...items.slice(-2), item];
  emit();
  setTimeout(() => dismiss(item.id), kind === "error" ? 7000 : 3500);
}

function dismiss(id: number) {
  items = items.filter((i) => i.id !== id);
  emit();
}

export function Toaster() {
  const list = useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => items,
  );
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-4 bottom-4 z-[60] flex flex-col items-center gap-2 sm:right-auto sm:left-6 sm:items-start"
    >
      <AnimatePresence initial={false}>
        {list.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: -24, transition: { duration: 0.16, ease: EASE_OUT } }}
            transition={SPRING}
            className="pointer-events-auto flex max-w-md items-start gap-2.5 rounded-[10px] border border-line bg-surface px-3.5 py-2.5 text-[13.5px] shadow-float"
          >
            {t.kind === "error" ? (
              <WarningOctagon size={18} weight="fill" className="mt-px flex-none text-block" />
            ) : (
              <CheckCircle size={18} weight="fill" className="mt-px flex-none text-ok" />
            )}
            <span className="min-w-0 grow">{t.text}</span>
            <button className="-mr-1 flex-none text-ink-3 hover:text-ink" aria-label="Dismiss" onClick={() => dismiss(t.id)}>
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
