"""Train/test split by recording session, plus the validation data used to choose model settings.

Neighbouring windows from one recording are near-copies. Splitting windows at random puts
near-copies on both sides and gives fake-good accuracy, so whole recordings go to one side.
When a class has only one recording, the end of each recording is held back instead.

Settings are chosen without looking at the test windows: by cross-validation inside the training
windows (whole recordings held out in turn, or time blocks with the overlapping neighbours removed),
and, for anomaly detection, on a share of the fault windows that is never used for the final test.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from tinyml.data.windows import WindowSet

TEST_SHARE = 0.25
CV_FOLDS = 4
MIN_CHECK_WINDOWS = 5
MIN_FOLD_RECORDINGS = 3


@dataclass
class Split:
    train: np.ndarray  # bool mask over windows
    test: np.ndarray
    method: str
    val_faults: np.ndarray | None = None  # anomaly only: fault windows for choosing settings, never tested on
    folds: list[tuple[np.ndarray, np.ndarray]] = field(default_factory=list)  # (fit, check) masks inside train
    fold_method: str = ""


def _run_keys(ws: WindowSet) -> np.ndarray:
    return np.char.add(np.char.add(ws.recordings.astype(str), "\x00"), ws.labels.astype(str))


def _hold_back_end(ws: WindowSet, rows: np.ndarray, share: float = TEST_SHARE) -> tuple[np.ndarray, np.ndarray]:
    """For each (recording, label) run, the last `share` goes to the second mask; windows overlapping the cut are dropped."""
    first = np.zeros(len(ws), dtype=bool)
    second = np.zeros(len(ws), dtype=bool)
    keys = _run_keys(ws)
    for key in np.unique(keys[rows]):
        idx = np.where(rows & (keys == key))[0]
        idx = idx[np.argsort(ws.starts[idx])]
        if len(idx) < 4:
            first[idx] = True
            continue
        cut = int(np.ceil(len(idx) * (1 - share)))
        cut_start = ws.starts[idx[cut]]
        second[idx[cut:]] = True
        safe = ws.starts[idx[:cut]] + ws.window_samples <= cut_start
        first[idx[:cut][safe]] = True
    return first, second


def _pick_test_recordings(recs: list[str], rng: np.random.Generator) -> set[str]:
    order = list(recs)
    rng.shuffle(order)
    count = max(1, int(round(len(order) * TEST_SHARE)))
    return set(order[:count])


def _split_faults(ws: WindowSet, faults: np.ndarray, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    """Half of each kind of fault for choosing settings, the other half for the test. Whole recordings when possible."""
    val = np.zeros(len(ws), dtype=bool)
    test = np.zeros(len(ws), dtype=bool)
    for label in sorted(set(ws.labels[faults].tolist())):
        rows = faults & (ws.labels == label)
        recs = sorted(set(ws.recordings[rows].tolist()))
        if len(recs) >= 2:
            order = list(recs)
            rng.shuffle(order)
            chosen = np.isin(ws.recordings, order[: len(order) // 2]) & rows
            val |= chosen
            test |= rows & ~chosen
            continue
        if rows.sum() < 8:
            test |= rows
            continue
        first, second = _hold_back_end(ws, rows, share=0.5)
        val |= first
        test |= second
    return val, test


def _folds_by_recording(ws: WindowSet, train: np.ndarray, rng: np.random.Generator
                        ) -> list[tuple[np.ndarray, np.ndarray]] | None:
    recs = sorted(set(ws.recordings[train].tolist()))
    labels = sorted(set(ws.labels[train].tolist()))
    per_label = [len(set(ws.recordings[train & (ws.labels == c)].tolist())) for c in labels]
    # Holding out one of only two recordings leaves a single recording to learn from, which makes every
    # setting look far worse than it is; time blocks give a fairer comparison then.
    if len(recs) < MIN_FOLD_RECORDINGS or min(per_label) < MIN_FOLD_RECORDINGS:
        return None
    order = list(recs)
    rng.shuffle(order)
    k = min(CV_FOLDS, len(order))
    folds = []
    for f in range(k):
        held = order[f::k]
        check = train & np.isin(ws.recordings, held)
        fit = train & ~check
        if check.sum() < MIN_CHECK_WINDOWS or len(set(ws.labels[fit].tolist())) < len(labels):
            return None
        folds.append((fit, check))
    return folds


def _folds_by_time(ws: WindowSet, train: np.ndarray) -> list[tuple[np.ndarray, np.ndarray]]:
    """Each recording is cut into CV_FOLDS time blocks; fold f checks block f and drops overlapping neighbours."""
    block = np.full(len(ws), -1)
    keys = _run_keys(ws)
    for key in np.unique(keys[train]):
        idx = np.where(train & (keys == key))[0]
        idx = idx[np.argsort(ws.starts[idx])]
        block[idx] = (np.arange(len(idx)) * CV_FOLDS) // max(len(idx), 1)
    folds = []
    for f in range(CV_FOLDS):
        check = train & (block == f)
        fit = train & ~check
        for rec in np.unique(ws.recordings[check]):
            in_rec = ws.recordings == rec
            check_starts = np.sort(ws.starts[check & in_rec])
            rows = np.where(fit & in_rec)[0]
            pos = np.searchsorted(check_starts, ws.starts[rows])
            before = np.abs(ws.starts[rows] - check_starts[np.clip(pos - 1, 0, len(check_starts) - 1)])
            after = np.abs(ws.starts[rows] - check_starts[np.clip(pos, 0, len(check_starts) - 1)])
            fit[rows[np.minimum(before, after) < ws.window_samples]] = False
        if check.sum() and fit.sum():
            folds.append((fit, check))
    return folds


def cv_folds(ws: WindowSet, train: np.ndarray, seed: int) -> tuple[list[tuple[np.ndarray, np.ndarray]], str]:
    folds = _folds_by_recording(ws, train, np.random.default_rng(seed + 1))
    if folds is not None:
        return folds, f"{len(folds)}-fold cross-validation, holding out whole training recordings in turn"
    folds = _folds_by_time(ws, train)
    return folds, (f"{len(folds)}-fold cross-validation on time blocks of each training recording "
                   "(overlapping neighbours removed)")


def split_windows(ws: WindowSet, task: str, normal_label: str | None, seed: int) -> Split:
    split = _train_test(ws, task, normal_label, seed)
    split.folds, split.fold_method = cv_folds(ws, split.train, seed)
    return split


def _train_test(ws: WindowSet, task: str, normal_label: str | None, seed: int) -> Split:
    rng = np.random.default_rng(seed)
    if task == "anomaly":
        normal = ws.labels == normal_label if normal_label is not None else np.ones(len(ws), dtype=bool)
        val_faults, test_faults = _split_faults(ws, ~normal, np.random.default_rng(seed + 2))
        normal_recs = sorted(set(ws.recordings[normal]))
        if len(normal_recs) >= 2:
            test_recs = _pick_test_recordings(normal_recs, rng)
            in_test = np.isin(ws.recordings, list(test_recs))
            return Split(normal & ~in_test, (normal & in_test) | test_faults, "whole recordings held back for testing",
                         val_faults)
        train, test = _hold_back_end(ws, normal)
        return Split(train, test | test_faults, "the end of each normal recording held back for testing", val_faults)

    classes = sorted(set(ws.labels))
    recs_by_class = {c: sorted(set(ws.recordings[ws.labels == c])) for c in classes}
    if all(len(r) >= 2 for r in recs_by_class.values()):
        for _ in range(50):
            test_recs: set[str] = set()
            for c in classes:
                if not test_recs & set(recs_by_class[c]):
                    test_recs |= _pick_test_recordings(recs_by_class[c], rng)
            ok = all(set(recs_by_class[c]) - test_recs for c in classes)
            if ok:
                in_test = np.isin(ws.recordings, list(test_recs))
                return Split(~in_test, in_test, "whole recordings held back for testing")
    train, test = _hold_back_end(ws, np.ones(len(ws), dtype=bool))
    return Split(train, test, "the end of each recording held back for testing")
