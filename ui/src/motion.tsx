import { motion, useReducedMotion, type HTMLMotionProps } from "motion/react";
import { useEffect, useState } from "react";

/**
 * Motion tokens. Everything enters with a strong ease-out and stays under 300 ms; things that travel
 * (indicators, thumbs) use a stiff spring so they settle without wobble and can be interrupted mid-way.
 * Only transform and opacity animate. MotionConfig in main.tsx honours prefers-reduced-motion.
 */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const DURATION = { fast: 0.15, base: 0.22, slow: 0.3 } as const;
export const SPRING = { type: "spring", stiffness: 520, damping: 42, mass: 0.9 } as const;
export const SOFT_SPRING = { type: "spring", stiffness: 340, damping: 32 } as const;

/** A result arriving: fades and rises 6 px. `order` staggers sibling blocks by 50 ms. */
export function Reveal({ order = 0, ...props }: HTMLMotionProps<"div"> & { order?: number }) {
  const calm = useReducedMotion();
  return (
    <motion.div
      initial={calm ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: order * 0.05 }}
      {...props}
    />
  );
}

/** True only after `active` has stayed true for `delay` ms, so quick loads never flash a spinner. */
export function useDelayed(active: boolean, delay = 180) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const t = setTimeout(() => setShown(true), delay);
    return () => clearTimeout(t);
  }, [active, delay]);
  return shown;
}
