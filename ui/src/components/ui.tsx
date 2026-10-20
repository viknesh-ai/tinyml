import * as Dialog from "@radix-ui/react-dialog";
import * as Tooltip from "@radix-ui/react-tooltip";
import { CaretLeft, CaretRight, CheckCircle, Info, Prohibit, Warning, X } from "@phosphor-icons/react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useId, useState, type ButtonHTMLAttributes, type ComponentType, type ReactNode } from "react";
import { Link } from "wouter";
import { DURATION, EASE_OUT, SOFT_SPRING, SPRING } from "../motion";
import type { Tagged } from "../types";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger" | "default";
  size?: "sm" | "md" | "lg";
  busy?: boolean;
  icon?: ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" }>;
};

export function Button({ variant = "default", size = "md", busy, icon: Icon, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        "btn",
        variant === "primary" && "btn-primary",
        variant === "ghost" && "btn-ghost",
        variant === "danger" && "btn-danger",
        size === "sm" && "btn-sm",
        size === "lg" && "btn-lg",
        className,
      )}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {busy ? <span className="spinner" aria-hidden /> : Icon ? <Icon size={size === "sm" ? 14 : 16} weight="bold" /> : null}
      {children}
    </button>
  );
}

export function Hint({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={6}
          className="anim-tooltip z-[70] max-w-xs rounded-[6px] bg-ink px-2.5 py-1.5 text-[12.5px] leading-snug text-on-ink shadow-float"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** A number with its provenance mark. Every number from the engine is shown through this. */
export function Reading({ n, render }: { n: Tagged | null | undefined; render: (v: number) => string }) {
  if (!n || n.value === null || n.value === undefined) return <span className="text-ink-3">–</span>;
  return (
    <span className="whitespace-nowrap font-mono">
      {render(n.value)}
      <Hint label={n.source ? `${n.tag}: ${n.source}` : n.tag}>
        <span tabIndex={0} className={cx("prov", `prov-${n.tag}`)}>
          {n.tag}
        </span>
      </Hint>
    </span>
  );
}

export function Prov({ tag }: { tag: string }) {
  return <span className={cx("prov", `prov-${tag}`)}>{tag}</span>;
}

const CALLOUT = {
  ok: { Icon: CheckCircle, cls: "border-ok/30 bg-ok-wash", icon: "text-ok" },
  info: { Icon: Info, cls: "border-line bg-surface-2", icon: "text-ink-2" },
  warn: { Icon: Warning, cls: "border-warn/30 bg-warn-wash", icon: "text-warn" },
  block: { Icon: Prohibit, cls: "border-block/30 bg-block-wash", icon: "text-block" },
};

export function Callout({
  level,
  title,
  children,
  action,
}: {
  level: keyof typeof CALLOUT;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const { Icon, cls, icon } = CALLOUT[level];
  return (
    <div className={cx("flex items-start gap-3 rounded-[8px] border px-3.5 py-3", cls)}>
      <Icon size={18} weight="fill" className={cx("mt-0.5 flex-none", icon)} />
      <div className="min-w-0 grow">
        {title ? <div className="font-medium">{title}</div> : null}
        {children ? <div className={cx("text-ink-2", !!title && "mt-0.5")}>{children}</div> : null}
        {action ? <div className="mt-2.5 flex flex-wrap gap-2">{action}</div> : null}
      </div>
    </div>
  );
}

export function LevelIcon({ level, size = 16 }: { level: keyof typeof CALLOUT; size?: number }) {
  const { Icon, icon } = CALLOUT[level];
  return <Icon size={size} weight="fill" className={cx("flex-none", icon)} />;
}

export function Status({ tone = "neutral", children }: { tone?: "neutral" | "ok" | "warn" | "block" | "signal"; children: ReactNode }) {
  return <span className={cx("status", tone !== "neutral" && `status-${tone}`)}>{children}</span>;
}

export interface BandTab {
  label: string;
  /** A tab is a link to another page, or switches a section of this page with `onSelect`. */
  href?: string;
  onSelect?: () => void;
  current: boolean;
  disabled?: boolean;
  count?: number;
}

/**
 * The page band: a dark strip across the top of every page with the title, the page's tabs and, on some
 * pages, summary cards. It separates the page's chrome from its working content.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
  tabs,
  stats,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  actions?: ReactNode;
  tabs?: BandTab[];
  stats?: ReactNode;
}) {
  const id = useId();
  return (
    <header className="band -mx-4 mb-6 px-4 pb-5 pt-5 sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <div className="min-w-0 max-w-[76ch] grow basis-[420px]">
          {eyebrow ? <div className="mb-1 text-[12px] font-medium text-band-ink-2">{eyebrow}</div> : null}
          <h1 className="text-[clamp(18px,1.9vw,22px)] font-semibold text-band-ink">{title}</h1>
          {lede ? <p className="mt-1 text-[13.5px] text-band-ink-2">{lede}</p> : null}
        </div>
        {actions ? <div className="band-actions ml-auto flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {stats ? <div className="@container mt-5">{stats}</div> : null}
      {tabs?.length ? (
        <nav aria-label={`${title} sections`} className="-mx-1 mt-4 flex gap-1 overflow-x-auto px-1 pb-0.5">
          {tabs.map((t) => {
            if (t.disabled)
              return (
                <span
                  key={t.label}
                  aria-disabled
                  className="flex h-8 flex-none items-center rounded-[7px] px-3 text-[13px] text-band-ink-2/60"
                >
                  {t.label}
                </span>
              );
            const cls = cx(
              "relative flex h-8 flex-none items-center gap-1.5 rounded-[7px] px-3 text-[13px] font-medium",
              t.current ? "text-ink" : "text-band-ink-2 hover:text-band-ink",
            );
            const body = (
              <>
                {t.current ? (
                  <motion.span
                    layoutId={`band-tab-${id}`}
                    transition={SPRING}
                    className="absolute inset-0 rounded-[7px] bg-surface shadow-[0_0_0_1px_var(--line),var(--shadow-card)]"
                    aria-hidden
                  />
                ) : null}
                <span className="relative">{t.label}</span>
                {t.count !== undefined ? <span className="relative font-mono text-[11px] opacity-70">{t.count}</span> : null}
              </>
            );
            return t.onSelect ? (
              <button key={t.label} type="button" aria-pressed={t.current} className={cls} onClick={t.onSelect}>
                {body}
              </button>
            ) : (
              <Link key={t.label} href={t.href!} aria-current={t.current ? "page" : undefined} className={cls}>
                {body}
              </Link>
            );
          })}
        </nav>
      ) : null}
    </header>
  );
}

/** A summary card on the page band: a small label, one big value, and an optional figure on the right. */
export function StatCard({ label, value, sub, figure }: { label: string; value: ReactNode; sub?: ReactNode; figure?: ReactNode }) {
  return (
    <div className="@container panel min-w-0 text-ink">
      <div className="flex min-h-[80px] items-center gap-4 px-3.5 py-3 @[200px]:px-4">
        <div className="min-w-0 grow">
          <div className="truncate text-[12px] font-medium text-ink-3">{label}</div>
          <div className="mt-0.5 truncate text-[18px] font-semibold tracking-[-0.01em] @[200px]:text-[20px]">{value}</div>
          {sub ? <div className="truncate text-[12px] text-ink-3">{sub}</div> : null}
        </div>
        {figure ? <div className="hidden flex-none @[240px]:block">{figure}</div> : null}
      </div>
    </div>
  );
}

export function SectionTitle({ title, hint, right }: { title: ReactNode; hint?: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {hint ? <span className="text-[13px] text-ink-3">{hint}</span> : null}
      {right ? <div className="ml-auto flex items-center gap-2">{right}</div> : null}
    </div>
  );
}

export function Disclosure({
  title,
  children,
  defaultOpen = false,
  onOpen,
}: {
  title: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
  onOpen?: () => void;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="panel">
      <button
        type="button"
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-[10px] px-4 py-3 text-left font-medium hover:bg-surface-2"
        onClick={() => {
          if (!open) onOpen?.();
          setOpen(!open);
        }}
      >
        <motion.span animate={{ rotate: open ? 90 : 0 }} transition={SPRING} className="inline-flex">
          <CaretRight size={14} weight="bold" />
        </motion.span>
        {title}
      </button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ height: { duration: DURATION.slow, ease: EASE_OUT }, opacity: { duration: DURATION.base } }}
            className="overflow-hidden"
          >
            <div className="border-t border-line px-4 py-4">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: [T, string][];
  onChange: (v: T) => void;
  label: string;
}) {
  const id = useId();
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex flex-wrap gap-1 rounded-[8px] border border-line bg-surface-2 p-1">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cx(
            "relative min-h-[30px] rounded-[5px] px-3 text-[13px] font-medium",
            value === v ? "text-ink" : "text-ink-2 hover:text-ink",
          )}
        >
          {value === v ? (
            <motion.span
              layoutId={`seg-${id}`}
              transition={SPRING}
              className="absolute inset-0 rounded-[5px] bg-surface shadow-[0_0_0_1px_var(--line-strong)]"
              aria-hidden
            />
          ) : null}
          <span className="relative">{text}</span>
        </button>
      ))}
    </div>
  );
}

export function Empty({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: ComponentType<{ size?: number }>;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="mb-1 grid h-11 w-11 place-items-center rounded-full bg-surface-2 text-ink-2">
        <Icon size={22} />
      </span>
      <div className="text-[15px] font-semibold">{title}</div>
      {children ? <div className="max-w-md text-ink-2">{children}</div> : null}
      {action ? <div className="mt-3 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  );
}

/** Fills from zero when it first appears, so the eye follows the bar to the target mark. */
export function Meter({ value, goal, passed }: { value: number; goal: number; passed: boolean }) {
  const calm = useReducedMotion();
  return (
    <div className="relative h-1.5 w-full rounded-full bg-surface-3" aria-hidden>
      <motion.div
        className={cx("absolute inset-y-0 left-0 w-full origin-left rounded-full", passed ? "bg-ok" : "bg-warn")}
        initial={calm ? false : { scaleX: 0 }}
        animate={{ scaleX: Math.max(0.02, Math.min(1, value)) }}
        transition={{ ...SOFT_SPRING, delay: 0.08 }}
      />
      <div className="absolute -top-1 h-3.5 w-0.5 rounded bg-ink" style={{ left: `calc(${goal * 100}% - 1px)` }} title="target" />
    </div>
  );
}

/** The sticky footer of a step: back to the previous step, a note on what comes next, and the main action. */
export function ActionBar({ children, note, back }: { children?: ReactNode; note?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-line bg-paper/95 px-4 py-3 backdrop-blur-sm sm:-mx-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-3">
        {back ? (
          <Link href={back.href} className="btn btn-ghost -ml-2 flex-none">
            <CaretLeft size={14} weight="bold" /> {back.label}
          </Link>
        ) : null}
        <div className="hidden min-w-0 grow basis-[200px] text-[13.5px] text-ink-2 sm:block">{note}</div>
        <div className="grow sm:hidden" />
        <div className="flex flex-wrap gap-2">{children}</div>
      </div>
    </div>
  );
}

export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="anim-overlay fixed inset-0 z-50 bg-[var(--overlay)]" />
        <Dialog.Content
          className={cx(
            "anim-dialog fixed left-1/2 top-[8vh] z-50 flex max-h-[84vh] w-[calc(100vw-32px)] -translate-x-1/2 flex-col rounded-[12px] border border-line bg-surface shadow-float",
            wide ? "max-w-4xl" : "max-w-lg",
          )}
        >
          <div className="flex items-start gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0 grow">
              <Dialog.Title className="text-[16px] font-semibold">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-0.5 text-[13px] text-ink-2">{description}</Dialog.Description> : null}
            </div>
            <Dialog.Close className="icon-btn -mr-2 -mt-1" aria-label="Close">
              <X size={16} />
            </Dialog.Close>
          </div>
          <div className="min-h-0 overflow-auto px-5 py-4">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Confirm({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  onConfirm,
  danger,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: ReactNode;
  confirmLabel: string;
  onConfirm: () => Promise<void> | void;
  danger?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title}>
      <div className="text-ink-2">{body}</div>
      <div className="mt-5 flex justify-end gap-2">
        <Button onClick={() => onOpenChange(false)}>Keep going</Button>
        <Button
          variant={danger ? "danger" : "primary"}
          busy={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onOpenChange(false);
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}
