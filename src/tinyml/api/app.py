"""Local REST API and the web UI. Binds to 127.0.0.1 by default; nothing leaves the machine."""

from __future__ import annotations

import json
import shutil
import tempfile
import time
import zipfile
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from tinyml import __version__
from tinyml.catalog import get_catalog
from tinyml.config import AssistantSettings, Settings, load_settings, ui_dir
from tinyml.contracts import ProblemSpec
from tinyml.datasets import synthetic
from tinyml.decide import Decider
from tinyml.decide.providers import ClaudeCodeProvider, ProviderUnavailable
from tinyml.packaging.package import essentials_zip, package_files, read_package_file
from tinyml.pipeline import review, stages
from tinyml.pipeline.jobs import JobConflict, JobRunner
from tinyml.pipeline.measure import build_signature
from tinyml.ranking.score import pre_filter
from tinyml.recipes import load_recipes
from tinyml.store import get_store, project_dir
from tinyml.toolchains import doctor

runner: JobRunner | None = None
TESTABLE_TTL_S = 60.0
_testable: tuple[float, dict[str, str | None]] = (0.0, {})


@asynccontextmanager
async def lifespan(app: FastAPI):
    global runner
    runner = JobRunner(get_store())
    runner.resume()
    yield


app = FastAPI(title="tinyml", version=__version__, lifespan=lifespan)


def _store():
    return get_store()


def _project(project_id: str) -> dict[str, Any]:
    project = _store().project(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    return project


def _stage(fn, *args, **kwargs):
    try:
        return fn(*args, **kwargs)
    except stages.StageError as exc:
        raise HTTPException(400, str(exc)) from exc
    except (KeyError, ValueError) as exc:
        raise HTTPException(400, str(exc).strip("'\"")) from exc


# ---------------------------------------------------------------------------------------- system
@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "version": __version__}


@app.get("/api/doctor")
def get_doctor() -> dict[str, Any]:
    return doctor.report()


class SettingsBody(BaseModel):
    provider: str | None = None
    claude_command: str | None = None
    claude_model: str | None = None
    review_gates: bool | None = None


@app.get("/api/settings")
def get_settings() -> dict[str, Any]:
    return asdict(load_settings())


@app.put("/api/settings")
def put_settings(body: SettingsBody) -> dict[str, Any]:
    settings = load_settings()
    assistant = asdict(settings.assistant)
    if body.provider is not None:
        if body.provider not in ("off", "claude_code", "claude_chat"):
            raise HTTPException(400, "provider must be off, claude_code or claude_chat")
        assistant["provider"] = body.provider
    if body.claude_command:
        assistant["claude_command"] = body.claude_command
    if body.claude_model is not None:
        assistant["claude_model"] = body.claude_model or None
    rest = asdict(settings)
    if body.review_gates is not None:
        rest["review_gates"] = body.review_gates
    new = Settings(**{**rest, "assistant": AssistantSettings(**assistant)})
    new.save()
    return asdict(new)


# ---------------------------------------------------------------------------------------- catalog API
def _testable_here() -> dict[str, str | None]:
    """chip id -> None when this computer can build and emulate it, else why not (cached for a minute)."""
    global _testable
    stamp, cached = _testable
    if time.time() - stamp < TESTABLE_TTL_S and cached:
        return cached
    result = {}
    for chip in get_catalog().chips:
        signature, why = build_signature(chip)
        result[chip.id] = None if signature else why
    _testable = (time.time(), result)
    return result


@app.get("/api/catalog")
def catalog() -> dict[str, Any]:
    """Vendors, cores and chips in one call, with whether each chip can be tested on this computer."""
    cat = get_catalog()
    testable = _testable_here()
    chips = []
    for chip in cat.chips:
        core = cat.cores[chip.core]
        chips.append({**chip.model_dump(), "name": chip.name, "core_description": core.description,
                      "has_fpu": core.fpu != "none", "testable": testable.get(chip.id) is None,
                      "not_testable_reason": testable.get(chip.id)})
    vendors = [{**v.model_dump(), "chips": sum(1 for c in cat.chips if c.vendor == v.id)} for v in cat.vendors]
    return {"info": cat.info.model_dump(), "vendors": vendors, "chips": chips}


@app.get("/api/vendors")
def vendors() -> list[dict[str, Any]]:
    return [v.model_dump() for v in get_catalog().vendors]


@app.get("/api/vendors/{vendor_id}/chips")
def vendor_chips(vendor_id: str) -> list[dict[str, Any]]:
    return [c.model_dump() for c in get_catalog().query(vendor=vendor_id)]


@app.get("/api/chips")
def chips(radio: str | None = None, max_price: float | None = None, vendor: str | None = None,
          fpu: bool | None = None) -> list[dict[str, Any]]:
    return [c.model_dump() for c in get_catalog().query(vendor=vendor, radio=radio, max_price=max_price, fpu=fpu)]


@app.get("/api/chips/{chip_id}")
def chip(chip_id: str) -> dict[str, Any]:
    try:
        return get_catalog().chip(chip_id).model_dump()
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc


class ChipCheckBody(BaseModel):
    spec: dict[str, Any]


@app.post("/api/chips/check")
def chips_check(body: ChipCheckBody) -> dict[str, str | None]:
    """For a draft of the requirements: chip id -> why it would be left out before building, or None."""
    try:
        spec = ProblemSpec(**body.spec)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {c.id: pre_filter(c, spec) for c in get_catalog().chips}


@app.get("/api/recipes")
def recipes() -> list[dict[str, Any]]:
    return [r.model_dump() for r in load_recipes().values()]


# ---------------------------------------------------------------------------------------- projects
class DescribeBody(BaseModel):
    description: str
    name: str | None = None
    vendor: str | None = None


@app.get("/api/projects")
def list_projects() -> list[dict[str, Any]]:
    return _store().projects()


@app.post("/api/projects")
def create_project(body: DescribeBody) -> dict[str, Any]:
    if not body.description.strip():
        raise HTTPException(400, "Describe what the device should detect")
    return stages.describe(_store(), body.description, body.name, body.vendor)


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> dict[str, Any]:
    store = _store()
    project = _project(project_id)
    dataset = store.latest_dataset(project_id)
    training_path = project_dir(project_id, "models") / "training.json"
    preview_path = project_dir(project_id, "data") / "preview.json"
    latest: dict[tuple[str, str], dict[str, Any]] = {}
    for d in store.decisions(project_id):  # newest first
        latest.setdefault((d["decision_type"], d["decision_key"]), d)
    pending = [d for d in latest.values() if d["final_choice"] is None]
    return {
        "preview": json.loads(preview_path.read_text()) if preview_path.exists() else None,
        "pending_decisions": pending,
        "project": project,
        "chip_ids": project.get("chip_ids") or [],
        "dataset": dataset,
        "candidates": store.candidates(project_id),
        "training": json.loads(training_path.read_text()) if training_path.exists() else None,
        "chip_results": store.chip_results(project_id),
        "builds": store.builds(project_id),
        "jobs": store.jobs(project_id)[:10],
        "active_job": store.active_job(project_id),
        "reviews": review.cards(store, project_id),
        "review_gates": load_settings().review_gates,
    }


@app.patch("/api/projects/{project_id}/spec")
def patch_spec(project_id: str, changes: dict[str, Any]) -> dict[str, Any]:
    _project(project_id)
    return _stage(stages.update_spec, _store(), project_id, changes).model_dump()


class ChipsBody(BaseModel):
    chip_ids: list[str]


@app.put("/api/projects/{project_id}/chips")
def put_chips(project_id: str, body: ChipsBody) -> dict[str, Any]:
    _project(project_id)
    return {"chip_ids": _stage(stages.set_chip_shortlist, _store(), project_id, body.chip_ids)}


@app.post("/api/projects/{project_id}/datasets")
async def upload(project_id: str, files: list[UploadFile] = File(...),
                 sample_rate_hz: float | None = Form(None)) -> dict[str, Any]:
    _project(project_id)
    tmp = Path(tempfile.mkdtemp(prefix="tinyml-upload-"))
    paths = []
    try:
        for upload_file in files:
            name = Path(upload_file.filename or "data.csv").name
            if not name.lower().endswith(".csv"):
                raise HTTPException(400, f"{name} is not a CSV file")
            dest = tmp / name
            with dest.open("wb") as fh:
                shutil.copyfileobj(upload_file.file, fh)
            paths.append(dest)
        return _stage(stages.ingest, _store(), project_id, paths, sample_rate_hz)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


class DemoBody(BaseModel):
    dataset: str


@app.post("/api/projects/{project_id}/demo-data")
def demo_data(project_id: str, body: DemoBody) -> dict[str, Any]:
    _project(project_id)
    if body.dataset not in synthetic.GENERATORS:
        raise HTTPException(400, f"unknown demo dataset; choose from {list(synthetic.GENERATORS)}")
    folder = Path(tempfile.mkdtemp(prefix="tinyml-demo-"))
    path = synthetic.GENERATORS[body.dataset](folder / f"{body.dataset}_demo.csv")
    try:
        return _stage(stages.ingest, _store(), project_id, [path])
    finally:
        shutil.rmtree(folder, ignore_errors=True)


class RolesBody(BaseModel):
    roles: dict[str, str]
    normal_label: str | None = None
    sample_rate_hz: float | None = None


@app.put("/api/projects/{project_id}/datasets/roles")
def put_roles(project_id: str, body: RolesBody) -> dict[str, Any]:
    _project(project_id)
    return _stage(stages.update_roles, _store(), project_id, body.roles, body.normal_label, body.sample_rate_hz)


# ---------------------------------------------------------------------------------------- jobs
class RankBody(BaseModel):
    chips: list[str] | None = None


class BuildBody(BaseModel):
    chip_id: str


def _runner() -> JobRunner:
    assert runner is not None
    return runner


def _submit(kind: str, project_id: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
    blocked = review.gate(_store(), project_id, kind)
    if blocked:
        raise HTTPException(409, blocked)
    try:
        return _runner().submit(kind, project_id, params)
    except JobConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/api/projects/{project_id}/train")
def train(project_id: str) -> dict[str, Any]:
    _project(project_id)
    return _submit("train", project_id)


class SelectBody(BaseModel):
    candidate_id: str


@app.post("/api/projects/{project_id}/select")
def select(project_id: str, body: SelectBody) -> dict[str, Any]:
    _project(project_id)
    if not any(c["id"] == body.candidate_id for c in _store().candidates(project_id)):
        raise HTTPException(404, "candidate not found")
    return _submit("select", project_id, {"candidate_id": body.candidate_id})


@app.post("/api/projects/{project_id}/rank")
def rank(project_id: str, body: RankBody) -> dict[str, Any]:
    _project(project_id)
    return _submit("rank", project_id, {"chips": body.chips})


@app.post("/api/projects/{project_id}/build")
def build(project_id: str, body: BuildBody) -> dict[str, Any]:
    _project(project_id)
    try:
        get_catalog().chip(body.chip_id)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    return _submit("build", project_id, {"chip_id": body.chip_id})


@app.get("/api/jobs/{job_id}")
def job(job_id: str) -> dict[str, Any]:
    row = _store().job(job_id)
    if row is None:
        raise HTTPException(404, "job not found")
    return row


def _control(action: str, job_id: str) -> dict[str, Any]:
    if _store().job(job_id) is None:
        raise HTTPException(404, "job not found")
    try:
        return getattr(_runner(), action)(job_id)
    except JobConflict as exc:
        raise HTTPException(409, str(exc)) from exc


@app.post("/api/jobs/{job_id}/pause")
def pause_job(job_id: str) -> dict[str, Any]:
    return _control("pause", job_id)


@app.post("/api/jobs/{job_id}/resume")
def resume_job(job_id: str) -> dict[str, Any]:
    return _control("resume_job", job_id)


@app.post("/api/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict[str, Any]:
    return _control("cancel", job_id)


# ---------------------------------------------------------------------------------------- reviews
class ReviewBody(BaseModel):
    stage: str
    status: str
    note: str | None = None


@app.get("/api/projects/{project_id}/reviews")
def reviews(project_id: str) -> list[dict[str, Any]]:
    _project(project_id)
    return review.cards(_store(), project_id)


@app.post("/api/projects/{project_id}/reviews")
def post_review(project_id: str, body: ReviewBody) -> dict[str, Any]:
    _project(project_id)
    return _stage(review.record, _store(), project_id, body.stage, body.status, body.note)


# ---------------------------------------------------------------------------------------- builds
def _build(build_id: str) -> dict[str, Any]:
    row = _store().build(build_id)
    if row is None:
        raise HTTPException(404, "build not found")
    return row


def _package(build_id: str) -> Path:
    row = _build(build_id)
    if not row["package_path"] or not Path(row["package_path"]).exists():
        raise HTTPException(404, "this build has no package (parity failed or file removed)")
    return Path(row["package_path"])


@app.get("/api/builds/{build_id}/download")
def download(build_id: str) -> FileResponse:
    pkg = _package(build_id)
    return FileResponse(pkg, filename=pkg.name, media_type="application/zip")


@app.get("/api/builds/{build_id}/download/essentials")
def download_essentials(build_id: str) -> Response:
    name, data = essentials_zip(_package(build_id))
    return Response(data, media_type="application/zip", headers={"Content-Disposition": f'attachment; filename="{name}"'})


@app.get("/api/builds/{build_id}/report", response_class=PlainTextResponse)
def report(build_id: str) -> str:
    return read_package_file(_package(build_id), "report.md").decode()


@app.get("/api/builds/{build_id}/files")
def build_files(build_id: str) -> list[dict[str, Any]]:
    return package_files(_package(build_id))


TEXT_SUFFIXES = (".c", ".h", ".hpp", ".md", ".json", ".py", ".pem", ".txt")


@app.get("/api/builds/{build_id}/files/{name:path}")
def build_file(build_id: str, name: str, download: bool = False) -> Response:
    pkg = _package(build_id)
    try:
        data = read_package_file(pkg, name)
    except KeyError as exc:
        raise HTTPException(404, "file not in this package") from exc
    if download:
        return Response(data, media_type="application/octet-stream",
                        headers={"Content-Disposition": f'attachment; filename="{Path(name).name}"'})
    if not name.endswith(TEXT_SUFFIXES):
        return PlainTextResponse(f"{Path(name).name} is a binary file ({len(data)} bytes).")
    return PlainTextResponse(data.decode(errors="replace"))


# ---------------------------------------------------------------------------------------- assistant
class AskBody(BaseModel):
    question: str
    build_id: str | None = None
    stage: str | None = None


def _context(project_id: str) -> str:
    """What the assistant may see: the requirements and the review cards. Never raw sensor data."""
    store = _store()
    project = _project(project_id)
    lines = [f"Goal: {project['description']}", f"Requirements: {json.dumps(project['spec'])}"]
    if project.get("chip_ids"):
        lines.append(f"Chip shortlist: {', '.join(project['chip_ids'])}")
    for card in review.cards(store, project_id):
        lines.append(f"\n## {card['title']} (review: {card['status']})\n{card['headline']}")
        lines += [f"- {f['label']}: {f['value']}" + (f" [{f['tag']}]" if f.get("tag") else "") for f in card["facts"]]
        lines += [f"- check ({c['level']}): {c['text']}" for c in card["checks"]]
    candidates = store.candidates(project_id)
    if candidates:
        lines.append("\n## Models tried")
        for c in candidates:
            d = c.get("details") or {}
            lines.append(f"- {d.get('title', c['algorithm'])} ({d.get('setting', c['note'])}): "
                         f"{'meets' if c['passed'] else 'below'} target. {d.get('why', '')}")
    return "\n".join(lines)


@app.post("/api/projects/{project_id}/ask")
def ask(project_id: str, body: AskBody) -> dict[str, Any]:
    """Questions about the project or a package. Claude Code answers locally; Claude chat gets a prompt to paste."""
    store = _store()
    _project(project_id)
    if not body.question.strip():
        raise HTTPException(400, "Type a question first")
    settings = load_settings()
    builds = [b for b in store.builds(project_id) if b["package_path"]]
    if body.build_id:
        builds = [b for b in builds if b["id"] == body.build_id]
    pkg = Path(builds[0]["package_path"]) if builds and (body.build_id or body.stage == "build") else None
    prompt = (
        "You are the review assistant in a TinyML tool. A person is checking each step before continuing. "
        "Answer briefly and concretely in plain English; point out anything they should check. "
        "Only summaries are shown below, never raw sensor data.\n\n"
        f"Current step: {body.stage or 'unknown'}\nQuestion: {body.question}\n\n--- project ---\n{_context(project_id)}\n"
    )
    if pkg is not None:
        with zipfile.ZipFile(pkg) as zf:
            prompt += (f"\n--- report.md ---\n{zf.read('tinyml/report.md').decode()}\n"
                       f"\n--- tinyml_model.h ---\n{zf.read('tinyml/include/tinyml_model.h').decode()}\n")
    provider = settings.assistant.provider
    if provider == "claude_code":
        try:
            if pkg is not None:
                unpack = project_dir(project_id, "work", "ask", pkg.stem)
                with zipfile.ZipFile(pkg) as zf:
                    zf.extractall(unpack)
                answer = ClaudeCodeProvider(settings.assistant).run(
                    f"{prompt}\nThe full package is in ./tinyml (start with report.md).", cwd=str(unpack),
                    tools="Read,Grep,Glob")
            else:
                answer = ClaudeCodeProvider(settings.assistant).run(prompt)
            return {"answer": answer, "source": "claude_code"}
        except ProviderUnavailable as exc:
            return {"answer": None, "source": "unavailable", "error": str(exc), "prompt": prompt}
    if provider == "claude_chat":
        return {"answer": None, "source": "claude_chat", "prompt": prompt}
    return {"answer": None, "source": "off", "prompt": prompt,
            "message": "The assistant is off, so nothing was sent anywhere. Turn on Claude Code in Settings for "
                       "answers on this computer, or copy the prompt into Claude chat yourself."}


# ---------------------------------------------------------------------------------------- decisions
@app.get("/api/decisions")
def decisions(project_id: str | None = None) -> list[dict[str, Any]]:
    return _store().decisions(project_id)


class DecisionBody(BaseModel):
    choice: str


@app.patch("/api/decisions/{decision_id}")
def decide_override(decision_id: int, body: DecisionBody) -> dict[str, Any]:
    store = _store()
    row = store.decision(decision_id)
    if row is None:
        raise HTTPException(404, "decision not found")
    if body.choice not in row["options"]:
        raise HTTPException(400, f"choice must be one of {row['options']}")
    Decider(store, row["project_id"]).record_user_choice(decision_id, body.choice)
    return store.decision(decision_id)  # type: ignore[return-value]


@app.get("/api/learned-rules")
def learned_rules() -> list[dict[str, Any]]:
    return _store().learned_rules()


if (ui_dir() / "index.html").exists():
    app.mount("/", StaticFiles(directory=str(ui_dir()), html=True), name="ui")
else:
    @app.get("/", response_class=PlainTextResponse)
    def ui_missing() -> str:
        return ("The web app has not been built yet. Run `npm --prefix ui ci && npm --prefix ui run build`, then "
                "restart `tinyml serve`. The API is available under /api.")
