"""Human-in-the-loop: pausing and cancelling jobs, review cards and gates, chip shortlist, the two downloads."""

import hashlib
import io
import json
import threading
import zipfile

import pytest
from fastapi.testclient import TestClient

from tinyml.pipeline import review, stages
from tinyml.pipeline.jobs import JobConflict, JobRunner
from tinyml.store import get_store, project_dir


class SteppingRunner(JobRunner):
    """Runs a fake stage that logs one step at a time, so tests decide when each checkpoint is reached."""

    def __init__(self, store):
        super().__init__(store)
        self.go = threading.Semaphore(0)
        self.steps_done = 0

    def _run(self, kind, project_id, params, log):
        for i in range(5):
            self.go.acquire()
            log(f"step {i}")
            self.steps_done += 1
        return {"steps": self.steps_done}


def _until(condition, timeout=10.0):
    import time

    deadline = time.time() + timeout
    while not condition():
        assert time.time() < deadline, "timed out"
        time.sleep(0.01)


def _project(store):
    return stages.describe(store, "Alert me when my pump vibration looks abnormal.")["project"]["id"]


def test_pause_waits_at_the_next_checkpoint_and_resume_continues():
    store = get_store()
    runner = SteppingRunner(store)
    job = runner.submit("train", _project(store))
    runner.go.release()
    runner.go.release()
    _until(lambda: runner.steps_done == 2)
    runner.pause(job["id"])
    for _ in range(3):
        runner.go.release()
    paused = runner.wait(job["id"], timeout=10)
    assert paused["status"] == "paused"
    done_while_paused = runner.steps_done
    assert done_while_paused < 5
    runner.resume_job(job["id"])
    finished = runner.wait(job["id"], timeout=10)
    assert finished["status"] == "done" and finished["result"]["steps"] == 5
    assert "Paused" in finished["log"] and "Resumed" in finished["log"]


def test_cancel_stops_a_paused_job_and_frees_the_project():
    store = get_store()
    runner = SteppingRunner(store)
    pid = _project(store)
    job = runner.submit("train", pid)
    runner.pause(job["id"])
    runner.go.release()
    assert runner.wait(job["id"], timeout=10)["status"] == "paused"
    with pytest.raises(JobConflict):
        runner.submit("train", pid)
    runner.cancel(job["id"])
    for _ in range(5):
        runner.go.release()
    cancelled = runner.wait(job["id"], timeout=10)
    assert cancelled["status"] == "cancelled" and runner.steps_done < 5
    assert store.active_job(pid) is None


def test_queued_job_can_be_cancelled_before_it_starts():
    store = get_store()
    runner = SteppingRunner(store)
    pid = _project(store)
    job = store.create_job("train", pid, {})
    assert runner.cancel(job["id"])["status"] == "cancelled"


def test_review_cards_and_gates(data_dir):
    store = get_store()
    pid = _project(store)
    stages.ingest(store, pid, [data_dir / "pump.csv"])
    data_card = review.cards(store, pid)[0]
    assert data_card["stage"] == "data" and data_card["status"] == "pending" and data_card["checks"]
    assert review.gate(store, pid, "train")
    review.record(store, pid, "data", "approved", None)
    assert review.gate(store, pid, "train") is None
    stages.train(store, pid)
    model_card = next(c for c in review.cards(store, pid) if c["stage"] == "model")
    assert any(f["label"] == "Faults caught" for f in model_card["facts"])
    assert review.gate(store, pid, "build")
    review.record(store, pid, "model", "changes_requested", "check the false alarms")
    assert review.gate(store, pid, "build")
    review.record(store, pid, "model", "approved", None)
    assert review.gate(store, pid, "build") is None
    stages.ingest(store, pid, [data_dir / "pump.csv"])
    assert review.gate(store, pid, "train"), "a new dataset needs a new review"


def test_chip_shortlist_follows_the_vendor():
    store = get_store()
    pid = _project(store)
    stages.update_spec(store, pid, {"vendor": "nordic"})
    with pytest.raises(stages.StageError):
        stages.set_chip_shortlist(store, pid, ["stm32f411"])
    stages.set_chip_shortlist(store, pid, ["nrf52840", "nrf54l15"])
    assert [c.id for c in stages.candidate_chips(store, pid)] == ["nrf52840", "nrf54l15"]
    stages.update_spec(store, pid, {"vendor": "st"})
    assert stages.chip_shortlist(store, pid) == []
    assert {c.vendor for c in stages.candidate_chips(store, pid)} == {"st"}


def test_api_gates_jobs_and_checks_chips():
    from tinyml.api.app import app

    with TestClient(app) as client:
        catalog = client.get("/api/catalog").json()
        assert len(catalog["vendors"]) >= 9 and all(v["chips"] for v in catalog["vendors"])
        assert all("testable" in c for c in catalog["chips"])
        pid = client.post("/api/projects", json={"description": "pump vibration abnormal, Bluetooth"}).json()["project"]["id"]
        spec = client.get(f"/api/projects/{pid}").json()["project"]["spec"]
        reasons = client.post("/api/chips/check", json={"spec": {**spec, "connectivity": "ble"}}).json()
        assert reasons["stm32f411"] == "no Bluetooth LE" and reasons["nrf52840"] is None
        client.post(f"/api/projects/{pid}/demo-data", json={"dataset": "pump"})
        blocked = client.post(f"/api/projects/{pid}/train")
        assert blocked.status_code == 409 and "Review the data checks" in blocked.json()["detail"]
        assert client.post(f"/api/projects/{pid}/reviews", json={"stage": "data", "status": "approved"}).status_code == 200
        job = client.post(f"/api/projects/{pid}/train").json()
        assert client.post(f"/api/projects/{pid}/train").status_code in (200, 409)
        assert client.post(f"/api/jobs/{job['id']}/cancel").status_code in (200, 409)
        answer = client.post(f"/api/projects/{pid}/ask", json={"question": "Is the data good enough?"}).json()
        assert answer["source"] == "off" and "pump" in answer["prompt"]


def test_essentials_download_matches_the_signed_package(data_dir):
    from tinyml.catalog import get_catalog
    from tinyml.contracts import GoldenSet
    from tinyml.packaging.package import build_package, essentials_zip, package_files

    store = get_store()
    pid = _project(store)
    stages.ingest(store, pid, [data_dir / "pump.csv"])
    stages.train(store, pid)
    models = project_dir(pid, "models")
    golden = GoldenSet.model_validate_json((models / "golden.json").read_text())
    artifact = json.loads((models / "model.json").read_text())
    pkg = build_package(project_dir(pid, "packages"), "1.0.0", "pump", get_catalog().chip("nrf52840"), models / "c",
                        artifact, golden, "# report\n", {"seed": 42})
    files = package_files(pkg)
    essential = {f["path"]: f for f in files if f["essential"]}
    assert set(essential) == {"include/tinyml_model.h", "src/tinyml_model.c"}
    assert all(f["note"] for f in files)
    name, data = essentials_zip(pkg)
    assert name.endswith("-source.zip")
    with zipfile.ZipFile(io.BytesIO(data)) as zf:
        assert sorted(zf.namelist()) == ["tinyml_model.c", "tinyml_model.h"]
        assert hashlib.sha256(zf.read("tinyml_model.c")).hexdigest() == essential["src/tinyml_model.c"]["sha256"]


def test_a_database_from_the_first_release_is_upgraded_in_place(tmp_path):
    import sqlite3

    from tinyml.store import Store

    path = tmp_path / "old.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, spec TEXT, "
                 "status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)")
    conn.execute("CREATE TABLE candidates (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, rung INTEGER NOT NULL, "
                 "algorithm TEXT NOT NULL, metrics TEXT NOT NULL, passed INTEGER NOT NULL, selected INTEGER NOT NULL "
                 "DEFAULT 0, artifact_path TEXT, note TEXT, created_at TEXT NOT NULL)")
    conn.execute("INSERT INTO projects VALUES ('prj_old', 'old', 'pump', NULL, 'described', 'x', 'x')")
    conn.commit()
    conn.close()
    store = Store(path)
    assert store.project("prj_old")["chip_ids"] is None
    store.update_project("prj_old", chip_ids=["nrf52840"])
    assert store.project("prj_old")["chip_ids"] == ["nrf52840"]
    assert store.latest_review("prj_old", "data") is None


def test_serves_the_built_web_app():
    from tinyml.api.app import app

    with TestClient(app) as client:
        page = client.get("/")
        assert page.status_code == 200 and '<div id="root">' in page.text
        script = page.text.split('src="')[1].split('"')[0]
        assert client.get(script).status_code == 200
