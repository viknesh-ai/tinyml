"""A small local job runner: background threads, retries for temporary failures, pause, resume and cancel.

Steps are idempotent (chip builds are cached by input hash), so re-running a job after a crash, a restart
or a pause never repeats finished work.

Pausing and cancelling are cooperative. Every stage reports progress through its `log` callback; that call
is the checkpoint where a paused job waits and a cancelled job stops. A step already running (one compiler
or emulator run) finishes first.
"""

from __future__ import annotations

import json
import threading
import time
import traceback
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from tinyml.pipeline import stages
from tinyml.store import Store
from tinyml.toolchains import TransientError

MAX_ATTEMPTS = 3
BACKOFF_S = (2, 10)
POLL_S = 0.5
ACTIVE = ("queued", "running", "pausing", "paused", "cancelling")


class JobConflict(RuntimeError):
    """A job cannot be started or changed in its current state; the message is written for the user."""


class JobRunner:
    def __init__(self, store: Store, workers: int = 2):
        self.store = store
        self.pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="tinyml-job")
        self._lock = threading.Lock()
        self._live: set[str] = set()  # jobs that have a thread working on them right now

    # --- lifecycle ---------------------------------------------------------------------
    def resume(self) -> int:
        """After a restart: re-queue interrupted jobs; paused jobs stay paused until the user resumes them."""
        rows = self.store.all("SELECT id, status FROM jobs WHERE status IN ('queued', 'running', 'pausing', 'cancelling')")
        for row in rows:
            if row["status"] == "cancelling":
                self._finish_cancel(row["id"])
                continue
            if row["status"] == "pausing":
                self.store.update_job(row["id"], status="paused", step="Paused")
                continue
            self.store.append_job_log(row["id"], "Resuming after restart")
            self.store.update_job(row["id"], status="queued")
            self._start(row["id"])
        return len(rows)

    def submit(self, kind: str, project_id: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        active = self.store.active_job(project_id)
        if active is not None:
            raise JobConflict(f"This project is already {_doing(active['kind'])} (job is {active['status']}). "
                              "Wait for it, or pause or cancel it in the assistant panel.")
        job = self.store.create_job(kind, project_id, params or {})
        self._start(job["id"])
        return job

    def pause(self, job_id: str) -> dict[str, Any]:
        job = self._job(job_id)
        if job["status"] == "queued":
            self.store.update_job(job_id, status="paused", step="Paused before it started")
            self.store.append_job_log(job_id, f"{_clock()} Paused before it started")
        elif job["status"] == "running":
            self.store.update_job(job_id, status="pausing")
            self.store.append_job_log(job_id, f"{_clock()} Pause requested; the current step finishes first")
        elif job["status"] not in ("pausing", "paused"):
            raise JobConflict(f"Only a queued or running job can be paused; this one is {job['status']}.")
        return self._job(job_id)

    def resume_job(self, job_id: str) -> dict[str, Any]:
        job = self._job(job_id)
        if job["status"] not in ("paused", "pausing"):
            raise JobConflict(f"Only a paused job can be resumed; this one is {job['status']}.")
        self.store.append_job_log(job_id, f"{_clock()} Resumed")
        with self._lock:
            live = job_id in self._live
        if live:
            self.store.update_job(job_id, status="running", step="Resumed")
        else:
            self.store.update_job(job_id, status="queued", step="Resumed")
            self._start(job_id)
        return self._job(job_id)

    def cancel(self, job_id: str) -> dict[str, Any]:
        job = self._job(job_id)
        if job["status"] not in ACTIVE:
            raise JobConflict(f"This job already ended ({job['status']}).")
        with self._lock:
            live = job_id in self._live
        if live:
            self.store.update_job(job_id, status="cancelling")
            self.store.append_job_log(job_id, f"{_clock()} Cancel requested; the current step finishes first")
        else:
            self._finish_cancel(job_id)
        return self._job(job_id)

    # --- execution ---------------------------------------------------------------------
    def _job(self, job_id: str) -> dict[str, Any]:
        job = self.store.job(job_id)
        if job is None:
            raise KeyError(job_id)
        return job

    def _start(self, job_id: str) -> None:
        self.pool.submit(self._execute, job_id)

    def _finish_cancel(self, job_id: str) -> None:
        self.store.append_job_log(job_id, f"{_clock()} Cancelled by you")
        self.store.update_job(job_id, status="cancelled", step="Cancelled", error="Cancelled by you")

    def _checkpoint(self, job_id: str) -> None:
        """Called on every log line: wait while paused, stop when cancelled."""
        while True:
            status = self._job(job_id)["status"]
            if status == "cancelling":
                raise stages.JobCancelled()
            if status == "pausing":
                with self._lock:
                    if self._job(job_id)["status"] == "pausing":
                        self.store.update_job(job_id, status="paused", step="Paused")
                        self.store.append_job_log(job_id, f"{_clock()} Paused. Press Resume to continue")
                continue
            if status != "paused":
                return
            time.sleep(POLL_S)

    def _execute(self, job_id: str) -> None:
        job = self.store.job(job_id)
        if job is None or job["status"] != "queued":
            return
        kind, project_id, params = job["kind"], job["project_id"], job["params"] or {}
        with self._lock:
            self._live.add(job_id)

        def log(message: str) -> None:
            self._checkpoint(job_id)
            self.store.append_job_log(job_id, f"{_clock()} {message}")
            self.store.update_job(job_id, step=message[:200])

        try:
            for attempt in range(1, MAX_ATTEMPTS + 1):
                self.store.update_job(job_id, status="running", attempts=job["attempts"] + attempt, error=None)
                try:
                    result = self._run(kind, project_id, params, log)
                    self.store.update_job(job_id, status="done", progress=1.0, result=_jsonable(result), step="done")
                    return
                except stages.JobCancelled:
                    self._finish_cancel(job_id)
                    return
                except TransientError as exc:
                    log(f"Temporary failure: {exc}")
                    if attempt < MAX_ATTEMPTS:
                        time.sleep(BACKOFF_S[min(attempt - 1, len(BACKOFF_S) - 1)])
                        continue
                    self.store.update_job(job_id, status="failed", error=str(exc))
                    return
                except stages.StageError as exc:
                    self.store.append_job_log(job_id, f"{_clock()} {exc}")
                    self.store.update_job(job_id, status="failed", error=str(exc))
                    return
                except Exception as exc:
                    self.store.append_job_log(job_id, f"{_clock()} Unexpected error: "
                                              + "".join(traceback.format_exception_only(type(exc), exc)).strip())
                    self.store.append_job_log(job_id, traceback.format_exc())
                    self.store.update_job(job_id, status="failed", error=str(exc))
                    return
        finally:
            with self._lock:
                self._live.discard(job_id)

    def _run(self, kind: str, project_id: str, params: dict[str, Any], log) -> dict[str, Any]:
        if kind == "train":
            return stages.train(self.store, project_id, log)
        if kind == "select":
            return stages.select_model(self.store, project_id, params["candidate_id"], log)
        if kind == "rank":
            return stages.rank_chips(self.store, project_id, params.get("chips"), log)
        if kind == "build":
            return stages.build_for_chip(self.store, project_id, params["chip_id"], log)
        raise ValueError(f"unknown job kind {kind}")

    def wait(self, job_id: str, timeout: float = 120.0) -> dict[str, Any]:
        """Block until the job ends or pauses (used by tests and the CLI)."""
        deadline = time.time() + timeout
        while time.time() < deadline:
            job = self._job(job_id)
            if job["status"] in ("done", "failed", "cancelled", "paused"):
                return job
            time.sleep(0.05)
        return self._job(job_id)


def _doing(kind: str) -> str:
    return {"train": "training", "select": "switching models", "rank": "ranking chips", "build": "building"}.get(kind, kind)


def _clock() -> str:
    return time.strftime("%H:%M:%S")


def _jsonable(value: Any) -> Any:
    return json.loads(json.dumps(value, default=str))
