export const pct = (v: number | null | undefined, digits = 0) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(digits)}%`);

export const num = (v: number | null | undefined, digits = 0) =>
  v === null || v === undefined
    ? "–"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

export const bytes = (b: number | null | undefined) => {
  if (b === null || b === undefined) return "–";
  if (b < 1024) return `${num(b)} B`;
  return `${(b / 1024).toFixed(b < 10240 ? 1 : 0)} KB`;
};

export const kb = (k: number) => (k >= 1024 ? `${num(k / 1024, k % 1024 ? 1 : 0)} MB` : `${num(k)} KB`);

export const cap = (t: string | null | undefined) => (t ? t[0].toUpperCase() + t.slice(1) : "");

export const plural = (n: number, word: string, many = `${word}s`) => `${num(n)} ${n === 1 ? word : many}`;

export const RADIO: Record<string, string> = { wifi: "Wi-Fi", ble: "Bluetooth LE", thread: "Thread", zigbee: "Zigbee" };

export const CONNECTIVITY: Record<string, string> = {
  wifi: "Wi-Fi",
  ble: "Bluetooth LE",
  cellular: "Cellular",
  none: "No radio",
  any: "Not decided",
};

export const PRIORITY: Record<string, string> = { battery: "Battery life", cost: "Low cost", speed: "Speed" };

export function relativeTime(iso: string) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  const days = Math.floor(diff / 86400);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(iso).toLocaleDateString();
}

export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : (JSON.parse(v) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage can be unavailable in private windows; the app works without it */
    }
  },
};
