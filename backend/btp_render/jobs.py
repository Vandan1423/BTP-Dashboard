"""
The job table.

SQLite, because a render outlives the request that asked for it and must also
outlive the process: the service runs under tmux on the box, and if it is
restarted mid-render the job has to still exist afterwards. One file, no
server, nothing to install.

A job's fixed facts (settings, source) and its moving state (stage, progress,
per-viewpoint timings, warnings) are stored as two JSON columns. The worker is
the only writer of state; the HTTP threads only read it.
"""
from __future__ import annotations

import json
import sqlite3
import threading
import time
import uuid

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    created_at  REAL NOT NULL,
    started_at  REAL,
    finished_at REAL,
    status      TEXT NOT NULL,      -- uploading | queued | running | done | failed | cancelled
    settings    TEXT NOT NULL,      -- json, fixed at submission
    state       TEXT NOT NULL       -- json, written by the worker as the job runs
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status, created_at);
"""

FINISHED = ("done", "failed", "cancelled")


class JobStore:
    def __init__(self, path: str):
        self._lock = threading.RLock()
        self._db = sqlite3.connect(path, check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            self._db.execute("PRAGMA journal_mode=WAL")
            self._db.executescript(SCHEMA)
            self._db.commit()

    @staticmethod
    def _row(row) -> dict | None:
        if row is None:
            return None
        job = dict(row)
        job["settings"] = json.loads(job["settings"])
        job["state"] = json.loads(job["state"])
        return job

    def create(self, settings: dict, state: dict, status: str = "queued") -> dict:
        job_id = uuid.uuid4().hex[:10]
        with self._lock:
            self._db.execute(
                "INSERT INTO jobs (id, created_at, status, settings, state) VALUES (?, ?, ?, ?, ?)",
                (job_id, time.time(), status, json.dumps(settings), json.dumps(state)),
            )
            self._db.commit()
        return self.get(job_id)

    def get(self, job_id: str) -> dict | None:
        with self._lock:
            return self._row(self._db.execute("SELECT * FROM jobs WHERE id = ?", (job_id,)).fetchone())

    def list(self, limit: int = 50) -> list[dict]:
        with self._lock:
            rows = self._db.execute("SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?", (limit,)).fetchall()
        return [self._row(r) for r in rows]

    def update(self, job_id: str, **fields) -> None:
        if not fields:
            return
        if "state" in fields:
            fields["state"] = json.dumps(fields["state"])
        cols = ", ".join(f"{k} = ?" for k in fields)
        with self._lock:
            self._db.execute(f"UPDATE jobs SET {cols} WHERE id = ?", (*fields.values(), job_id))
            self._db.commit()

    def next_queued(self) -> dict | None:
        with self._lock:
            return self._row(self._db.execute(
                "SELECT * FROM jobs WHERE status = 'queued' ORDER BY created_at LIMIT 1").fetchone())

    def queue_position(self, job_id: str) -> int:
        """How many jobs are ahead of this one, including one that is running."""
        with self._lock:
            job = self._db.execute("SELECT created_at, status FROM jobs WHERE id = ?", (job_id,)).fetchone()
            if job is None or job["status"] != "queued":
                return 0
            ahead = self._db.execute(
                "SELECT COUNT(*) FROM jobs WHERE (status = 'queued' AND created_at < ?) OR status = 'running'",
                (job["created_at"],)).fetchone()[0]
        return int(ahead)

    def counts(self) -> dict:
        with self._lock:
            rows = self._db.execute("SELECT status, COUNT(*) FROM jobs GROUP BY status").fetchall()
        return {r[0]: r[1] for r in rows}

    def requeue_interrupted(self) -> list[str]:
        """A job left 'running' by a service that stopped goes back in the queue.

        Nothing is lost by that: the converted volume and any viewpoint already
        rendered are on disk, and the worker skips work whose output exists.
        """
        with self._lock:
            ids = [r[0] for r in self._db.execute("SELECT id FROM jobs WHERE status = 'running'").fetchall()]
            self._db.execute("UPDATE jobs SET status = 'queued' WHERE status = 'running'")
            # An upload that was still arriving when the service stopped has no
            # complete file behind it, and cannot be resumed.
            self._db.execute("UPDATE jobs SET status = 'cancelled' WHERE status = 'uploading'")
            self._db.commit()
        return ids

    def finished_beyond(self, keep: int) -> list[str]:
        with self._lock:
            rows = self._db.execute(
                f"SELECT id FROM jobs WHERE status IN {FINISHED} ORDER BY created_at DESC LIMIT -1 OFFSET ?",
                (keep,)).fetchall()
        return [r[0] for r in rows]

    def delete(self, job_id: str) -> None:
        with self._lock:
            self._db.execute("DELETE FROM jobs WHERE id = ?", (job_id,))
            self._db.commit()
