"""A review card after each stage, and the optional gates that wait for a person to approve it.

Every card is built by plain code from what the stage wrote (never by an assistant), so reviewing works
with the assistant turned off. An approval is tied to what was reviewed (the dataset, model, ranking or
build id); re-running a stage makes the old approval stale.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

from tinyml.catalog import get_catalog
from tinyml.config import load_settings
from tinyml.ml.ladder import METHODS
from tinyml.store import Store, project_dir

STAGES = ("data", "model", "rank", "build")
TITLES = {"data": "Data checks", "model": "Model", "rank": "Chip ranking", "build": "Final build"}
NEEDS = {"train": "data", "rank": "model", "build": "model"}
LEVEL = {"fix": "info", "warn": "warn", "block": "block"}


def _chip_name(chip_id: str) -> str:
    try:
        return get_catalog().chip(chip_id).name
    except KeyError:
        return chip_id


def _tagged(n: dict[str, Any] | None, fmt: str, unit: str) -> dict[str, Any]:
    if not n or n.get("value") is None:
        return {"value": "not measured", "tag": None}
    return {"value": f"{fmt.format(n['value'])} {unit}".strip(), "tag": n.get("tag")}


def current_ref(store: Store, project_id: str, stage: str) -> str | None:
    if stage == "data":
        dataset = store.latest_dataset(project_id)
        return dataset["id"] if dataset else None
    if stage == "model":
        selected = store.selected_candidate(project_id)
        return selected["id"] if selected else None
    if stage == "rank":
        rows = store.chip_results(project_id)
        if not rows:
            return None
        return "rank_" + hashlib.sha256(",".join(sorted(r["id"] for r in rows)).encode()).hexdigest()[:12]
    builds = store.builds(project_id)
    return builds[0]["id"] if builds else None


# ------------------------------------------------------------------------------------- cards
def _data_card(store: Store, project_id: str) -> dict[str, Any]:
    ds = store.latest_dataset(project_id)
    assert ds is not None
    st = ds["stats"] or {}
    minutes = (st.get("duration_s") or 0) / 60
    roles: dict[str, list[str]] = {}
    for column, role in ds["roles"].items():
        roles.setdefault(role.replace("_", " "), []).append(column)
    facts = [
        {"label": "Recordings", "value": f"{st.get('recordings', 0)} ({minutes:.1f} minutes)"},
        {"label": "Readings per second", "value": f"{st.get('sample_rate_hz') or 0:,.0f}"},
    ]
    kinds = st.get("class_seconds") or {}
    if kinds:
        facts.append({"label": "Time per kind", "value": ", ".join(f"{k} {v / 60:.1f} min" for k, v in kinds.items())})
    facts.append({"label": "Columns", "value": "; ".join(f"{role}: {', '.join(cols)}" for role, cols in roles.items())})
    checks = [{"level": LEVEL[i["severity"]], "text": i["message"]} for i in ds["issues"]]
    pending = [d for d in store.decisions(project_id) if d["decision_type"] == "column_role" and d["final_choice"] is None]
    for d in {d["decision_key"]: d for d in pending}.values():
        checks.append({"level": "warn", "text": f"The platform guessed that column '{d['decision_key']}' is "
                                                f"{str(d['answer']).replace('_', ' ')}; check it on the Data step."})
    if not checks:
        checks.append({"level": "ok", "text": "No problems found in the data checks."})
    blocked = any(i["severity"] == "block" for i in ds["issues"])
    headline = (f"{st.get('recordings', 0)} recordings, {minutes:.1f} minutes of data."
                + (" Training is blocked until the problems below are fixed." if blocked else ""))
    return {"headline": headline, "facts": facts, "checks": checks, "step": "data"}


def _model_card(store: Store, project_id: str) -> dict[str, Any]:
    selected = store.selected_candidate(project_id)
    assert selected is not None
    spec = store.project(project_id)["spec"]  # type: ignore[index]
    training_path = project_dir(project_id, "models") / "training.json"
    training = json.loads(training_path.read_text()) if training_path.exists() else {}
    details = selected.get("details") or {}
    m = selected["metrics"] or {}
    title = details.get("title") or METHODS.get(selected["algorithm"], (selected["algorithm"],))[0]
    setting = details.get("setting") or selected["note"]
    facts: list[dict[str, Any]] = [{"label": "Method", "value": f"{title}, {setting}" if setting else title}]
    if spec["task"] == "anomaly":
        det = m.get("detection_rate")
        facts.append({"label": "Faults caught", "value": "no fault data" if det is None else f"{det:.0%}"})
        facts.append({"label": "False alarms", "value": f"{m.get('false_alarm_rate') or 0:.1%}"})
        tested = f"{m.get('test_normal_windows', 0)} normal and {m.get('test_fault_windows', 0)} fault windows"
    else:
        facts.append({"label": "Events recognised", "value": f"{m.get('balanced_accuracy') or 0:.0%} on average"})
        tested = f"{m.get('test_windows', 0)} windows"
    facts.append({"label": "Tested on", "value": f"{tested} from recordings it never saw"})
    size = m.get("size_bytes") or 0
    facts.append({"label": "Model size", "value": f"{size} bytes" if size < 1024 else f"{size / 1024:.1f} KB",
                  "tag": "estimated"})
    features = details.get("features") or []
    if features:
        facts.append({"label": "Measurements used", "value": f"{len(features)}"
                      + (", needs a frequency analysis (FFT)" if details.get("needs_fft") else "")})
    checks: list[dict[str, Any]] = []
    if not selected["passed"]:
        checks.append({"level": "warn", "text": "This model is below the target. You can still build it, and the "
                                                 "report will say so."})
    test_windows = (m.get("test_windows") or 0) + (m.get("test_normal_windows") or 0) + (m.get("test_fault_windows") or 0)
    if test_windows < 30:
        checks.append({"level": "warn", "text": f"Only {test_windows} test windows; the results could change "
                                                 "noticeably with more recordings."})
    cv = (details.get("cv") or {}).get("score")
    test_score = m.get("balanced_accuracy") if spec["task"] == "classification" else None
    if cv is not None and test_score is not None and cv - test_score > 0.1:
        checks.append({"level": "warn", "text": f"Cross-validation scored {cv:.0%} but the held-out recordings "
                                                 f"{test_score:.0%}: new people or machines may behave differently "
                                                 "from the training ones."})
    checks.append({"level": "ok", "text": "Settings were chosen without looking at the test recordings "
                                          f"({training.get('fold_method') or 'cross-validation'})."})
    headline = details.get("why") or details.get("explanation") or training.get("explanation", "")
    return {"headline": headline, "facts": facts, "checks": checks, "step": "model"}


def _rank_card(store: Store, project_id: str) -> dict[str, Any]:
    rows = store.chip_results(project_id)
    ranked = [r for r in rows if r["rank"]]
    left_out = [r for r in rows if not r["rank"]]
    facts = [{"label": f"#{r['rank']} {_chip_name(r['chip_id'])}", "value": f"score {r['score']:.0f}"}
             for r in ranked[:3]]
    checks: list[dict[str, Any]] = []
    skipped = [r for r in left_out if r["measurement"]["status"] == "skipped"]
    failed = [r for r in left_out if r["measurement"]["status"] == "failed"]
    if skipped:
        checks.append({"level": "warn", "text": f"{len(skipped)} chip(s) could not be tested on this computer because "
                                                "their build tools are not installed: "
                                                + ", ".join(_chip_name(r["chip_id"]) for r in skipped) + "."})
    if failed:
        checks.append({"level": "warn", "text": f"{len(failed)} chip build(s) failed: "
                                                + ", ".join(_chip_name(r["chip_id"]) for r in failed) + "."})
    others = len(left_out) - len(skipped) - len(failed)
    if others:
        checks.append({"level": "info", "text": f"{others} chip(s) were left out by your requirements or by memory "
                                                "and speed limits; see the Rank step for each reason."})
    if any(get_catalog().chip(r["chip_id"]).onboarding == "estimated" for r in ranked):
        checks.append({"level": "info", "text": "Some chips only have estimated numbers until they are onboarded; "
                                                "they are listed after chips with emulated numbers."})
    if ranked:
        top = ranked[0]
        headline = f"{_chip_name(top['chip_id'])} ranks first: " + "; ".join(top["reasons"][:3]) + "."
        checks.append({"level": "ok", "text": "Every ranked chip ran the model in an emulator and matched Python on the "
                                              "sample windows."})
    else:
        headline = "No chip passed every requirement. Relax the budget or radio requirement, or pick other chips."
    return {"headline": headline, "facts": facts, "checks": checks, "step": "rank"}


def _build_card(store: Store, project_id: str) -> dict[str, Any]:
    build = store.builds(project_id)[0]
    parity = build["parity"]
    m = parity.get("measurement") or {}
    name = _chip_name(build["chip_id"])
    if build["passed"]:
        headline = (f"{parity.get('label_matches')} of {parity.get('windows')} answers from the compiled firmware match "
                    f"Python on {name}. Package {build['version']} is signed and ready to download.")
    else:
        headline = f"Blocked on {name}: {parity.get('blocked_reason') or 'the firmware answers did not match Python'}."
    facts = [
        {"label": "Flash", **_tagged(m.get("flash_bytes"), "{:,.0f}", "bytes")},
        {"label": "RAM", **_tagged(m.get("ram_bytes"), "{:,.0f}", "bytes")},
        {"label": "Time per prediction", **_tagged(m.get("latency_ms"), "{:.3f}", "ms")},
        {"label": "Battery (MCU and sensor)", **_tagged(m.get("battery_days"), "{:,.0f}", "days")},
    ]
    checks: list[dict[str, Any]] = []
    if parity.get("borderline"):
        checks.append({"level": "info", "text": f"{parity['borderline']} window(s) were borderline: a legitimate float "
                                                "rounding difference could flip them, so they are reported, not failed."})
    selected = store.selected_candidate(project_id)
    if selected and not selected["passed"]:
        checks.append({"level": "warn", "text": "The model inside is below the target; the report says so."})
    if build["passed"]:
        checks.append({"level": "ok", "text": "Every golden window ran through the compiled firmware in the emulator."})
    else:
        checks.append({"level": "block", "text": "No package was written. Fix the cause above and build again."})
    return {"headline": headline, "facts": facts, "checks": checks, "step": "build"}


BUILDERS = {"data": _data_card, "model": _model_card, "rank": _rank_card, "build": _build_card}


def cards(store: Store, project_id: str) -> list[dict[str, Any]]:
    out = []
    for stage in STAGES:
        ref = current_ref(store, project_id, stage)
        if ref is None:
            continue
        review = store.latest_review(project_id, stage)
        status = review["status"] if review and review["ref"] == ref else "pending"
        out.append({"stage": stage, "title": TITLES[stage], "ref": ref, "status": status,
                    "note": review["note"] if review and review["ref"] == ref else None,
                    "reviewed_at": review["created_at"] if review and review["ref"] == ref else None,
                    **BUILDERS[stage](store, project_id)})
    return out


def record(store: Store, project_id: str, stage: str, status: str, note: str | None) -> dict[str, Any]:
    if stage not in STAGES:
        raise ValueError(f"stage must be one of {', '.join(STAGES)}")
    if status not in ("approved", "changes_requested"):
        raise ValueError("status must be approved or changes_requested")
    ref = current_ref(store, project_id, stage)
    if ref is None:
        raise ValueError(f"Nothing to review yet: the {TITLES[stage].lower()} step has not run")
    return store.save_review(project_id, stage, ref, status, (note or "").strip() or None)


def gate(store: Store, project_id: str, job_kind: str) -> str | None:
    """Why a job may not start yet, or None. Only active when review gates are on in the settings."""
    stage = NEEDS.get(job_kind)
    if stage is None or not load_settings().review_gates:
        return None
    ref = current_ref(store, project_id, stage)
    if ref is None:
        return None
    review = store.latest_review(project_id, stage)
    if review and review["ref"] == ref and review["status"] == "approved":
        return None
    return (f"Review the {TITLES[stage].lower()} step first: approve it in the review panel, or turn off review gates "
            "in Settings.")
