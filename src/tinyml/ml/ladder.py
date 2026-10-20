"""Step 4: try each method on the algorithm ladder and recommend the simplest one that meets the target.

Rung 1, rules: threshold rules for anomalies, a small decision tree for events.
Rung 2, classic ML: an isolation forest for anomalies; a random forest and boosted trees (XGBoost) for events.

Every method has a few settings. Each setting is scored by cross-validation inside the training recordings
(and, for anomalies, on validation fault windows); the simplest setting within one standard error of the best
is kept, refitted on all training windows and tested once on recordings the model never saw. Test windows
never influence a choice. Candidates over the memory budget are dropped before they are tested.
"""

from __future__ import annotations

import json
import math
import warnings
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np

from tinyml.features.spec import FeatureDef, describe
from tinyml.ml.models import (
    DecisionTolerance,
    Model,
    ThresholdRule,
    TreeEnsemble,
    average_path_length,
    f32,
    sklearn_tree_tables,
)
from tinyml.ml.split import Split
from tinyml.recipes import Recipe

RUNG_NAMES = {1: "rules", 2: "classic ML"}
MAX_SELECTED_FEATURES = 12
RULE_PAIR_POOL = 12
METHODS = {
    "threshold_rule": (
        "Simple limits",
        "Raises an alert when one or two measurements go past a limit learned from normal data. "
        "The easiest to read and the smallest to run.",
    ),
    "decision_tree": (
        "Decision rules",
        "A short list of if-then checks on a few measurements, learned from your labelled examples. "
        "Easy to read and very small.",
    ),
    "random_forest": (
        "Random forest",
        "Many small decision trees vote on the answer. Copes better with messy data than one set of rules, "
        "but is larger and cannot be read line by line.",
    ),
    "gradient_boosting": (
        "Boosted trees (XGBoost)",
        "Small trees added one after another, each correcting the mistakes of the ones before. "
        "Often the most accurate classic method, and the hardest to read.",
    ),
    "isolation_forest": (
        "Isolation forest",
        "Learns what normal looks like from many random splits and flags windows that stand out. "
        "Catches unusual combinations that no single limit would.",
    ),
}


@dataclass
class Setting:
    """One setting of one method and how it scored in cross-validation."""

    label: str
    params: dict[str, Any]
    cv: float | None = None
    cv_std: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)
    chosen: bool = False

    def summary(self) -> dict[str, Any]:
        return {"label": self.label, "cv": self.cv, "cv_std": self.cv_std, "chosen": self.chosen, **self.extra}


@dataclass
class Candidate:
    rung: int
    algorithm: str
    model: Model | None
    metrics: dict[str, Any]
    passed: bool
    note: str
    size_bytes: int
    details: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        return {"rung": self.rung, "algorithm": self.algorithm, "metrics": self.metrics, "passed": self.passed,
                "note": self.note, "size_bytes": self.size_bytes, "details": self.details}


@dataclass
class LadderResult:
    candidates: list[Candidate]
    chosen: Candidate | None  # the recommendation: the simplest candidate that meets the target
    classes: list[str]
    data_request: str | None = None
    explanation: str = ""
    best: Candidate | None = None  # the strongest candidate, whether or not it meets the target
    extras: dict[str, Any] = field(default_factory=dict)


class LadderInputs:
    def __init__(self, F: np.ndarray, defs: list[FeatureDef], labels: np.ndarray, split: Split, task: str,
                 normal_label: str | None, recipe: Recipe, seed: int, tol_rtol: np.ndarray, tol_atol: np.ndarray,
                 unstable: np.ndarray):
        self.F, self.defs, self.labels, self.split = F, defs, labels, split
        self.task, self.normal_label, self.recipe, self.seed = task, normal_label, recipe, seed
        self.tol_rtol, self.tol_atol, self.unstable = tol_rtol, tol_atol, unstable
        if task == "anomaly":
            self.classes = ["normal", "anomaly"]
            is_normal = labels == normal_label if normal_label is not None else np.ones(len(labels), dtype=bool)
            self.y = (~is_normal).astype(int)
        else:
            self.classes = sorted(set(labels.tolist()))
            index = {c: i for i, c in enumerate(self.classes)}
            self.y = np.array([index[c] for c in labels], dtype=int)
        self.val_faults = split.val_faults if split.val_faults is not None else np.zeros(len(labels), dtype=bool)
        self.budget = recipe.model_budget_kb * 1024
        self.target = recipe.target(task)

    def tol(self, idx: list[int], rows: np.ndarray | None = None) -> DecisionTolerance:
        unstable = self.unstable[:, idx] if rows is None else self.unstable[rows][:, idx]
        return DecisionTolerance(self.tol_rtol[idx], self.tol_atol[idx], unstable)

    @property
    def folds(self) -> list[tuple[np.ndarray, np.ndarray]]:
        return self.split.folds


# ---------------------------------------------------------------------------- scoring
def evaluate(model: Model, inp: LadderInputs) -> dict[str, Any]:
    test = inp.split.test
    pred = model.predict(inp.F[test][:, model.feature_idx]).labels
    y = inp.y[test]
    if inp.task == "anomaly":
        normal = y == 0
        far = float(np.mean(pred[normal] == 1)) if normal.any() else None
        detection = float(np.mean(pred[~normal] == 1)) if (~normal).any() else None
        return {"false_alarm_rate": far, "detection_rate": detection, "test_normal_windows": int(normal.sum()),
                "test_fault_windows": int((~normal).sum())}
    k = len(inp.classes)
    confusion = np.zeros((k, k), dtype=int)
    for t, p in zip(y, pred, strict=True):
        confusion[t, p] += 1
    recall = {inp.classes[i]: float(confusion[i, i] / confusion[i].sum()) if confusion[i].sum() else None
              for i in range(k)}
    present = [v for v in recall.values() if v is not None]
    return {"accuracy": float(np.mean(pred == y)) if len(y) else None,
            "balanced_accuracy": float(np.mean(present)) if present else None, "recall": recall,
            "confusion": confusion.tolist(), "test_windows": int(len(y))}


def meets_target(metrics: dict[str, Any], inp: LadderInputs) -> bool:
    if inp.task == "anomaly":
        far = metrics["false_alarm_rate"]
        det = metrics["detection_rate"]
        if far is None or far > inp.target["false_alarm_rate"]:
            return False
        return det is None or det >= inp.target["detection_rate"]
    acc, balanced = metrics["accuracy"], metrics["balanced_accuracy"]
    return acc is not None and balanced is not None and min(acc, balanced) >= inp.target["accuracy"]


def _candidate(model: Model, inp: LadderInputs, note: str = "") -> Candidate:
    size = model.size_bytes()
    if size > inp.budget:
        return Candidate(model.rung, model.algorithm, None, {}, False,
                         f"dropped: needs {size / 1024:.1f} KB, budget is {inp.budget / 1024:.0f} KB", size)
    metrics = evaluate(model, inp)
    return Candidate(model.rung, model.algorithm, model, metrics, meets_target(metrics, inp), note, size)


def _balanced_accuracy(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    recalls = [float(np.mean(y_pred[y_true == c] == c)) for c in np.unique(y_true)]
    return float(np.mean(recalls)) if recalls else 0.0


def _anomaly_score(far: float, det: float | None) -> float:
    """False alarms count double; without fault data only false alarms can be compared."""
    return (det if det is not None else 0.0) - 2.0 * far


def _cross_validate(inp: LadderInputs, score_fold: Callable[[np.ndarray, np.ndarray], tuple[float, dict]]
                    ) -> tuple[float | None, float | None, dict[str, Any]]:
    scores: list[float] = []
    extras: list[dict[str, Any]] = []
    for fit, check in inp.folds:
        score, extra = score_fold(fit, check)
        scores.append(score)
        extras.append(extra)
    if not scores:
        return None, None, {}
    merged: dict[str, Any] = {"folds": len(scores)}
    for key in extras[0]:
        values = [e[key] for e in extras if e.get(key) is not None]
        merged[key] = float(np.mean(values)) if values else None
    return float(np.mean(scores)), float(np.std(scores)), merged


def _one_standard_error(settings: list[Setting]) -> Setting:
    """The simplest setting (settings are ordered simplest first) within one standard error of the best."""
    scored = [s for s in settings if s.cv is not None]
    if not scored:
        chosen = settings[0]
    else:
        best = max(scored, key=lambda s: s.cv)  # type: ignore[arg-type, return-value]
        folds = max(1, int(best.extra.get("folds") or 1))
        margin = (best.cv_std or 0.0) / math.sqrt(folds)
        chosen = next(s for s in settings if s.cv is not None and s.cv >= best.cv - margin)  # type: ignore[operator]
    chosen.chosen = True
    return chosen


# ---------------------------------------------------------------------------- feature selection
def _decorrelated(F: np.ndarray, order: list[int]) -> list[int]:
    chosen: list[int] = []
    for j in order:
        if len(chosen) >= MAX_SELECTED_FEATURES:
            break
        if any(abs(np.corrcoef(F[:, j], F[:, c])[0, 1]) > 0.95 for c in chosen):
            continue
        chosen.append(j)
    return sorted(chosen)


def _select_features(inp: LadderInputs) -> list[int]:
    """Up to 12 informative, not strongly correlated features, ranked on training windows only."""
    train = inp.split.train
    F = inp.F[train]
    std = F.std(axis=0)
    usable = [j for j in range(F.shape[1]) if np.isfinite(std[j]) and std[j] > 1e-12]
    if inp.task == "classification":
        # ANOVA F, not mutual information: on held-out people MI favoured measurements that separate the
        # events for one person only and lost about 25 points of balanced accuracy.
        from sklearn.feature_selection import f_classif

        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            f_scores, _ = f_classif(F[:, usable], inp.y[train])
        order = [usable[i] for i in np.argsort(-np.nan_to_num(f_scores, nan=0.0), kind="stable")]
    elif inp.val_faults.any():
        mu, sd = F[:, usable].mean(axis=0), F[:, usable].std(axis=0)
        separation = np.abs(np.median(inp.F[inp.val_faults][:, usable], axis=0) - mu) / sd
        order = [usable[i] for i in np.lexsort(([inp.defs[usable[i]].cost_rank for i in range(len(usable))],
                                                -separation))]
    else:
        order = sorted(usable, key=lambda j: (inp.defs[j].cost_rank, j))
    return _decorrelated(F, order)


# ---------------------------------------------------------------------------- tree tables
def _sk_classifier_tables(algorithm: str, rung: int, estimators: list[Any], classes: np.ndarray, feature_idx: list[int],
                          inp: LadderInputs) -> TreeEnsemble:
    k = len(inp.classes)

    def leaf(tree, node, depth):
        row = np.zeros(k, dtype=np.float64)
        values = tree.value[node][0]
        total = values.sum()
        for ci, cls in enumerate(classes):
            row[int(cls)] = values[ci] / total if total else 0.0
        return row.tolist()

    roots, feature, threshold, left, right, leaves = sklearn_tree_tables(estimators, None, leaf)
    return TreeEnsemble(algorithm, rung, inp.classes, feature_idx, "le", roots, feature, threshold, left, right,
                        np.array(leaves), "proba")


def _compact(model: TreeEnsemble) -> TreeEnsemble:
    used = sorted({int(f) for f in model.feature if f >= 0})
    remap = {old: new for new, old in enumerate(used)}
    model.feature = np.array([remap[int(f)] if f >= 0 else -1 for f in model.feature], dtype=np.int32)
    model.feature_idx = [model.feature_idx[u] for u in used]
    return model


def _tree_depths(model: TreeEnsemble) -> list[int]:
    depths = []
    for root in model.roots:
        deepest, stack = 0, [(root, 0)]
        while stack:
            node, depth = stack.pop()
            if model.feature[node] < 0:
                deepest = max(deepest, depth)
            else:
                stack += [(int(model.left[node]), depth + 1), (int(model.right[node]), depth + 1)]
        depths.append(deepest)
    return depths


# ---------------------------------------------------------------------------- classification methods
def _min_leaf(rows: np.ndarray) -> int:
    return max(3, int(0.01 * rows.sum()))


def _fit_decision_tree(inp: LadderInputs, rows: np.ndarray, depth: int):
    from sklearn.tree import DecisionTreeClassifier

    clf = DecisionTreeClassifier(max_depth=depth, min_samples_leaf=_min_leaf(rows), class_weight="balanced",
                                 random_state=inp.seed)
    clf.fit(inp.F[rows].astype(np.float32), inp.y[rows])
    return clf


def _decision_tree(inp: LadderInputs, depth: int) -> TreeEnsemble:
    clf = _fit_decision_tree(inp, inp.split.train, depth)
    return _compact(_sk_classifier_tables("decision_tree", 1, [clf], clf.classes_, list(range(inp.F.shape[1])), inp))


def _fit_random_forest(inp: LadderInputs, rows: np.ndarray, idx: list[int], n: int, depth: int):
    from sklearn.ensemble import RandomForestClassifier

    clf = RandomForestClassifier(n_estimators=n, max_depth=depth, min_samples_leaf=2, max_features="sqrt",
                                 class_weight="balanced_subsample", random_state=inp.seed, n_jobs=1)
    clf.fit(inp.F[rows][:, idx].astype(np.float32), inp.y[rows])
    return clf


def _random_forest(inp: LadderInputs, idx: list[int], n: int, depth: int) -> TreeEnsemble:
    clf = _fit_random_forest(inp, inp.split.train, idx, n, depth)
    return _compact(_sk_classifier_tables("random_forest", 2, clf.estimators_, clf.classes_, idx, inp))


def _balanced_weights(y: np.ndarray) -> np.ndarray:
    counts = np.bincount(y)
    return (len(y) / (len(counts) * np.maximum(counts, 1)))[y]


def _xgb_params(inp: LadderInputs, depth: int, eta: float) -> dict[str, Any]:
    params: dict[str, Any] = {"max_depth": depth, "eta": eta, "seed": inp.seed, "nthread": 1, "tree_method": "exact"}
    if len(inp.classes) == 2:
        params["objective"] = "binary:logistic"
    else:
        params.update(objective="multi:softprob", num_class=len(inp.classes))
    return params


def _fit_xgboost(inp: LadderInputs, rows: np.ndarray, idx: list[int], n: int, depth: int, eta: float):
    import xgboost as xgb

    X = inp.F[rows][:, idx].astype(np.float32)
    y = inp.y[rows]
    return xgb.train(_xgb_params(inp, depth, eta), xgb.DMatrix(X, label=y, weight=_balanced_weights(y)),
                     num_boost_round=n)


def _xgb_predict(booster, X: np.ndarray, classes: int) -> np.ndarray:
    import xgboost as xgb

    margins = booster.predict(xgb.DMatrix(X.astype(np.float32)), output_margin=True).reshape(len(X), -1)
    return (margins[:, 0] > 0).astype(int) if classes == 2 else np.argmax(margins, axis=1)


def _xgboost(inp: LadderInputs, idx: list[int], n: int, depth: int, eta: float) -> TreeEnsemble:
    import xgboost as xgb

    train = inp.split.train
    X = inp.F[train][:, idx].astype(np.float32)
    k = len(inp.classes)
    booster = _fit_xgboost(inp, train, idx, n, depth, eta)
    raw = json.loads(booster.save_raw("json"))
    model_json = raw["learner"]["gradient_booster"]["model"]
    out_dim = 1 if k == 2 else k
    roots, feature, threshold, left, right, leaves = [], [], [], [], [], []
    for t_i, tree in enumerate(model_json["trees"]):
        cls = int(model_json["tree_info"][t_i]) if out_dim > 1 else 0
        offset = len(feature)
        roots.append(offset)
        lc, rc = tree["left_children"], tree["right_children"]
        for node in range(len(lc)):
            if lc[node] == -1:
                row = [0.0] * out_dim
                row[cls] = float(np.float32(tree["split_conditions"][node]))
                feature.append(-1)
                threshold.append(0.0)
                left.append(-1)
                right.append(len(leaves))
                leaves.append(row)
            else:
                feature.append(int(tree["split_indices"][node]))
                threshold.append(float(np.float32(tree["split_conditions"][node])))
                left.append(offset + lc[node])
                right.append(offset + rc[node])
    model = TreeEnsemble("gradient_boosting", 2, inp.classes, idx, "lt", roots, feature, threshold, left, right,
                         np.array(leaves), "margin", base=[0.0] * out_dim)
    margins = booster.predict(xgb.DMatrix(X), output_margin=True).reshape(len(X), -1)
    sums, _ = model._walk(X.astype(np.float64), None)
    base = np.median(margins - sums, axis=0)
    if np.max(np.abs(margins - sums - base[None, :])) > 1e-3:
        raise RuntimeError("Could not reproduce XGBoost margins from its tree dump")
    model.base = [f32(b) for b in base]
    return _compact(model)


def _classifier_settings(inp: LadderInputs, settings: list[Setting],
                         fit_predict: Callable[[Setting, np.ndarray, np.ndarray], np.ndarray]) -> Setting:
    for setting in settings:
        def score(fit, check, setting=setting):
            pred = fit_predict(setting, fit, check)
            return _balanced_accuracy(inp.y[check], pred), {}

        setting.cv, setting.cv_std, setting.extra = _cross_validate(inp, score)
    return _one_standard_error(settings)


def _classification_candidates(inp: LadderInputs, log) -> list[Candidate]:
    candidates: list[Candidate] = []

    log("Rules: choosing how many questions the decision rules may ask")
    tree_settings = [Setting(f"depth {d} (up to {2 ** d} outcomes)", {"depth": d}) for d in (1, 2, 3, 4)]

    def tree_predict(s: Setting, fit: np.ndarray, check: np.ndarray) -> np.ndarray:
        return _fit_decision_tree(inp, fit, s.params["depth"]).predict(inp.F[check].astype(np.float32))

    chosen = _classifier_settings(inp, tree_settings, tree_predict)
    candidates.append(_finish(_decision_tree(inp, chosen.params["depth"]), inp, chosen, tree_settings,
                              "balanced accuracy"))

    idx = _select_features(inp)
    log(f"Classic ML: {len(idx)} measurements selected; tuning a random forest")
    forest_settings = [Setting(f"{n} trees, depth {d}", {"n": n, "depth": d})
                       for n, d in ((10, 4), (20, 4), (20, 6), (40, 6), (40, 8))]

    def forest_predict(s: Setting, fit: np.ndarray, check: np.ndarray) -> np.ndarray:
        clf = _fit_random_forest(inp, fit, idx, s.params["n"], s.params["depth"])
        return clf.predict(inp.F[check][:, idx].astype(np.float32))

    chosen = _classifier_settings(inp, forest_settings, forest_predict)
    candidates.append(_finish(_random_forest(inp, idx, chosen.params["n"], chosen.params["depth"]), inp, chosen,
                              forest_settings, "balanced accuracy"))

    log("Classic ML: tuning boosted trees (XGBoost)")
    boost_settings = [Setting(f"{n} rounds, depth {d}, learning rate {eta:g}", {"n": n, "depth": d, "eta": eta})
                      for n, d, eta in ((20, 2, 0.3), (20, 3, 0.3), (40, 3, 0.3), (60, 3, 0.15), (60, 4, 0.15))]
    try:
        def boost_predict(s: Setting, fit: np.ndarray, check: np.ndarray) -> np.ndarray:
            booster = _fit_xgboost(inp, fit, idx, s.params["n"], s.params["depth"], s.params["eta"])
            return _xgb_predict(booster, inp.F[check][:, idx], len(inp.classes))

        chosen = _classifier_settings(inp, boost_settings, boost_predict)
        model = _xgboost(inp, idx, chosen.params["n"], chosen.params["depth"], chosen.params["eta"])
        candidates.append(_finish(model, inp, chosen, boost_settings, "balanced accuracy"))
    except Exception as exc:  # keep going if XGBoost is unavailable or misbehaves
        candidates.append(Candidate(2, "gradient_boosting", None, {}, False, f"skipped: {exc}", 0,
                                    _describe_method("gradient_boosting")))
    return candidates


# ---------------------------------------------------------------------------- anomaly methods
def _limit_stats(F_fit: np.ndarray, far_target: float) -> tuple[np.ndarray, ...]:
    """Mean, spread and how many spreads away from the mean each limit sits, for 'above' and 'below' limits."""
    mu, sd = F_fit.mean(axis=0), F_fit.std(axis=0)
    usable = np.isfinite(sd) & (sd > 1e-12 * np.maximum(1.0, np.abs(mu)))
    z = (F_fit - mu) / np.where(usable, sd, 1.0)
    q = 1 - far_target / 2
    k_gt = np.maximum(3.0, np.quantile(z, q, axis=0) + 0.5)
    k_lt = np.maximum(3.0, np.quantile(-z, q, axis=0) + 0.5)
    return mu, sd, usable, k_gt, k_lt


def _limit_fires(F_rows: np.ndarray, stats: tuple[np.ndarray, ...]) -> np.ndarray:
    """(rows, 2 * features): column j fires when feature j is above its limit, column J + j when below."""
    mu, sd, _, k_gt, k_lt = stats
    return np.concatenate([F_rows > mu + k_gt * sd, F_rows < mu - k_lt * sd], axis=1)


def _limit_condition(column: int, n_features: int, stats: tuple[np.ndarray, ...]) -> tuple[int, str, float, float, float]:
    mu, sd, _, k_gt, k_lt = stats
    j = column % n_features
    op = "gt" if column < n_features else "lt"
    return j, op, float(mu[j]), float(sd[j]), float(k_gt[j] if op == "gt" else k_lt[j])


def _combine(specs: list[tuple[int, str, float, float, float]]) -> ThresholdRule:
    idx: list[int] = []
    conditions = []
    for j, op, mu, sigma, k in specs:
        if j not in idx:
            idx.append(j)
        conditions.append(ThresholdRule.make_condition(idx.index(j), op, mu, sigma, k))
    return ThresholdRule(idx, conditions)


def _rule_name(columns: tuple[int, ...], inp: LadderInputs) -> str:
    n = inp.F.shape[1]
    return " or ".join(f"{describe(inp.defs[c % n])} too {'high' if c < n else 'low'}" for c in columns)


def _rule_candidate(inp: LadderInputs, log) -> Candidate:
    """Score every single limit and the best pairs on held-out normal windows and validation faults."""
    log("Rules: scoring a limit on every measurement")
    train = inp.split.train & (inp.y == 0)
    n = inp.F.shape[1]
    far_target, det_target = inp.target["false_alarm_rate"], inp.target["detection_rate"]
    has_faults = bool(inp.val_faults.any())
    full = _limit_stats(inp.F[train], far_target)
    usable = np.concatenate([full[2], full[2]])
    folds = inp.folds or [(train, train)]
    fold_normal, fold_fault = [], []
    for fit, check in folds:
        stats = _limit_stats(inp.F[fit & (inp.y == 0)], far_target)
        usable &= np.concatenate([stats[2], stats[2]])
        fold_normal.append(_limit_fires(inp.F[check], stats))
        fold_fault.append(_limit_fires(inp.F[inp.val_faults], stats) if has_faults else None)
    cost = np.array([inp.defs[c % n].cost_rank for c in range(2 * n)])

    def rates(columns: tuple[int, ...]) -> tuple[float, float | None]:
        far = float(np.mean([f[:, list(columns)].any(axis=1).mean() for f in fold_normal]))
        det = float(np.mean([f[:, list(columns)].any(axis=1).mean() for f in fold_fault])) if has_faults else None
        return far, det

    singles = []
    for c in np.where(usable)[0]:
        far, det = rates((int(c),))
        singles.append(((int(c),), far, det, _anomaly_score(far, det) - 0.01 * float(cost[c])))
    if not singles:
        return Candidate(1, "threshold_rule", None, {}, False, "skipped: every measurement is constant", 0,
                         _describe_method("threshold_rule"))
    singles.sort(key=lambda s: s[3], reverse=True)
    tried = len(singles)
    if not has_faults:
        preferred = [s for s in singles if s[0][0] < n and inp.defs[s[0][0]].kind in ("rms", "kurt")
                     and inp.defs[s[0][0]].channel_index in (0, -1)]
        picks = preferred[:2] if len(preferred) >= 2 else singles[:2]
        columns = tuple(c for p in picks for c in p[0])
        far, det = rates(columns)
        options = [(columns, far, det, _anomaly_score(far, det))]
        note = "no fault data: watches vibration strength and sharp impacts"
    else:
        options = list(singles[:5])
        best = singles[0]
        meets = best[1] <= far_target and (best[2] or 0) >= det_target
        if not meets:
            pool = [s for s in singles[:RULE_PAIR_POOL] if s[1] <= far_target]
            pairs = []
            for a in range(len(pool)):
                for b in range(a + 1, len(pool)):
                    ca, cb = pool[a][0][0], pool[b][0][0]
                    if ca % n == cb % n:
                        continue
                    far, det = rates((ca, cb))
                    pairs.append(((ca, cb), far, det, _anomaly_score(far, det) - 0.01 * float(cost[ca] + cost[cb])))
            tried += len(pairs)
            pairs.sort(key=lambda s: s[3], reverse=True)
            options += pairs[:5]
        options.sort(key=lambda s: s[3], reverse=True)
        columns = options[0][0]
        if len(columns) == 2 and options[0][3] < best[3] + 0.02:
            columns = best[0]
        note = "two limits combined" if len(columns) == 2 else ""
    settings = [Setting(_rule_name(cols, inp), {"columns": cols}, cv=score, cv_std=None,
                        extra={"false_alarm_rate": far, "detection_rate": det, "folds": len(folds)},
                        chosen=cols == columns)
                for cols, far, det, score in options]
    chosen = next(s for s in settings if s.chosen)
    model = _combine([_limit_condition(c, n, full) for c in columns])
    cand = _finish(model, inp, chosen, settings, "detection minus twice the false alarms", note)
    cand.details["settings_tried"] = tried
    return cand


def _fit_isolation_forest(inp: LadderInputs, rows: np.ndarray, idx: list[int], n: int, samples: int):
    from sklearn.ensemble import IsolationForest

    X = inp.F[rows][:, idx].astype(np.float32)
    forest = IsolationForest(n_estimators=n, max_samples=min(samples, len(X)), random_state=inp.seed)
    forest.fit(X)
    return forest, X


def _isolation_forest(inp: LadderInputs, idx: list[int], n: int, samples: int) -> TreeEnsemble:
    forest, X = _fit_isolation_forest(inp, inp.split.train & (inp.y == 0), idx, n, samples)

    def leaf(tree, node, depth):
        return [depth + average_path_length(float(tree.n_node_samples[node]))]

    maps = [list(map(int, f)) for f in forest.estimators_features_]
    roots, feature, threshold, left, right, leaves = sklearn_tree_tables(forest.estimators_, maps, leaf)
    c_norm = average_path_length(float(forest.max_samples_))
    model = TreeEnsemble("isolation_forest", 2, inp.classes, idx, "le", roots, feature, threshold, left, right,
                         np.array(leaves), "depth", extra={"depth_threshold": 0.0, "c_norm": f32(c_norm)})
    sums, _ = model._walk(X.astype(np.float64), None)
    avg = sums[:, 0] / n
    model.extra["depth_threshold"] = f32(float(np.quantile(avg, inp.target["false_alarm_rate"] / 2)))
    model.extra["train_mean_depth"] = f32(float(avg.mean()))
    return _compact(model)


def _forest_candidate(inp: LadderInputs, log) -> Candidate:
    idx = _select_features(inp)
    log(f"Classic ML: {len(idx)} measurements selected; tuning an isolation forest")
    far_target = inp.target["false_alarm_rate"]
    has_faults = bool(inp.val_faults.any())
    settings = [Setting(f"{n} trees, {s} windows each", {"n": n, "samples": s})
                for n, s in ((25, 64), (25, 256), (50, 64), (50, 256), (100, 256))]
    for setting in settings:
        def score(fit, check, setting=setting):
            forest, X_fit = _fit_isolation_forest(inp, fit & (inp.y == 0), idx, setting.params["n"],
                                                  setting.params["samples"])
            limit = np.quantile(forest.score_samples(X_fit), far_target / 2)
            far = float(np.mean(forest.score_samples(inp.F[check][:, idx].astype(np.float32)) < limit))
            det = None
            if has_faults:
                det = float(np.mean(forest.score_samples(inp.F[inp.val_faults][:, idx].astype(np.float32)) < limit))
            return _anomaly_score(far, det), {"false_alarm_rate": far, "detection_rate": det}

        setting.cv, setting.cv_std, setting.extra = _cross_validate(inp, score)
    chosen = _one_standard_error(settings)
    model = _isolation_forest(inp, idx, chosen.params["n"], chosen.params["samples"])
    return _finish(model, inp, chosen, settings, "detection minus twice the false alarms")


# ---------------------------------------------------------------------------- candidate details
def _describe_method(algorithm: str) -> dict[str, Any]:
    title, what = METHODS.get(algorithm, (algorithm.replace("_", " "), ""))
    return {"title": title, "what": what}


def _finish(model: Model, inp: LadderInputs, chosen: Setting, settings: list[Setting], cv_metric: str,
            note: str = "") -> Candidate:
    cand = _candidate(model, inp, note or chosen.label)
    used = [inp.defs[i] for i in model.feature_idx]
    details = {
        **_describe_method(model.algorithm),
        "setting": chosen.label,
        "settings": [s.summary() for s in settings],
        "settings_tried": len(settings),
        "cv": {"metric": cv_metric, "score": chosen.cv, "std": chosen.cv_std, **chosen.extra},
        "features": [describe(f) for f in used],
        "needs_fft": any(f.spectral for f in used),
    }
    if isinstance(model, TreeEnsemble):
        depths = _tree_depths(model)
        details["cost"] = {"trees": len(depths), "max_depth": max(depths, default=0),
                           "comparisons": int(sum(depths)), "nodes": model.n_nodes}
    elif isinstance(model, ThresholdRule):
        details["cost"] = {"comparisons": len(model.conditions)}
    if cand.model is not None:
        details["explanation"] = model.explain(used, cand.passed)
    cand.details = details
    return cand


def _metric_text(metrics: dict[str, Any], task: str) -> str:
    if task == "anomaly":
        det, far = metrics.get("detection_rate"), metrics.get("false_alarm_rate")
        caught = "could not be checked on faults" if det is None else f"caught {det:.0%} of faults"
        return f"{caught} with {far or 0:.0%} false alarms"
    return f"recognised {metrics.get('balanced_accuracy') or 0:.0%} of each event on average"


def _target_text(inp: LadderInputs) -> str:
    if inp.task == "anomaly":
        return (f"catch at least {inp.target['detection_rate']:.0%} of faults with at most "
                f"{inp.target['false_alarm_rate']:.0%} false alarms")
    return f"recognise at least {inp.target['accuracy']:.0%} of every event"


def _explain_choices(candidates: list[Candidate], chosen: Candidate | None, best: Candidate | None,
                     inp: LadderInputs) -> None:
    """One plain sentence per candidate: why it is, or is not, the recommendation."""
    for cand in candidates:
        title = cand.details.get("title", cand.algorithm)
        if cand.model is None:
            cand.details["why"] = cand.note[0].upper() + cand.note[1:] + "." if cand.note else "Not trained."
        elif cand is chosen:
            simpler = [c for c in candidates[:candidates.index(cand)] if c.model is not None]
            lead = ("Recommended: the simplest method that met the target"
                    if not simpler else f"Recommended: simpler methods ({', '.join(c.details['title'] for c in simpler)})"
                    " fell short, and this is the next simplest that met the target")
            cand.details["why"] = f"{lead} on recordings it never saw ({_metric_text(cand.metrics, inp.task)})."
        elif cand.passed:
            cand.details["why"] = (f"Also met the target ({_metric_text(cand.metrics, inp.task)}), but "
                                   f"{chosen.details['title'] if chosen else 'a simpler method'} is simpler and "
                                   "smaller, so it is preferred.")
        elif cand is best and chosen is None:
            cand.details["why"] = (f"The strongest option, but still below the target: it "
                                   f"{_metric_text(cand.metrics, inp.task)}; the target is to {_target_text(inp)}.")
        else:
            cand.details["why"] = (f"Below the target: it {_metric_text(cand.metrics, inp.task)}; the target is to "
                                   f"{_target_text(inp)}.")
        cand.details.setdefault("title", title)


# ---------------------------------------------------------------------------- the ladder
def run_ladder(inp: LadderInputs, log=lambda msg: None) -> LadderResult:
    log(f"Choosing settings by {inp.split.fold_method or 'scoring on the training windows'}")
    if inp.task == "anomaly":
        candidates = [_rule_candidate(inp, log), _forest_candidate(inp, log)]
    else:
        candidates = _classification_candidates(inp, log)

    best = max((c for c in candidates if c.model is not None), key=lambda c: strength(c.metrics, inp.task),
               default=None)
    chosen = next((c for c in candidates if c.passed), None)
    _explain_choices(candidates, chosen, best, inp)
    if chosen is not None:
        log(f"Recommended: {chosen.details['title']} (rung {chosen.rung}), the simplest that meets the target")
        return LadderResult(candidates, chosen, inp.classes, explanation=explain(chosen, inp), best=best)
    return LadderResult(candidates, None, inp.classes, data_request=_data_request(candidates, inp), best=best)


def strength(metrics: dict[str, Any], task: str) -> float:
    """One number to compare candidates when none meets the target; false alarms count double."""
    if not metrics:
        return float("-inf")
    if task == "anomaly":
        return (metrics.get("detection_rate") or 0.0) - 2 * (metrics.get("false_alarm_rate") or 0.0)
    return metrics.get("balanced_accuracy") or 0.0


def explain(cand: Candidate, inp: LadderInputs) -> str:
    model = cand.model
    assert model is not None
    return model.explain([inp.defs[i] for i in model.feature_idx], cand.passed)


def _data_request(candidates: list[Candidate], inp: LadderInputs) -> str:
    scored = [c for c in candidates if c.metrics]
    if inp.task == "anomaly":
        best = max(scored, key=lambda c: strength(c.metrics, inp.task), default=None)
        if best is None:
            return "No model could be trained. Upload more normal recordings."
        det = best.metrics.get("detection_rate")
        far = best.metrics.get("false_alarm_rate")
        det_text = f"caught {det:.0%} of faults" if det is not None else "could not be checked on faults"
        return (f"Even the best model {det_text} with {far:.0%} false alarms (targets: catch "
                f"{inp.target['detection_rate']:.0%}, at most {inp.target['false_alarm_rate']:.0%} false alarms). "
                "Record more normal operation across the speeds and loads the machine really sees, and check that "
                "fault recordings come from the same sensor position.")
    best = max(scored, key=lambda c: c.metrics.get("balanced_accuracy") or 0, default=None)
    if best is None:
        return "No model could be trained. Upload more labelled recordings."
    recall = {k: v for k, v in best.metrics["recall"].items() if v is not None}
    weakest = sorted(recall.items(), key=lambda kv: kv[1])[:2]
    weak_text = ", ".join(f"'{k}' ({v:.0%} recognised)" for k, v in weakest)
    return (f"The best model recognised {best.metrics['balanced_accuracy']:.0%} of events on average; the target is "
            f"{inp.target['accuracy']:.0%}. The weakest events are {weak_text}. Record more examples of them, "
            "ideally from more sessions or people.")


def describe_features(defs: list[FeatureDef]) -> list[str]:
    return [describe(d) for d in defs]
