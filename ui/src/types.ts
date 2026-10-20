export type Tag = "measured" | "emulated" | "estimated";

export interface Tagged {
  value: number | null;
  unit?: string;
  tag: Tag;
  source?: string;
}

export interface Spec {
  recipe: string;
  task: "anomaly" | "classification";
  vendor: string;
  connectivity: "wifi" | "ble" | "cellular" | "none" | "any";
  power: "battery" | "plugged";
  budget_usd_per_unit: number | null;
  priority: "battery" | "cost" | "speed";
  max_latency_ms: number;
  description: string;
  seed: number;
}

export interface Project {
  id: string;
  name: string;
  description: string;
  spec: Spec | null;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Issue {
  severity: "fix" | "warn" | "block";
  message: string;
  code?: string;
}

export interface ColumnSummary {
  name: string;
  dtype: string;
  min: number | null;
  max: number | null;
  sample: string[];
}

export interface Dataset {
  id: string;
  files: string[];
  summary: { rows: number; columns: ColumnSummary[] };
  roles: Record<string, string>;
  label_map: { normal_label: string | null; labels: string[] } | null;
  issues: Issue[];
  stats: {
    sample_rate_hz?: number;
    recordings?: number;
    duration_s?: number;
    class_seconds?: Record<string, number>;
    class_recordings?: Record<string, number>;
    axes?: string[];
  } | null;
}

export interface SettingRow {
  label: string;
  cv: number | null;
  cv_std?: number | null;
  detection_rate?: number | null;
  false_alarm_rate?: number | null;
  chosen?: boolean;
}

export interface CandidateDetails {
  title?: string;
  what?: string;
  setting?: string;
  settings?: SettingRow[];
  settings_tried?: number;
  cv?: { score?: number | null };
  features?: string[];
  needs_fft?: boolean;
  cost?: { trees?: number; comparisons?: number };
  explanation?: string;
  why?: string;
}

export interface Metrics {
  detection_rate?: number | null;
  false_alarm_rate?: number | null;
  balanced_accuracy?: number | null;
  accuracy?: number | null;
  test_windows?: number;
  test_normal_windows?: number;
  test_fault_windows?: number;
  size_bytes?: number;
  confusion?: number[][];
}

export interface Candidate {
  id: string;
  rung: number;
  algorithm: string;
  metrics: Metrics | null;
  passed: number | boolean;
  selected: number | boolean;
  artifact_path: string | null;
  note: string | null;
  details: CandidateDetails | null;
}

export interface Training {
  split: string;
  windows: number;
  classes: string[];
  data_request: string | null;
  explanation: string;
  recommended: string | null;
  best: string | null;
  selected?: string | null;
  sample_rate_hz?: number;
  window_samples?: number;
  hop?: number;
  train_windows?: number;
  test_windows?: number;
  validation_fault_windows?: number;
  fold_method?: string;
  settings_tried?: number;
  viz?: {
    feature?: string;
    feature_label?: string;
    bins?: number[];
    hist?: Record<string, number[]>;
    thresholds?: number[];
  };
}

export interface ParityDetail {
  windows: number;
  label_matches: number;
  borderline?: number;
  worst_feature?: string | null;
  worst_tolerance_used?: number;
  failures?: { id: number }[];
  passed?: boolean;
}

export interface Measurement {
  chip_id: string;
  status: "ok" | "filtered" | "skipped" | "failed";
  backend?: string | null;
  flash_bytes?: Tagged | null;
  ram_bytes?: Tagged | null;
  stack_bytes?: Tagged | null;
  latency_ms?: Tagged | null;
  energy_uj?: Tagged | null;
  battery_days?: Tagged | null;
  price_usd?: Tagged | null;
  parity_ok?: boolean;
  parity_detail?: ParityDetail | null;
  toolchain?: string | null;
  emulator?: string | null;
  error?: string | null;
  filtered_reason?: string | null;
}

export interface ChipResult {
  id: string;
  chip_id: string;
  measurement: Measurement;
  score: number;
  rank: number | null;
  reasons: string[];
  tradeoffs: string[];
}

export interface Build {
  id: string;
  chip_id: string;
  version: string;
  package_path: string | null;
  passed: number | boolean;
  parity: ParityDetail & { measurement?: Measurement; blocked_reason?: string | null };
  created_at: string;
}

export type JobStatus = "queued" | "running" | "pausing" | "paused" | "cancelling" | "cancelled" | "done" | "failed";

export interface Job {
  id: string;
  kind: "train" | "select" | "rank" | "build";
  status: JobStatus;
  step: string | null;
  progress: number | null;
  log: string | null;
  error: string | null;
  params: { chip_id?: string; candidate_id?: string } | null;
  created_at: string;
  updated_at: string;
}

export interface ReviewFact {
  label: string;
  value: string;
  tag?: Tag | null;
}

export interface ReviewCheck {
  level: "ok" | "info" | "warn" | "block";
  text: string;
}

export type Stage = "data" | "model" | "rank" | "build";

export interface ReviewCard {
  stage: Stage;
  title: string;
  ref: string;
  status: "pending" | "approved" | "changes_requested";
  note: string | null;
  reviewed_at: string | null;
  headline: string;
  facts: ReviewFact[];
  checks: ReviewCheck[];
  step: string;
}

export interface Decision {
  id: number;
  decision_type: string;
  decision_key: string;
  question: string;
  options: string[];
  answer: string;
  confidence: number;
  source: string;
  follow_up: string | null;
  final_choice: string | null;
  build_passed: number | null;
  created_at: string;
}

export interface Preview {
  samples: { label: string; recording: string; rate: number; series: Record<string, number[]> }[];
}

export interface ProjectData {
  project: Project;
  chip_ids: string[];
  dataset: Dataset | null;
  candidates: Candidate[];
  training: Training | null;
  chip_results: ChipResult[];
  builds: Build[];
  jobs: Job[];
  active_job: Job | null;
  reviews: ReviewCard[];
  review_gates: boolean;
  pending_decisions: Decision[];
  preview: Preview | null;
}

export interface Chip {
  id: string;
  vendor: string;
  family: string;
  part_number: string;
  name: string;
  core_description: string;
  clock_mhz: number;
  ram_kb: number;
  flash_kb: number;
  radios: string[];
  price_usd: number;
  has_fpu: boolean;
  notes: string;
  onboarding: string;
  testable: boolean;
  not_testable_reason: string | null;
}

export interface Vendor {
  id: string;
  name: string;
  summary: string;
  chips: number;
}

export interface Catalog {
  info: { version: string; source: string };
  vendors: Vendor[];
  chips: Chip[];
}

export interface Recipe {
  id: string;
  title: string;
  summary: string;
  sensor?: string;
  window_ms?: number;
  hop_ratio?: number;
  feature_families?: string[];
  targets: {
    anomaly: { detection_rate: number; false_alarm_rate: number };
    classification: { accuracy: number };
  };
}

export interface Settings {
  assistant: { provider: "off" | "claude_code" | "claude_chat" };
  review_gates: boolean;
}

export interface DoctorChip {
  chip: string;
  name: string;
  ready: boolean;
  backend: string | null;
}

export interface Doctor {
  assistant?: { claude_code_found?: boolean; claude_version?: string | null };
  chips?: DoctorChip[];
}

export interface PackageFile {
  path: string;
  bytes: number;
  essential: boolean;
  note: string | null;
}

export interface AskResponse {
  source: "claude_code" | "claude_chat" | "off" | "unavailable";
  answer?: string;
  message?: string;
  prompt?: string;
  error?: string;
}

export interface LearnedRule {
  decision_type: string;
  decision_key: string;
  choice: string;
  support: number;
}
