"""Streamlit UI for the call auditor.

Run:
    streamlit run app.py
"""

from __future__ import annotations

import io
import json
import os
import tempfile
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html import escape
from pathlib import Path

import altair as alt
import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import SQLAlchemyError

from auditor import (
    audit_one,
    clear_transcript_cache,
    find_recording_column,
    flatten_for_sheet,
    ollama_reachable,
)
from calibration import compute_metrics, disagreements, per_dimension_metrics
from rubric import AUDIT_PRESETS, RUBRIC_DIMENSIONS

load_dotenv(override=True)

# Bridge Streamlit Cloud secrets → os.environ. The rest of the app reads
# API keys via os.getenv(); Streamlit Cloud only exposes them via st.secrets,
# so without this they show as "not set". No-op locally when secrets.toml
# is absent. setdefault() means a real .env entry still wins over a secret.
try:
    for _k, _v in st.secrets.items():
        if isinstance(_v, str):
            os.environ.setdefault(_k, _v)
except (FileNotFoundError, AttributeError):
    pass

_OTIS_FAVICON = Path(__file__).parent / "assets" / "otis-favicon.svg"
_OTIS_FULL = Path(__file__).parent / "assets" / "otis.svg"

st.set_page_config(
    page_title="Otis · AI Call Auditor",
    page_icon=str(_OTIS_FAVICON) if _OTIS_FAVICON.exists() else "🦦",
    layout="wide",
    initial_sidebar_state="expanded",
)


def _otis_svg_inline() -> str:
    """Read the full Otis SVG once and return inline HTML."""
    try:
        return _OTIS_FULL.read_text(encoding="utf-8")
    except Exception:
        return "🦦"


# ---------- audit history (SQLAlchemy: SQLite locally, Postgres in cloud) ----------

_CACHE_DIR = Path(os.getenv("AUDITOR_CACHE_DIR", Path(__file__).parent / ".cache"))
_DB_PATH = _CACHE_DIR / "audits.db"
_LEGACY_JSONL_PATH = _CACHE_DIR / "history" / "audits.jsonl"

_db_init_lock = threading.Lock()
_db_initialized = False
_engine: Engine | None = None

_AUDITS_SCHEMA_STMTS = [
    """
    CREATE TABLE IF NOT EXISTS audits (
        id                       TEXT PRIMARY KEY,
        timestamp                TEXT NOT NULL,
        source                   TEXT NOT NULL,
        target                   TEXT NOT NULL,
        preset                   TEXT,
        strictness               TEXT,
        custom_focus             TEXT,
        llm_provider             TEXT,
        llm_fallback_reason      TEXT,
        overall_score            INTEGER,
        summary                  TEXT,
        scores_json              TEXT,
        strengths                TEXT,
        what_was_lacking         TEXT,
        recommendations_json     TEXT,
        transcript               TEXT
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_audits_timestamp ON audits(timestamp DESC)",
    "CREATE INDEX IF NOT EXISTS idx_audits_preset    ON audits(preset)",
    "CREATE INDEX IF NOT EXISTS idx_audits_provider  ON audits(llm_provider)",
    "CREATE INDEX IF NOT EXISTS idx_audits_score     ON audits(overall_score)",
]

_INSERT_COLS = (
    "id, timestamp, source, target, preset, strictness, custom_focus, "
    "llm_provider, llm_fallback_reason, overall_score, summary, scores_json, "
    "strengths, what_was_lacking, recommendations_json, transcript"
)
_INSERT_PARAMS = (
    ":id, :timestamp, :source, :target, :preset, :strictness, :custom_focus, "
    ":llm_provider, :llm_fallback_reason, :overall_score, :summary, "
    ":scores_json, :strengths, :what_was_lacking, :recommendations_json, "
    ":transcript"
)


def _resolve_db_url() -> str:
    """Resolve the DB URL: env / Streamlit secrets / local SQLite file."""
    url = os.getenv("DATABASE_URL", "").strip()
    if not url:
        try:
            url = str(st.secrets.get("DATABASE_URL", "") or "").strip()
        except (FileNotFoundError, AttributeError, KeyError):
            url = ""
    if not url:
        _CACHE_DIR.mkdir(parents=True, exist_ok=True)
        return f"sqlite:///{_DB_PATH}"
    # Supabase/Heroku sometimes hand out the legacy "postgres://" scheme.
    if url.startswith("postgres://"):
        url = "postgresql://" + url[len("postgres://"):]
    return url


def _get_engine() -> Engine:
    global _engine
    if _engine is None:
        _engine = create_engine(_resolve_db_url(), pool_pre_ping=True, future=True)
    return _engine


def _is_sqlite() -> bool:
    return _get_engine().url.get_backend_name() == "sqlite"


def _ensure_db() -> None:
    global _db_initialized
    if _db_initialized:
        return
    with _db_init_lock:
        if _db_initialized:
            return
        engine = _get_engine()
        with engine.begin() as conn:
            for stmt in _AUDITS_SCHEMA_STMTS:
                conn.execute(text(stmt))
            if _is_sqlite():
                conn.exec_driver_sql("PRAGMA journal_mode = WAL;")
        _migrate_legacy_jsonl()
        _db_initialized = True


def _migrate_legacy_jsonl() -> None:
    """One-time import of audits.jsonl into the DB. Renames the file afterwards
    so it isn't re-imported on the next launch. Errors are swallowed."""
    if not _LEGACY_JSONL_PATH.exists():
        return
    try:
        rows = []
        with open(_LEGACY_JSONL_PATH, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    r = json.loads(line)
                except json.JSONDecodeError:
                    continue
                rows.append(_record_to_dict(r))
        if rows:
            sql = text(
                f"INSERT INTO audits ({_INSERT_COLS}) VALUES ({_INSERT_PARAMS}) "
                "ON CONFLICT (id) DO NOTHING"
            )
            with _get_engine().begin() as conn:
                conn.execute(sql, rows)
        _LEGACY_JSONL_PATH.rename(
            _LEGACY_JSONL_PATH.with_suffix(".jsonl.migrated")
        )
    except Exception:
        pass


def _coerce_int(v):
    try:
        s = str(v).strip()
        if not s or s.lower() in ("nan", "none"):
            return None
        return int(float(s))
    except (TypeError, ValueError):
        return None


def _record_to_dict(r: dict) -> dict:
    return {
        "id": r.get("id") or (
            datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-")
            + uuid.uuid4().hex[:6]
        ),
        "timestamp": r.get("timestamp") or datetime.now(timezone.utc).isoformat(),
        "source": r.get("source", "single"),
        "target": r.get("target", ""),
        "preset": r.get("preset", ""),
        "strictness": r.get("strictness", ""),
        "custom_focus": r.get("custom_focus", ""),
        "llm_provider": r.get("llm_provider", ""),
        "llm_fallback_reason": r.get("llm_fallback_reason", ""),
        "overall_score": _coerce_int(r.get("overall_score")),
        "summary": r.get("summary", ""),
        "scores_json": json.dumps(r.get("scores", {}) or {}, ensure_ascii=False),
        "strengths": r.get("strengths", ""),
        "what_was_lacking": r.get("what_was_lacking", ""),
        "recommendations_json": json.dumps(
            r.get("improvement_recommendations", []) or [], ensure_ascii=False
        ),
        "transcript": r.get("transcript", ""),
    }


def record_audit(target: str, evaluation: dict, source: str = "single") -> None:
    """Insert one audit row. Thread-safe; never raises."""
    try:
        _ensure_db()
        record = dict(evaluation)
        record["target"] = target
        record["source"] = source
        record["id"] = (
            datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S-")
            + uuid.uuid4().hex[:6]
        )
        record["timestamp"] = datetime.now(timezone.utc).isoformat()
        sql = text(
            f"INSERT INTO audits ({_INSERT_COLS}) VALUES ({_INSERT_PARAMS})"
        )
        with _get_engine().begin() as conn:
            conn.execute(sql, _record_to_dict(record))
    except Exception:
        pass


def _build_filter_clause(
    search: str, preset: str, provider: str, min_score: int
) -> tuple:
    where, params = [], {}
    if search:
        where.append("target LIKE :search")
        params["search"] = f"%{search}%"
    if preset:
        where.append("preset = :preset")
        params["preset"] = preset
    if provider:
        where.append("llm_provider = :provider")
        params["provider"] = provider
    if min_score and min_score > 0:
        where.append("overall_score >= :min_score")
        params["min_score"] = min_score
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    return clause, params


def load_history(
    limit: int = 500,
    *,
    search: str = "",
    preset: str = "",
    provider: str = "",
    min_score: int = 0,
) -> list:
    """Newest-first audits matching the supplied filters, capped at `limit`."""
    try:
        _ensure_db()
    except Exception:
        return []
    clause, params = _build_filter_clause(search, preset, provider, min_score)
    params["limit"] = limit
    sql = text(
        "SELECT id, timestamp, source, target, preset, strictness, "
        "custom_focus, llm_provider, llm_fallback_reason, overall_score, "
        "summary, scores_json, strengths, what_was_lacking, "
        "recommendations_json, transcript FROM audits"
        f"{clause} ORDER BY timestamp DESC LIMIT :limit"
    )
    try:
        with _get_engine().connect() as conn:
            rows = conn.execute(sql, params).mappings().all()
    except SQLAlchemyError:
        return []
    out = []
    for row in rows:
        d = dict(row)
        try:
            d["scores"] = json.loads(d.pop("scores_json") or "{}")
        except json.JSONDecodeError:
            d["scores"] = {}
        try:
            d["improvement_recommendations"] = json.loads(
                d.pop("recommendations_json") or "[]"
            )
        except json.JSONDecodeError:
            d["improvement_recommendations"] = []
        out.append(d)
    return out


def history_stats(
    *, search: str = "", preset: str = "", provider: str = "", min_score: int = 0
) -> dict:
    """Aggregate counts/avg pushed down to SQL."""
    try:
        _ensure_db()
    except Exception:
        return {"total": 0, "matching": 0, "avg_score": None}
    clause, params = _build_filter_clause(search, preset, provider, min_score)
    try:
        with _get_engine().connect() as conn:
            total = conn.execute(text("SELECT COUNT(*) FROM audits")).scalar() or 0
            matching = conn.execute(
                text(f"SELECT COUNT(*) FROM audits{clause}"), params
            ).scalar() or 0
            if clause:
                avg_sql = text(
                    f"SELECT AVG(overall_score) FROM audits{clause} "
                    "AND overall_score IS NOT NULL"
                )
            else:
                avg_sql = text(
                    "SELECT AVG(overall_score) FROM audits "
                    "WHERE overall_score IS NOT NULL"
                )
            avg = conn.execute(avg_sql, params).scalar()
    except SQLAlchemyError:
        return {"total": 0, "matching": 0, "avg_score": None}
    return {"total": total, "matching": matching, "avg_score": avg}


def history_distinct(field: str) -> list:
    """Distinct non-empty values of `field`. Whitelist guards SQL injection."""
    if field not in ("preset", "llm_provider", "source", "strictness"):
        return []
    try:
        _ensure_db()
        with _get_engine().connect() as conn:
            rows = conn.execute(text(
                f"SELECT DISTINCT {field} FROM audits "
                f"WHERE {field} IS NOT NULL AND {field} != '' ORDER BY {field}"
            )).all()
        return [r[0] for r in rows]
    except SQLAlchemyError:
        return []


def clear_history() -> bool:
    """Delete every row from the audits table."""
    try:
        _ensure_db()
        with _get_engine().begin() as conn:
            conn.execute(text("DELETE FROM audits"))
        return True
    except SQLAlchemyError:
        return False


def db_status() -> dict:
    """Sidebar diagnostic. Says which backend is in use and whether the
    schema-init path succeeds. Returns a dict for the sidebar to render."""
    backend = "unknown"
    connected = False
    error = None
    rows = None
    try:
        backend = _get_engine().url.get_backend_name()
        _ensure_db()
        with _get_engine().connect() as conn:
            rows = conn.execute(text("SELECT COUNT(*) FROM audits")).scalar()
        connected = True
    except Exception as exc:
        error = f"{type(exc).__name__}: {exc}"[:200]
    return {"backend": backend, "connected": connected, "error": error, "rows": rows}


# ---------- styling ----------


CUSTOM_CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

html, body, [class*="css"] {
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
}

/* Force deep dark canvas — no more washed-out white */
.stApp {
    background: radial-gradient(ellipse at 20% 10%, #1a0d3a 0%, #0a0612 60%) !important;
    color: #f5f3ff;
}
[data-testid="stHeader"] { background: transparent !important; }
.main { background: transparent !important; }

@keyframes fadeInUp {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}
@keyframes slideInLeft {
    from { opacity: 0; transform: translateX(-16px); }
    to { opacity: 1; transform: translateX(0); }
}
@keyframes shimmer {
    0% { background-position: -1000px 0; }
    100% { background-position: 1000px 0; }
}
@keyframes pulseGlow {
    0%, 100% { box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4); }
    50% { box-shadow: 0 0 0 12px rgba(99, 102, 241, 0); }
}
@keyframes pulseDot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.7; transform: scale(1.15); }
}
@keyframes drawCircle {
    from { stroke-dashoffset: 314; }
}
@keyframes float {
    0%, 100% { transform: translateY(0px); }
    50% { transform: translateY(-6px); }
}
@keyframes auroraDrift1 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    33% { transform: translate(8vw, -6vh) scale(1.15); }
    66% { transform: translate(-6vw, 8vh) scale(0.9); }
}
@keyframes auroraDrift2 {
    0%, 100% { transform: translate(0, 0) scale(1.1); }
    50% { transform: translate(-10vw, 6vh) scale(0.85); }
}
@keyframes auroraDrift3 {
    0%, 100% { transform: translate(0, 0) scale(1); }
    40% { transform: translate(6vw, 10vh) scale(1.2); }
    80% { transform: translate(-4vw, -4vh) scale(0.95); }
}
@keyframes rotateGradient {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
}
@keyframes scaleIn {
    from { opacity: 0; transform: scale(0.5); }
    to { opacity: 1; transform: scale(1); }
}
@keyframes glowPulse {
    0%, 100% {
        box-shadow:
            0 0 24px rgba(99,102,241,0.35),
            0 0 48px rgba(168,85,247,0.18);
    }
    50% {
        box-shadow:
            0 0 36px rgba(168,85,247,0.55),
            0 0 72px rgba(236,72,153,0.28);
    }
}
@keyframes confettiFall {
    0% { transform: translateY(-20vh) rotate(0deg); opacity: 1; }
    100% { transform: translateY(120vh) rotate(720deg); opacity: 0; }
}
@keyframes wave {
    0%, 100% { transform: scaleY(0.4); }
    50% { transform: scaleY(1); }
}
@keyframes pipelineBar {
    0% { transform: scaleY(0.3); }
    50% { transform: scaleY(1); }
    100% { transform: scaleY(0.3); }
}
@keyframes typewriter {
    from { width: 0; }
    to { width: 100%; }
}
@keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
}

/* Vivid neon aurora — bold, saturated, alive */
.stApp::before {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background:
        radial-gradient(45vw 45vh at 12% 18%, rgba(236,72,153,0.45), transparent 60%),
        radial-gradient(50vw 50vh at 88% 12%, rgba(168,85,247,0.42), transparent 60%),
        radial-gradient(55vw 55vh at 75% 88%, rgba(6,182,212,0.38), transparent 60%),
        radial-gradient(40vw 40vh at 22% 82%, rgba(245,158,11,0.28), transparent 60%);
    filter: blur(60px) saturate(1.3);
    animation: auroraDrift1 26s ease-in-out infinite;
    opacity: 0.85;
}
.stApp::after {
    content: "";
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 0;
    background:
        radial-gradient(35vw 35vh at 55% 35%, rgba(132,204,22,0.22), transparent 60%),
        radial-gradient(30vw 30vh at 35% 65%, rgba(99,102,241,0.32), transparent 60%);
    filter: blur(70px) saturate(1.4);
    animation: auroraDrift2 32s ease-in-out infinite;
    opacity: 0.9;
}
.block-container {
    position: relative;
    z-index: 1;
}

/* Custom scrollbar */
::-webkit-scrollbar { width: 12px; height: 12px; }
::-webkit-scrollbar-track { background: rgba(15,23,42,0.2); }
::-webkit-scrollbar-thumb {
    background: linear-gradient(180deg, rgba(99,102,241,0.6), rgba(168,85,247,0.6));
    border-radius: 12px;
    border: 3px solid transparent;
    background-clip: padding-box;
}
::-webkit-scrollbar-thumb:hover {
    background: linear-gradient(180deg, rgba(99,102,241,0.9), rgba(236,72,153,0.9));
    background-clip: padding-box;
    border: 3px solid transparent;
}

/* Hero */
.hero {
    position: relative;
    border-radius: 20px;
    padding: 32px 36px;
    margin-bottom: 24px;
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.15) 0%, rgba(168, 85, 247, 0.12) 50%, rgba(236, 72, 153, 0.10) 100%);
    border: 1px solid rgba(148, 163, 184, 0.18);
    overflow: hidden;
    animation: fadeInUp 0.6s ease both;
}
.hero::before {
    content: "";
    position: absolute;
    inset: 0;
    background: radial-gradient(circle at top right, rgba(99, 102, 241, 0.18), transparent 50%);
    pointer-events: none;
}
.hero-title {
    font-size: 2.4em;
    font-weight: 800;
    letter-spacing: -0.02em;
    margin: 0;
    background: linear-gradient(135deg, #6366f1 0%, #a855f7 50%, #ec4899 100%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    line-height: 1.1;
}
.hero-sub {
    margin-top: 8px;
    font-size: 1.05em;
    opacity: 0.75;
    font-weight: 400;
}
.hero-icon {
    display: inline-block;
    font-size: 2em;
    margin-right: 10px;
    animation: float 4s ease-in-out infinite;
}
.hero-icon-otis {
    width: 64px;
    height: 64px;
    font-size: 1em;
    flex-shrink: 0;
    filter: drop-shadow(0 4px 14px rgba(168,85,247,0.55));
}
.hero-icon-otis svg {
    width: 100%;
    height: 100%;
    display: block;
}

/* Status pills row */
.status-row {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
}
.status-pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 14px;
    border-radius: 999px;
    background: rgba(15, 23, 42, 0.35);
    border: 1px solid rgba(148, 163, 184, 0.25);
    font-size: 0.85em;
    font-weight: 500;
    backdrop-filter: blur(8px);
}
.status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    display: inline-block;
}
.status-dot.ok {
    background: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
    animation: pulseDot 2s ease-in-out infinite;
}
.status-dot.warn {
    background: #f59e0b;
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
}
.status-dot.miss {
    background: #ef4444;
}

/* Tabs */
.stTabs [data-baseweb="tab-list"] {
    gap: 6px;
    border-bottom: none;
    padding-bottom: 4px;
}
.stTabs [data-baseweb="tab"] {
    height: 44px;
    padding: 0 22px;
    border-radius: 10px 10px 0 0;
    background: transparent;
    border: 1px solid transparent;
    font-weight: 500;
    transition: all 0.2s ease;
}
.stTabs [data-baseweb="tab"]:hover {
    background: rgba(99, 102, 241, 0.08);
}
.stTabs [aria-selected="true"] {
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.18), rgba(168, 85, 247, 0.12)) !important;
    border-color: rgba(99, 102, 241, 0.3) !important;
    color: inherit !important;
}

/* Section cards */
.card {
    background: rgba(20, 16, 43, 0.55);
    border: 1px solid rgba(168, 85, 247, 0.18);
    border-radius: 14px;
    padding: 20px 22px;
    margin: 8px 0 16px;
    backdrop-filter: blur(8px);
    transition: all 0.25s ease;
    animation: fadeInUp 0.5s ease both;
}
.card:hover {
    border-color: rgba(99, 102, 241, 0.35);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
}
.card-title {
    font-size: 0.78em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.6;
    margin-bottom: 8px;
}

/* Onboarding steps */
.step-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 14px;
    margin: 18px 0 8px;
}
.step {
    background: rgba(99, 102, 241, 0.06);
    border: 1px solid rgba(99, 102, 241, 0.18);
    border-radius: 14px;
    padding: 18px 18px;
    position: relative;
    transition: all 0.25s ease;
    animation: fadeInUp 0.5s ease both;
}
.step:nth-child(1) { animation-delay: 0.05s; }
.step:nth-child(2) { animation-delay: 0.12s; }
.step:nth-child(3) { animation-delay: 0.19s; }
.step:hover {
    transform: translateY(-3px);
    border-color: rgba(99, 102, 241, 0.5);
    background: rgba(99, 102, 241, 0.1);
}
.step-num {
    position: absolute;
    top: -10px;
    left: 14px;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: linear-gradient(135deg, #6366f1, #a855f7);
    color: white;
    font-weight: 700;
    font-size: 0.85em;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 10px rgba(99, 102, 241, 0.4);
}
.step-title {
    font-weight: 600;
    margin: 6px 0 4px;
    font-size: 1.02em;
}
.step-body {
    font-size: 0.88em;
    opacity: 0.75;
    line-height: 1.45;
}
.step.done .step-num {
    background: linear-gradient(135deg, #10b981, #059669);
}
.step.done {
    border-color: rgba(16, 185, 129, 0.4);
    background: rgba(16, 185, 129, 0.06);
}

/* Buttons */
.stButton > button[kind="primary"] {
    background: linear-gradient(135deg, #6366f1 0%, #a855f7 100%);
    border: none;
    font-weight: 600;
    letter-spacing: 0.01em;
    transition: all 0.2s ease;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
}
.stButton > button[kind="primary"]:hover:not(:disabled) {
    transform: translateY(-1px);
    box-shadow: 0 6px 20px rgba(99, 102, 241, 0.5);
}
.stButton > button[kind="primary"]:active:not(:disabled) {
    transform: translateY(0);
}
.stButton > button[kind="primary"]:not(:disabled) {
    animation: pulseGlow 2.4s ease-in-out infinite;
}

/* File uploader */
[data-testid="stFileUploader"] section {
    border: 2px dashed rgba(99, 102, 241, 0.35);
    border-radius: 14px;
    background: rgba(99, 102, 241, 0.04);
    transition: all 0.2s ease;
}
[data-testid="stFileUploader"] section:hover {
    border-color: rgba(99, 102, 241, 0.65);
    background: rgba(99, 102, 241, 0.08);
}

/* Score ring */
.score-ring-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 6px;
}
.score-ring {
    position: relative;
    width: 130px;
    height: 130px;
}
.score-ring svg { transform: rotate(-90deg); }
.score-ring circle {
    fill: none;
    stroke-width: 10;
    stroke-linecap: round;
}
.score-ring .track {
    stroke: rgba(148, 163, 184, 0.15);
}
.score-ring .progress {
    stroke-dasharray: 314;
    animation: drawCircle 1.1s cubic-bezier(0.65, 0, 0.35, 1) both;
    transition: stroke-dashoffset 0.6s ease;
}
.score-ring-center {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.8s ease 0.4s both;
}
.score-ring-num {
    font-size: 2.6em;
    font-weight: 800;
    line-height: 1;
    letter-spacing: -0.03em;
}
.score-ring-label {
    font-size: 0.7em;
    opacity: 0.6;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-top: 4px;
}
.score-ring-caption {
    margin-top: 8px;
    font-weight: 600;
    font-size: 0.95em;
}

/* Dimension cards (replaces table) */
.dim-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 12px;
    margin-top: 12px;
}
.dim-card {
    background: rgba(20, 16, 43, 0.55);
    border: 1px solid rgba(168, 85, 247, 0.15);
    border-left: 4px solid var(--score-color, #9ca3af);
    border-radius: 10px;
    padding: 14px 16px;
    transition: all 0.2s ease;
    animation: slideInLeft 0.4s ease both;
}
.dim-card:hover {
    transform: translateX(2px);
    border-color: rgba(99, 102, 241, 0.3);
    border-left-color: var(--score-color, #9ca3af);
}
.dim-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
}
.dim-name {
    font-weight: 600;
    font-size: 0.98em;
}
.dim-key {
    font-size: 0.75em;
    opacity: 0.5;
    font-family: 'SF Mono', Monaco, monospace;
}
.dim-rationale {
    font-size: 0.88em;
    opacity: 0.78;
    line-height: 1.5;
    margin-top: 4px;
}

/* Score badges */
.score-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    color: white;
    font-weight: 700;
    font-size: 0.95em;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

/* Sidebar */
section[data-testid="stSidebar"] {
    border-right: 1px solid rgba(148, 163, 184, 0.12);
}
section[data-testid="stSidebar"] .api-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    border-radius: 8px;
    margin-bottom: 4px;
    font-size: 0.9em;
    background: rgba(148, 163, 184, 0.05);
    border: 1px solid rgba(148, 163, 184, 0.1);
}
.api-row .api-name { font-weight: 500; }
.api-row .api-status {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.85em;
    opacity: 0.85;
}

/* Recommendations */
.rec-list {
    list-style: none;
    padding: 0;
    margin: 8px 0;
}
.rec-item {
    display: flex;
    gap: 12px;
    padding: 10px 14px;
    margin-bottom: 8px;
    background: rgba(99, 102, 241, 0.06);
    border-left: 3px solid #6366f1;
    border-radius: 6px;
    font-size: 0.95em;
    line-height: 1.5;
    animation: slideInLeft 0.4s ease both;
}
.rec-item::before {
    content: "→";
    color: #6366f1;
    font-weight: 700;
    flex-shrink: 0;
}

/* Strengths / Lacking blocks */
.split-block {
    padding: 16px 18px;
    border-radius: 12px;
    height: 100%;
    line-height: 1.55;
    animation: fadeInUp 0.5s ease both;
}
.split-block.good {
    background: linear-gradient(135deg, rgba(16, 185, 129, 0.08), rgba(16, 185, 129, 0.03));
    border: 1px solid rgba(16, 185, 129, 0.25);
    border-left: 4px solid #10b981;
}
.split-block.bad {
    background: linear-gradient(135deg, rgba(239, 68, 68, 0.08), rgba(239, 68, 68, 0.03));
    border: 1px solid rgba(239, 68, 68, 0.25);
    border-left: 4px solid #ef4444;
}
.split-head {
    font-size: 0.75em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    margin-bottom: 8px;
    opacity: 0.8;
}

/* Metric cards */
.metric-card {
    background: linear-gradient(135deg, rgba(168,85,247,0.18), rgba(236,72,153,0.10));
    border: 1px solid rgba(168, 85, 247, 0.30);
    border-radius: 14px;
    padding: 18px 20px;
    text-align: center;
    transition: all 0.25s ease;
    animation: fadeInUp 0.5s ease both;
}
.metric-card:hover {
    transform: translateY(-3px);
    border-color: rgba(99, 102, 241, 0.4);
}
.metric-card.ok { border-left: 4px solid #10b981; }
.metric-card.err { border-left: 4px solid #ef4444; }
.metric-card.skip { border-left: 4px solid #f59e0b; }
.metric-num {
    font-size: 2.1em;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.1;
}
.metric-label {
    font-size: 0.78em;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.65;
    margin-top: 4px;
    font-weight: 600;
}

/* Rubric cards */
.rubric-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
    gap: 14px;
    margin-top: 12px;
}
.rubric-card {
    padding: 18px 20px;
    border-radius: 14px;
    background: rgba(20, 16, 43, 0.55);
    border: 1px solid rgba(168, 85, 247, 0.18);
    transition: all 0.25s ease;
    animation: fadeInUp 0.5s ease both;
}
.rubric-card:hover {
    transform: translateY(-3px);
    border-color: rgba(99, 102, 241, 0.4);
    background: rgba(99, 102, 241, 0.05);
}
.rubric-name {
    font-weight: 700;
    font-size: 1.05em;
    margin-bottom: 4px;
}
.rubric-key {
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.75em;
    opacity: 0.55;
    margin-bottom: 10px;
    display: block;
}
.rubric-criteria {
    font-size: 0.92em;
    opacity: 0.82;
    line-height: 1.55;
}

/* Hide Streamlit default header padding */
.block-container {
    padding-top: 1.6rem;
}

/* Progress bar */
.stProgress > div > div > div {
    background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899);
    background-size: 200% 100%;
    animation: shimmer 2s linear infinite;
}

/* Tweak default headings inside sections */
.section-head {
    font-size: 0.78em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    opacity: 0.7;
    margin: 18px 0 10px;
    background: linear-gradient(90deg, #6366f1, #a855f7, #ec4899);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    display: inline-block;
}

/* Rotating gradient border on hero */
.hero {
    box-shadow:
        0 4px 24px rgba(15,23,42,0.25),
        0 0 0 1px rgba(99,102,241,0.18);
}
.hero::after {
    content: "";
    position: absolute;
    inset: -2px;
    border-radius: 22px;
    padding: 2px;
    background: conic-gradient(from 0deg,
        rgba(99,102,241,0.5),
        rgba(168,85,247,0.5),
        rgba(236,72,153,0.5),
        rgba(20,184,166,0.5),
        rgba(99,102,241,0.5));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    animation: rotateGradient 12s linear infinite;
    opacity: 0.6;
    pointer-events: none;
}

/* Hero icon — bigger, glowing */
.hero-icon {
    filter: drop-shadow(0 0 12px rgba(168,85,247,0.6));
}

/* Score ring — extra glow + scale-in */
.score-ring {
    animation: scaleIn 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
.score-ring-num {
    text-shadow: 0 0 20px currentColor;
    animation: scaleIn 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s both;
}

/* Primary button — animated gradient + extra glow */
.stButton > button[kind="primary"] {
    background-size: 200% 100%;
    background-position: 0 0;
    animation: shimmer 4s linear infinite, pulseGlow 2.4s ease-in-out infinite;
    background-image: linear-gradient(90deg,
        #6366f1 0%,
        #a855f7 25%,
        #ec4899 50%,
        #a855f7 75%,
        #6366f1 100%);
}

/* Confetti burst (renders once on completion) */
.confetti-host {
    position: fixed;
    inset: 0;
    pointer-events: none;
    z-index: 9999;
    overflow: hidden;
}
.confetti-piece {
    position: absolute;
    top: -20px;
    width: 10px;
    height: 14px;
    border-radius: 2px;
    animation: confettiFall 2.4s cubic-bezier(0.2, 0.6, 0.4, 1) forwards;
}

/* Audit pipeline animation (during spinner) */
.pipeline {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 18px;
    flex-wrap: wrap;
    padding: 28px 24px;
    background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(168,85,247,0.05));
    border: 1px solid rgba(99,102,241,0.25);
    border-radius: 16px;
    margin: 14px 0;
    animation: glowPulse 3s ease-in-out infinite;
}
.pipeline-stage {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    background: rgba(15,23,42,0.3);
    border-radius: 12px;
    border: 1px solid rgba(148,163,184,0.18);
    font-size: 0.92em;
    font-weight: 500;
    transition: all 0.3s ease;
}
.pipeline-stage.active {
    background: linear-gradient(135deg, rgba(99,102,241,0.25), rgba(168,85,247,0.15));
    border-color: rgba(99,102,241,0.55);
    transform: scale(1.05);
}
.pipeline-bars {
    display: inline-flex;
    align-items: end;
    gap: 3px;
    height: 18px;
}
.pipeline-bars span {
    display: inline-block;
    width: 3px;
    height: 100%;
    background: linear-gradient(180deg, #6366f1, #a855f7);
    border-radius: 2px;
    transform-origin: bottom;
    animation: pipelineBar 0.9s ease-in-out infinite;
}
.pipeline-bars span:nth-child(1) { animation-delay: 0s; }
.pipeline-bars span:nth-child(2) { animation-delay: 0.1s; }
.pipeline-bars span:nth-child(3) { animation-delay: 0.2s; }
.pipeline-bars span:nth-child(4) { animation-delay: 0.3s; }
.pipeline-bars span:nth-child(5) { animation-delay: 0.4s; }
.pipeline-arrow {
    color: rgba(148,163,184,0.5);
    font-weight: 700;
}

/* Audio waveform bars (when file uploaded) */
.waveform {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    height: 22px;
    margin-right: 10px;
    vertical-align: middle;
}
.waveform span {
    width: 3px;
    background: linear-gradient(180deg, #10b981, #14b8a6);
    border-radius: 2px;
    transform-origin: center;
    animation: wave 1.1s ease-in-out infinite;
}
.waveform span:nth-child(1) { height: 30%; animation-delay: 0s; }
.waveform span:nth-child(2) { height: 60%; animation-delay: 0.1s; }
.waveform span:nth-child(3) { height: 100%; animation-delay: 0.2s; }
.waveform span:nth-child(4) { height: 75%; animation-delay: 0.3s; }
.waveform span:nth-child(5) { height: 45%; animation-delay: 0.4s; }
.waveform span:nth-child(6) { height: 80%; animation-delay: 0.5s; }
.waveform span:nth-child(7) { height: 35%; animation-delay: 0.6s; }

/* Tab themed accents — each tab tints its accent */
.stTabs [data-baseweb="tab-panel"]:nth-of-type(1) { --accent: #6366f1; }
.stTabs [data-baseweb="tab-panel"]:nth-of-type(2) { --accent: #a855f7; }
.stTabs [data-baseweb="tab-panel"]:nth-of-type(3) { --accent: #14b8a6; }
.stTabs [data-baseweb="tab-panel"]:nth-of-type(4) { --accent: #f59e0b; }

/* More vivid metric-card hover */
.metric-card {
    position: relative;
    overflow: hidden;
}
.metric-card::after {
    content: "";
    position: absolute;
    inset: -2px;
    border-radius: 14px;
    padding: 2px;
    background: conic-gradient(from var(--bg-rotate, 0deg),
        rgba(99,102,241,0),
        rgba(99,102,241,0.55),
        rgba(168,85,247,0.55),
        rgba(99,102,241,0));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    opacity: 0;
    transition: opacity 0.25s;
    pointer-events: none;
}
.metric-card:hover::after { opacity: 1; }
.metric-num {
    background: linear-gradient(135deg, #818cf8, #c084fc, #f472b6);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}

/* Score badges — soft glow */
.score-badge { box-shadow: 0 2px 12px var(--badge-glow, rgba(0,0,0,0.2)), 0 0 0 1px rgba(255,255,255,0.08) inset; }

/* Step cards extra polish */
.step.done {
    box-shadow: 0 0 0 1px rgba(16,185,129,0.4), 0 4px 16px rgba(16,185,129,0.15);
}

/* Active preset card extra glow */
.rubric-card[data-active="true"] {
    box-shadow: 0 0 0 1px rgba(99,102,241,0.6), 0 8px 32px rgba(99,102,241,0.25);
}

/* Status pill — gradient border on focus pill */
.status-pill.focus {
    background: linear-gradient(135deg, rgba(99,102,241,0.22), rgba(168,85,247,0.18)) !important;
    border-color: rgba(99,102,241,0.55) !important;
    color: #ffffff;
}

/* Make Streamlit's text inputs / radios slightly more colorful on focus */
[data-baseweb="input"]:focus-within,
[data-baseweb="textarea"]:focus-within {
    box-shadow: 0 0 0 2px rgba(99,102,241,0.4) !important;
}

/* Sidebar header gradient */
section[data-testid="stSidebar"] {
    background: linear-gradient(180deg, rgba(15,23,42,0.45), rgba(15,23,42,0.15)) !important;
    backdrop-filter: blur(12px);
}

/* Animated link in caption */
a {
    background: linear-gradient(90deg, #ec4899, #06b6d4);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    text-decoration: none;
    font-weight: 600;
}
a:hover { text-decoration: underline; text-decoration-color: #ec4899; }

/* ============================================ */
/* ============== LANDING PAGE ================ */
/* ============================================ */

@keyframes orbPulse {
    0%, 100% { transform: scale(1); filter: blur(8px) brightness(1); }
    50% { transform: scale(1.12); filter: blur(10px) brightness(1.25); }
}
@keyframes ringSpin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
}
@keyframes ringSpinReverse {
    from { transform: rotate(360deg); }
    to { transform: rotate(0deg); }
}
@keyframes drawUnderline {
    from { transform: scaleX(0); }
    to { transform: scaleX(1); }
}
@keyframes headlineSlide {
    from { opacity: 0; transform: translateY(28px); }
    to { opacity: 1; transform: translateY(0); }
}
@keyframes subFade {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 0.85; transform: translateY(0); }
}
@keyframes pillsFade {
    from { opacity: 0; }
    to { opacity: 0.9; }
}
@keyframes orbFloat {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
}

.landing-stage {
    position: relative;
    min-height: calc(100vh - 80px);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 20px 16px 60px;
    z-index: 2;
}

.landing-orb {
    position: relative;
    width: 220px;
    height: 220px;
    margin-bottom: 36px;
    animation: orbFloat 5s ease-in-out infinite;
}
.landing-orb-otis {
    width: 260px;
    height: 260px;
}
.otis-mascot {
    position: absolute;
    inset: 12px;
    z-index: 3;
    filter: drop-shadow(0 8px 24px rgba(168,85,247,0.55))
            drop-shadow(0 4px 16px rgba(236,72,153,0.35));
    animation: orbFloat 5s ease-in-out infinite;
}
.otis-mascot svg {
    width: 100%;
    height: 100%;
    display: block;
}
.otis-mascot svg ellipse[fill="#1f1233"] { transition: rx 0.2s; }
/* tiny blink: cycle eye height every ~6s for life */
@keyframes otisBlink {
    0%, 92%, 100% { transform: scaleY(1); }
    96% { transform: scaleY(0.1); }
}
.otis-mascot svg > ellipse:nth-of-type(7),
.otis-mascot svg > ellipse:nth-of-type(8) {
    transform-origin: center;
    transform-box: fill-box;
    animation: otisBlink 5.5s ease-in-out infinite;
}
.landing-orb .orb-core {
    position: absolute;
    inset: 30px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%,
        #fce7f3 0%,
        #f472b6 25%,
        #a855f7 55%,
        #6366f1 80%,
        transparent 90%);
    filter: blur(8px);
    animation: orbPulse 3s ease-in-out infinite;
}
.landing-orb .orb-ring-outer,
.landing-orb .orb-ring-inner {
    position: absolute;
    border-radius: 50%;
    border: 2px solid transparent;
    pointer-events: none;
}
.landing-orb .orb-ring-outer {
    inset: -10px;
    background: conic-gradient(from 0deg,
        #06b6d4 0deg,
        #a855f7 90deg,
        #ec4899 180deg,
        #f59e0b 270deg,
        #06b6d4 360deg);
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    padding: 2px;
    animation: ringSpin 8s linear infinite;
}
.landing-orb .orb-ring-inner {
    inset: 10px;
    background: conic-gradient(from 90deg,
        rgba(236,72,153,0.0),
        rgba(236,72,153,0.8),
        rgba(168,85,247,0.0),
        rgba(6,182,212,0.8),
        rgba(236,72,153,0.0));
    -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
    -webkit-mask-composite: xor;
    mask-composite: exclude;
    padding: 2px;
    animation: ringSpinReverse 6s linear infinite;
}
.landing-orb .orb-icon {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 4.2em;
    z-index: 2;
    filter: drop-shadow(0 0 24px rgba(236,72,153,0.7));
}

.landing-eyebrow {
    font-size: 0.78em;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.32em;
    background: linear-gradient(90deg, #ec4899, #06b6d4);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    margin-bottom: 14px;
    animation: headlineSlide 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.1s both;
}

.landing-headline {
    font-size: clamp(2.4em, 6.5vw, 4.6em);
    font-weight: 800;
    letter-spacing: -0.035em;
    line-height: 1.02;
    margin: 0 0 22px;
    color: #ffffff;
    animation: headlineSlide 0.7s cubic-bezier(0.34, 1.56, 0.64, 1) 0.25s both;
    max-width: 14ch;
}
.landing-headline .highlight {
    background: linear-gradient(90deg, #f59e0b, #ec4899 50%, #a855f7);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
    position: relative;
    display: inline-block;
}
.landing-headline .highlight::after {
    content: "";
    position: absolute;
    left: 0;
    bottom: -2px;
    width: 100%;
    height: 5px;
    background: linear-gradient(90deg, #f59e0b, #ec4899, #a855f7);
    border-radius: 3px;
    box-shadow: 0 0 18px rgba(236,72,153,0.6);
    transform: scaleX(0);
    transform-origin: left;
    animation: drawUnderline 1s cubic-bezier(0.65, 0, 0.35, 1) 1.0s forwards;
}

.landing-sub {
    font-size: clamp(1em, 1.7vw, 1.2em);
    color: #d8b4fe;
    opacity: 0;
    max-width: 620px;
    margin: 0 auto 38px;
    line-height: 1.6;
    font-weight: 400;
    animation: subFade 0.6s ease-out 0.5s forwards;
}

/* Anchor used to scope styles to the CTA streamlit button only */
.landing-cta-zone {
    width: 0;
    height: 0;
    margin: 0 auto;
    animation: pillsFade 0.6s ease-out 0.7s both;
}
.landing-cta-zone + div [data-testid="stButton"] > button {
    font-size: 1.18em !important;
    font-weight: 700 !important;
    padding: 18px 44px !important;
    border-radius: 999px !important;
    letter-spacing: 0.01em;
    background: linear-gradient(90deg,
        #ec4899 0%,
        #a855f7 30%,
        #6366f1 60%,
        #06b6d4 100%) !important;
    background-size: 250% 100% !important;
    animation: shimmer 5s linear infinite, glowPulse 2s ease-in-out infinite !important;
    box-shadow:
        0 0 32px rgba(236,72,153,0.55),
        0 0 64px rgba(168,85,247,0.3) !important;
    border: none !important;
    color: white !important;
}
.landing-cta-zone + div [data-testid="stButton"] > button:hover:not(:disabled) {
    transform: translateY(-3px) scale(1.04) !important;
    box-shadow:
        0 0 48px rgba(236,72,153,0.75),
        0 0 96px rgba(168,85,247,0.5) !important;
}

.landing-pills {
    margin-top: 36px;
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    justify-content: center;
    opacity: 0;
    animation: pillsFade 0.6s ease-out 1.1s forwards;
}
.landing-pills span {
    padding: 7px 16px;
    border-radius: 999px;
    background: rgba(168,85,247,0.10);
    border: 1px solid rgba(168,85,247,0.32);
    font-size: 0.85em;
    font-weight: 500;
    color: #e9d5ff;
    backdrop-filter: blur(4px);
}

.landing-stat-row {
    margin-top: 56px;
    display: flex;
    gap: 32px;
    flex-wrap: wrap;
    justify-content: center;
    opacity: 0;
    animation: pillsFade 0.7s ease-out 1.3s forwards;
}
.landing-stat {
    text-align: center;
}
.landing-stat-num {
    font-size: 2em;
    font-weight: 800;
    background: linear-gradient(135deg, #f0abfc, #06b6d4);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
}
.landing-stat-label {
    font-size: 0.78em;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    opacity: 0.65;
    color: #c4b5fd;
}

/* ============================================ */
/* ============= DOOR REVEAL ================== */
/* ============================================ */

@keyframes doorLeftSwing {
    0% { transform: rotateY(0); }
    100% { transform: rotateY(-115deg); }
}
@keyframes doorRightSwing {
    0% { transform: rotateY(0); }
    100% { transform: rotateY(115deg); }
}
@keyframes doorOverlayFade {
    0%, 70% { opacity: 1; }
    100% { opacity: 0; visibility: hidden; }
}
@keyframes doorShimmer {
    0%, 100% { background-position: 0% 50%; }
    50% { background-position: 100% 50%; }
}

.door-overlay {
    position: fixed;
    inset: 0;
    z-index: 99999;
    pointer-events: none;
    perspective: 2400px;
    perspective-origin: 50% 50%;
    animation: doorOverlayFade 1.6s cubic-bezier(0.65, 0, 0.35, 1) forwards;
}
.door-half {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 50.5%;
    backface-visibility: hidden;
    border: 2px solid rgba(168,85,247,0.55);
    box-shadow:
        inset 0 0 80px rgba(236,72,153,0.4),
        inset 0 0 200px rgba(0,0,0,0.6),
        0 0 60px rgba(0,0,0,0.7);
    background-size: 200% 200%;
    animation-duration: 1.4s;
    animation-timing-function: cubic-bezier(0.65, 0, 0.35, 1);
    animation-fill-mode: forwards;
}
.door-half::before {
    content: "";
    position: absolute;
    inset: 0;
    background:
        repeating-linear-gradient(0deg,
            rgba(255,255,255,0.02) 0px,
            rgba(255,255,255,0.02) 2px,
            transparent 2px,
            transparent 6px);
    pointer-events: none;
}
.door-half::after {
    content: "";
    position: absolute;
    top: 50%;
    width: 14px;
    height: 50px;
    margin-top: -25px;
    border-radius: 4px;
    background: linear-gradient(135deg, #f59e0b, #ec4899);
    box-shadow: 0 0 20px rgba(236,72,153,0.7);
}
.door-left {
    left: 0;
    transform-origin: left center;
    animation-name: doorLeftSwing;
    background:
        linear-gradient(135deg, #1a0d2e 0%, #2a1554 50%, #0a0612 100%),
        linear-gradient(135deg, rgba(168,85,247,0.25), rgba(236,72,153,0.15));
}
.door-left::after { right: 12px; }
.door-right {
    right: 0;
    transform-origin: right center;
    animation-name: doorRightSwing;
    background:
        linear-gradient(225deg, #1a0d2e 0%, #2a1554 50%, #0a0612 100%),
        linear-gradient(225deg, rgba(6,182,212,0.25), rgba(168,85,247,0.15));
}
.door-right::after { left: 12px; }

/* Reveal flash — bright burst as doors open */
.door-flash {
    position: fixed;
    inset: 0;
    z-index: 99998;
    pointer-events: none;
    background: radial-gradient(circle at 50% 50%,
        rgba(255,255,255,0.5) 0%,
        rgba(236,72,153,0.3) 20%,
        rgba(168,85,247,0.2) 40%,
        transparent 70%);
    opacity: 0;
    animation: flashBurst 1.4s ease-out forwards;
}
@keyframes flashBurst {
    0% { opacity: 0; transform: scale(0.5); }
    25% { opacity: 1; transform: scale(1); }
    100% { opacity: 0; transform: scale(1.4); }
}

/* Dashboard intro: subtle scale-in once doors are open */
@keyframes dashboardIntro {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
}
.dashboard-intro .block-container {
    animation: dashboardIntro 0.8s cubic-bezier(0.34, 1.56, 0.64, 1) 0.5s both;
}

/* Hide Streamlit's default top toolbar/decoration on landing for max impact */
.landing-page-active [data-testid="stToolbar"],
.landing-page-active [data-testid="stDecoration"] {
    display: none !important;
}
</style>
"""

st.markdown(CUSTOM_CSS, unsafe_allow_html=True)


# ---------- helpers ----------


def score_color(score) -> str:
    try:
        v = int(score)
    except (TypeError, ValueError):
        return "#9ca3af"
    if v >= 4:
        return "#10b981"
    if v == 3:
        return "#f59e0b"
    return "#ef4444"


def score_badge_html(score) -> str:
    label = score if score not in ("", None) else "—"
    color = score_color(score)
    return (
        f"<span class='score-badge' style='background:{color};'>"
        f"{escape(str(label))}</span>"
    )


def score_caption(score) -> str:
    try:
        v = int(score)
    except (TypeError, ValueError):
        return "Not scored"
    return {1: "Poor", 2: "Below average", 3: "Average", 4: "Good", 5: "Excellent"}.get(
        v, "—"
    )


def render_score_ring(score):
    color = score_color(score)
    try:
        v = int(score)
        pct = max(0, min(100, (v / 5) * 100))
        offset = 314 - (314 * pct / 100)
        display = str(v)
    except (TypeError, ValueError):
        offset = 314
        display = "—"
    caption = score_caption(score)
    st.markdown(
        f"""
        <div class="score-ring-wrap">
            <div class="score-ring">
                <svg width="130" height="130">
                    <circle class="track" cx="65" cy="65" r="50"></circle>
                    <circle class="progress" cx="65" cy="65" r="50"
                            stroke="{color}"
                            style="stroke-dashoffset: {offset};"></circle>
                </svg>
                <div class="score-ring-center">
                    <div class="score-ring-num" style="color:{color};">{escape(display)}</div>
                    <div class="score-ring-label">of 5</div>
                </div>
            </div>
            <div class="score-ring-caption" style="color:{color};">{escape(caption)}</div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_dimension_cards(scores: dict):
    cards_html = ['<div class="dim-grid">']
    for d in RUBRIC_DIMENSIONS:
        s = scores.get(d["key"], {}) or {}
        score = s.get("score", "")
        rationale = s.get("rationale", "") or "—"
        color = score_color(score)
        cards_html.append(
            f"<div class='dim-card' style='--score-color:{color};'>"
            f"<div class='dim-head'>"
            f"<div><div class='dim-name'>{escape(d['name'])}</div>"
            f"<div class='dim-key'>{escape(d['key'])}</div></div>"
            f"{score_badge_html(score)}"
            f"</div>"
            f"<div class='dim-rationale'>{escape(str(rationale))}</div>"
            f"</div>"
        )
    cards_html.append("</div>")
    st.markdown("".join(cards_html), unsafe_allow_html=True)


def render_pipeline_animation(message: str = "Auditing your call…"):
    """A 3-stage animated indicator shown during an audit run."""
    bars = "".join("<span></span>" for _ in range(5))
    return st.markdown(
        f"""
        <div class="pipeline">
            <div class="pipeline-stage active">
                <div class="pipeline-bars">{bars}</div>
                <span>Transcribing audio</span>
            </div>
            <span class="pipeline-arrow">→</span>
            <div class="pipeline-stage active">
                <div class="pipeline-bars">{bars}</div>
                <span>Identifying speakers</span>
            </div>
            <span class="pipeline-arrow">→</span>
            <div class="pipeline-stage active">
                <div class="pipeline-bars">{bars}</div>
                <span>Scoring with Claude</span>
            </div>
        </div>
        <div style="text-align:center;font-size:0.92em;opacity:0.7;margin-top:-4px;animation:blink 1.6s ease-in-out infinite;">
            {escape(message)}
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_confetti():
    """One-shot CSS confetti burst. Renders ~40 colored pieces that fall and fade."""
    import random as _r
    colors = ["#6366f1", "#a855f7", "#ec4899", "#10b981", "#f59e0b", "#14b8a6", "#38bdf8", "#f472b6"]
    pieces = "".join(
        f"<div class='confetti-piece' style='"
        f"left:{_r.uniform(0, 100):.1f}vw;"
        f"background:{_r.choice(colors)};"
        f"animation-delay:{_r.uniform(0, 0.6):.2f}s;"
        f"animation-duration:{_r.uniform(1.8, 3.0):.2f}s;"
        f"transform:rotate({_r.randint(-40, 40)}deg);"
        f"width:{_r.choice([8, 10, 12])}px;"
        f"height:{_r.choice([10, 14, 18])}px;"
        f"'></div>"
        for _ in range(48)
    )
    st.markdown(f"<div class='confetti-host'>{pieces}</div>", unsafe_allow_html=True)


def waveform_html() -> str:
    return "<span class='waveform'>" + "".join("<span></span>" for _ in range(7)) + "</span>"


def render_evaluation(ev: dict):
    overall = ev.get("overall_score", "")
    summary = ev.get("summary", "")
    strengths = ev.get("strengths", "")
    lacking = ev.get("what_was_lacking", "")
    recs = ev.get("improvement_recommendations", []) or []
    scores = ev.get("scores", {}) or {}
    transcript = ev.get("transcript", "")
    provider = (ev.get("llm_provider") or "").strip()
    fallback_reason = (ev.get("llm_fallback_reason") or "").strip()

    if provider:
        provider_label = {
            "gemini": "Gemini 2.5 Flash",
            "anthropic": "Claude Opus 4.7",
            "ollama": f"Ollama ({os.getenv('OLLAMA_MODEL', 'qwen2.5:7b')})",
        }.get(provider, provider)
        if fallback_reason:
            badge = (
                f"<span class='status-pill' style='background:rgba(245,158,11,0.18);"
                f"border-color:rgba(245,158,11,0.5);'>"
                f"<span class='status-dot warn'></span>"
                f"<span style='opacity:0.85;'>Scored by</span> "
                f"<b>{escape(provider_label)}</b> "
                f"<span style='opacity:0.7;'>· fallback</span></span>"
            )
        else:
            badge = (
                f"<span class='status-pill'>"
                f"<span class='status-dot ok'></span>"
                f"<span style='opacity:0.75;'>Scored by</span> "
                f"<b>{escape(provider_label)}</b></span>"
            )
        st.markdown(
            f"<div style='margin-bottom:10px;'>{badge}</div>",
            unsafe_allow_html=True,
        )
        if fallback_reason:
            with st.expander("Why a fallback was used", expanded=False):
                st.code(fallback_reason)

    top1, top2 = st.columns([1, 4])
    with top1:
        render_score_ring(overall)
    with top2:
        st.markdown("<div class='section-head'>Summary</div>", unsafe_allow_html=True)
        st.markdown(
            f"<div style='font-size:1.02em;line-height:1.6;opacity:0.92;'>{escape(summary or '—')}</div>",
            unsafe_allow_html=True,
        )

    st.markdown(
        "<div class='section-head'>Per-dimension scores</div>", unsafe_allow_html=True
    )
    render_dimension_cards(scores)

    col_a, col_b = st.columns(2)
    with col_a:
        st.markdown(
            f"<div class='split-block good'>"
            f"<div class='split-head'>✓ Strengths</div>"
            f"<div>{escape(strengths or '—')}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )
    with col_b:
        st.markdown(
            f"<div class='split-block bad'>"
            f"<div class='split-head'>! What was lacking</div>"
            f"<div>{escape(lacking or '—')}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )

    st.markdown(
        "<div class='section-head'>Recommendations</div>", unsafe_allow_html=True
    )
    if recs:
        items = "".join(
            f"<li class='rec-item' style='animation-delay:{i*0.05:.2f}s;'>"
            f"<span>{escape(str(r))}</span></li>"
            for i, r in enumerate(recs)
        )
        st.markdown(f"<ul class='rec-list'>{items}</ul>", unsafe_allow_html=True)
    else:
        st.write("—")

    with st.expander("View transcript"):
        st.text(transcript or "(no transcript)")


# ---------- landing page ----------


def render_landing():
    st.markdown(
        f"""
        <div class='landing-stage'>
            <div class='landing-orb landing-orb-otis'>
                <div class='otis-mascot'>{_otis_svg_inline()}</div>
            </div>
            <div class='landing-eyebrow'>Hi, I'm Otis · I audit AI calls so you don't have to</div>
            <h1 class='landing-headline'>
                Are your AI calls<br>doing it <span class='highlight'>right</span>?
            </h1>
            <p class='landing-sub'>
                Drop a recording. Otis transcribes it with speaker diarization, scores
                it against your rubric, and tells you exactly where your AI nailed it
                — or fumbled.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )

    st.markdown("<div class='landing-cta-zone'></div>", unsafe_allow_html=True)
    cols = st.columns([1, 2, 1])
    with cols[1]:
        if st.button(
            "Let's find out  →",
            type="primary",
            key="enter_dashboard",
            use_container_width=True,
        ):
            st.session_state["entered"] = True
            st.session_state["just_entered"] = True
            st.rerun()

    st.markdown(
        """
        <div style='display:flex;flex-direction:column;align-items:center;'>
            <div class='landing-pills'>
                <span>Hindi</span>
                <span>English</span>
                <span>Hinglish</span>
                <span>Speaker diarization</span>
                <span>Compliance-ready</span>
            </div>
            <div class='landing-stat-row'>
                <div class='landing-stat'>
                    <div class='landing-stat-num'>10</div>
                    <div class='landing-stat-label'>Rubric dimensions</div>
                </div>
                <div class='landing-stat'>
                    <div class='landing-stat-num'>5</div>
                    <div class='landing-stat-label'>Audit presets</div>
                </div>
                <div class='landing-stat'>
                    <div class='landing-stat-num'>~30s</div>
                    <div class='landing-stat-label'>Per call audit</div>
                </div>
                <div class='landing-stat'>
                    <div class='landing-stat-num'>Opus 4.7</div>
                    <div class='landing-stat-label'>Powered by Claude</div>
                </div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_door_reveal():
    st.markdown(
        """
        <div class='door-flash'></div>
        <div class='door-overlay'>
            <div class='door-half door-left'></div>
            <div class='door-half door-right'></div>
        </div>
        """,
        unsafe_allow_html=True,
    )


# ---------- gate ----------


if not st.session_state.get("entered"):
    render_landing()
    st.stop()

if st.session_state.pop("just_entered", False):
    render_door_reveal()
    st.markdown(
        "<div class='dashboard-intro' style='display:contents;'></div>",
        unsafe_allow_html=True,
    )


# ---------- API key status ----------


anthropic_ok = bool(os.getenv("ANTHROPIC_API_KEY"))
gemini_ok = bool(os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))
assemblyai_ok = bool(os.getenv("ASSEMBLYAI_API_KEY"))


@st.cache_data(ttl=20, show_spinner=False)
def _ollama_status_cached() -> bool:
    return ollama_reachable()


ollama_ok = (
    os.getenv("OLLAMA_DISABLED", "").strip().lower() != "true"
    and _ollama_status_cached()
)

llm_provider_explicit = os.getenv("LLM_PROVIDER", "").strip().lower()
if llm_provider_explicit in ("gemini", "anthropic", "ollama"):
    active_llm = llm_provider_explicit
elif gemini_ok:
    active_llm = "gemini"
elif anthropic_ok:
    active_llm = "anthropic"
elif ollama_ok:
    active_llm = "ollama"
else:
    active_llm = "none"

active_llm_label = {
    "gemini": "Gemini 2.5 Flash",
    "anthropic": "Claude Opus 4.7",
    "ollama": f"Ollama ({os.getenv('OLLAMA_MODEL', 'qwen2.5:7b')})",
    "none": "no LLM configured",
}[active_llm]


# ---------- sidebar ----------


with st.sidebar:
    st.markdown(
        "<div style='font-size:1.15em;font-weight:700;letter-spacing:-0.01em;"
        "margin-bottom:14px;'>⚙️ Audit settings</div>",
        unsafe_allow_html=True,
    )

    def api_row(name: str, ok: bool) -> str:
        cls = "ok" if ok else "miss"
        label = "Connected" if ok else "not set"
        return (
            f"<div class='api-row'>"
            f"<span class='api-name'>{escape(name)}</span>"
            f"<span class='api-status'><span class='status-dot {cls}'></span>{escape(label)}</span>"
            f"</div>"
        )

    st.markdown(
        "<div style='font-size:0.78em;text-transform:uppercase;letter-spacing:0.1em;"
        "opacity:0.6;margin-bottom:8px;'>Pipeline</div>",
        unsafe_allow_html=True,
    )
    ollama_label = f"Ollama ({os.getenv('OLLAMA_MODEL', 'qwen2.5:7b')})"
    st.markdown(
        api_row("Gemini 2.5 Flash", gemini_ok)
        + api_row("Claude Opus 4.7", anthropic_ok)
        + api_row(ollama_label, ollama_ok)
        + api_row("AssemblyAI", assemblyai_ok),
        unsafe_allow_html=True,
    )
    st.caption(
        f"Transcription via AssemblyAI · Scoring via **{active_llm_label}** "
        f"(active). Fallback chain: Gemini → Claude → Ollama (local). "
        f"Override the primary with `LLM_PROVIDER=...` in `.env`."
    )

    _dbs = db_status()
    if _dbs["connected"] and _dbs["backend"] == "postgresql":
        st.success(f"DB: postgresql · {_dbs['rows']} audits stored")
    elif _dbs["connected"] and _dbs["backend"] == "sqlite":
        st.warning(
            "DB: sqlite (ephemeral). DATABASE_URL is not set — audit history "
            "won't survive a Streamlit Cloud restart. Add it to Secrets."
        )
    else:
        st.error(f"DB: {_dbs['backend']} · not connected · {_dbs['error']}")

    st.divider()

    st.markdown(
        "<div style='font-size:0.78em;text-transform:uppercase;letter-spacing:0.1em;"
        "opacity:0.6;margin-bottom:6px;'>What to audit for</div>",
        unsafe_allow_html=True,
    )

    preset_options = {
        f"{p['name']}": key for key, p in AUDIT_PRESETS.items()
    }
    preset_label = st.radio(
        "Audit type",
        list(preset_options.keys()),
        index=0,
        help="Picks which rubric dimensions get extra weight in the overall score.",
        label_visibility="collapsed",
    )
    preset = preset_options[preset_label]
    st.caption(AUDIT_PRESETS[preset]["description"])

    strictness = st.select_slider(
        "Scoring strictness",
        options=["lenient", "standard", "strict"],
        value="standard",
        help=(
            "Lenient: most adequate calls land at 3-4. "
            "Strict: 4-5 reserved for genuinely excellent execution."
        ),
    )

    custom_focus = st.text_area(
        "Anything specific to watch for? (optional)",
        placeholder=(
            "e.g. 'verify the agent disclosed the interest rate' or "
            "'flag any mention of guaranteed approval'"
        ),
        height=80,
        help="Free-text instruction appended to the auditor's system prompt.",
    )

    st.divider()

    st.markdown(
        "<div style='font-size:0.78em;text-transform:uppercase;letter-spacing:0.1em;"
        "opacity:0.6;margin-bottom:6px;'>Audio</div>",
        unsafe_allow_html=True,
    )
    language = st.selectbox(
        "Language",
        ["hi", "en"],
        index=0,
        help="'hi' handles Hindi + English + Hinglish; 'en' is English-only.",
    )
    os.environ["ASSEMBLYAI_LANGUAGE"] = language

    concurrency = st.slider(
        "Batch concurrency",
        1,
        16,
        4,
        help="How many calls to process in parallel during a batch run.",
    )
    os.environ["MAX_CONCURRENCY"] = str(concurrency)

    st.divider()
    st.caption(
        "Edit `rubric.py` to change dimensions or add presets. "
        "Changes apply on next audit (no restart needed)."
    )


llm_ok = gemini_ok or anthropic_ok or ollama_ok
ready_for_audit = llm_ok and assemblyai_ok


# ---------- hero ----------


def status_pill(label: str, ok: bool, miss_text: str | None = None) -> str:
    cls = "ok" if ok else "miss"
    text = label if ok else (miss_text or f"{label} missing")
    return (
        f"<span class='status-pill'>"
        f"<span class='status-dot {cls}'></span>{escape(text)}</span>"
    )


_focus_summary_parts = [AUDIT_PRESETS[preset]["name"], f"{strictness} strictness"]
if custom_focus and custom_focus.strip():
    _focus_summary_parts.append("custom focus")
_focus_summary = " · ".join(_focus_summary_parts)

_llm_count = sum([gemini_ok, anthropic_ok, ollama_ok])
if not ready_for_audit:
    _system_state = "miss"
    _system_text = "Add API keys in .env to start"
elif _llm_count >= 2:
    _system_state = "ok"
    _system_text = f"System ready · powered by {active_llm_label}"
else:
    _system_state = "warn"
    _system_text = f"Powered by {active_llm_label} · no fallback configured"

hero_html = f"""
<div class="hero">
    <div style="position:relative;z-index:1;">
        <div style="display:flex;align-items:flex-start;gap:18px;flex-wrap:wrap;">
            <span class="hero-icon hero-icon-otis">{_otis_svg_inline()}</span>
            <div style="flex:1;min-width:280px;">
                <h1 class="hero-title">Otis</h1>
                <div class="hero-sub">
                    Your AI-call auditor. Drop a recording, get a 1–5 score per dimension
                    with timestamped rationales. Hindi · English · Hinglish.
                </div>
            </div>
        </div>
        <div class="status-row">
            <span class='status-pill'>
                <span class='status-dot {_system_state}'></span>
                {escape(_system_text)}
            </span>
            <span class='status-pill focus'>
                <span style='opacity:0.75;'>Auditing for:</span>
                <b>{escape(_focus_summary)}</b>
            </span>
        </div>
    </div>
</div>
"""
st.markdown(hero_html, unsafe_allow_html=True)


tab_single, tab_batch, tab_calibration, tab_history, tab_rubric = st.tabs(
    [
        "🎙️  Single call",
        "📊  Batch (sheet)",
        "🎯  Calibration",
        "🗂️  History",
        "📋  Rubric",
    ]
)


# ---------- single call ----------


with tab_single:
    has_key_step = ready_for_audit
    has_input_step = bool(
        st.session_state.get("single_url") or st.session_state.get("single_file")
    )
    has_result = "last_evaluation" in st.session_state

    steps_html = f"""
    <div class="step-grid">
        <div class="step {"done" if has_key_step else ""}">
            <div class="step-num">1</div>
            <div class="step-title">Pick what to audit for</div>
            <div class="step-body">
                Choose an audit type and strictness in the sidebar. Currently scoring with <b>{escape(active_llm_label)}</b>.
            </div>
        </div>
        <div class="step {"done" if has_input_step else ""}">
            <div class="step-num">2</div>
            <div class="step-title">Provide a recording</div>
            <div class="step-body">
                Paste a public recording URL or upload an audio file (mp3, wav, m4a, mp4…).
            </div>
        </div>
        <div class="step {"done" if has_result else ""}">
            <div class="step-num">3</div>
            <div class="step-title">Click Audit</div>
            <div class="step-body">
                We transcribe with diarization, then Claude scores on 10 dimensions in seconds.
            </div>
        </div>
    </div>
    """
    st.markdown(steps_html, unsafe_allow_html=True)

    mode = st.radio(
        "Input",
        ["🔗 Recording URL", "📁 Upload audio file"],
        horizontal=True,
        label_visibility="collapsed",
    )

    target = None
    is_url = True

    if mode.endswith("URL"):
        url = st.text_input(
            "Recording URL",
            placeholder="https://example.com/recording.mp3",
            key="single_url",
            label_visibility="collapsed",
        )
        if url:
            target = url.strip()
            is_url = True
    else:
        uploaded = st.file_uploader(
            "Audio file",
            type=["mp3", "wav", "m4a", "ogg", "flac", "webm", "mp4"],
            key="single_file",
            label_visibility="collapsed",
        )
        if uploaded:
            tmp_dir = Path(tempfile.gettempdir()) / "call-auditor"
            tmp_dir.mkdir(exist_ok=True)
            tmp_path = tmp_dir / uploaded.name
            with open(tmp_path, "wb") as f:
                f.write(uploaded.getbuffer())
            target = str(tmp_path)
            is_url = False
            st.markdown(
                f"<div style='margin-top:6px;font-size:0.92em;opacity:0.85;'>"
                f"{waveform_html()}"
                f"<b>{escape(uploaded.name)}</b>"
                f" <span style='opacity:0.6;'>({uploaded.size / 1024:.0f} KB) ready to audit</span>"
                f"</div>",
                unsafe_allow_html=True,
            )

    can_run = bool(target) and ready_for_audit
    btn_label = (
        f"▶  Audit this call · {AUDIT_PRESETS[preset]['name']}"
        if can_run
        else (
            "Add API keys in .env to begin"
            if not ready_for_audit
            else "Provide a recording first"
        )
    )
    if st.button(btn_label, type="primary", disabled=not can_run, key="audit_single"):
        pipeline_slot = st.empty()
        with pipeline_slot.container():
            render_pipeline_animation(
                f"{AUDIT_PRESETS[preset]['name']} · {strictness} strictness"
            )
        try:
            ev = audit_one(target, is_url, preset, strictness, custom_focus)
            st.session_state["last_evaluation"] = ev
            st.session_state["fresh_audit"] = True
            display_target = target if is_url else Path(target).name
            record_audit(display_target, ev, source="single")
            pipeline_slot.empty()
            st.toast("Otis is done — your audit's ready.", icon="✅")
        except Exception as e:
            pipeline_slot.empty()
            st.error(f"{type(e).__name__}: {e}")
            st.session_state.pop("last_evaluation", None)

    if "last_evaluation" in st.session_state:
        if st.session_state.pop("fresh_audit", False):
            render_confetti()
        st.divider()
        render_evaluation(st.session_state["last_evaluation"])


# ---------- batch ----------


with tab_batch:
    st.markdown(
        "<div class='section-head'>Audit a sheet of calls</div>",
        unsafe_allow_html=True,
    )
    st.caption(
        "Upload an `.xlsx` or `.csv`. We'll auto-detect any column named "
        "`recording_link`, `Recording URL`, `recordingUrl`, etc. "
        "Already-audited rows (`audit_status == ok`) are automatically skipped, so reruns are resumable."
    )

    uploaded = st.file_uploader(
        "Sheet (xlsx or csv) with a recording-URL column",
        type=["xlsx", "csv"],
        key="sheet_upload",
        label_visibility="collapsed",
    )

    if uploaded:
        if uploaded.name.lower().endswith(".csv"):
            df = pd.read_csv(uploaded)
        else:
            df = pd.read_excel(uploaded)

        rec_col = find_recording_column(df)
        if rec_col is None:
            st.error(
                "Sheet must contain a column with `recording` and "
                "`link` or `url` in its name (e.g. `recording_link`, "
                "`Recording URL`, `recordingUrl`). "
                f"Found: {list(df.columns)}"
            )
        else:
            if rec_col != "recording_link":
                st.caption(f"Using column **`{rec_col}`** for recording URLs.")
            already = (
                df["audit_status"].astype(str).str.lower().eq("ok").sum()
                if "audit_status" in df.columns
                else 0
            )
            todo_count = len(df) - already

            mc1, mc2, mc3 = st.columns(3)
            with mc1:
                st.markdown(
                    f"<div class='metric-card'>"
                    f"<div class='metric-num'>{len(df)}</div>"
                    f"<div class='metric-label'>Total rows</div></div>",
                    unsafe_allow_html=True,
                )
            with mc2:
                st.markdown(
                    f"<div class='metric-card ok'>"
                    f"<div class='metric-num'>{int(already)}</div>"
                    f"<div class='metric-label'>Already audited</div></div>",
                    unsafe_allow_html=True,
                )
            with mc3:
                st.markdown(
                    f"<div class='metric-card skip'>"
                    f"<div class='metric-num'>{int(todo_count)}</div>"
                    f"<div class='metric-label'>To audit</div></div>",
                    unsafe_allow_html=True,
                )

            with st.expander("Preview first 10 rows"):
                st.dataframe(df.head(10), use_container_width=True)

            disabled = not ready_for_audit
            batch_btn_label = (
                f"▶  Start batch audit · {AUDIT_PRESETS[preset]['name']}"
                if not disabled
                else "Add API keys in .env to begin"
            )
            if st.button(
                batch_btn_label,
                type="primary",
                disabled=disabled,
                key="batch_run",
            ):
                if "audit_status" not in df.columns:
                    df["audit_status"] = ""
                df["audit_status"] = df["audit_status"].fillna("").astype(str)

                todo = df.index[df["audit_status"].str.lower() != "ok"].tolist()
                if not todo:
                    st.info("Nothing to audit — all rows already done.")
                else:
                    pipeline_slot = st.empty()
                    with pipeline_slot.container():
                        render_pipeline_animation(
                            f"Batch · {len(todo)} calls · {AUDIT_PRESETS[preset]['name']}"
                        )
                    progress = st.progress(0.0, text=f"0 / {len(todo)}")
                    live_table = st.empty()

                    batch_preset = preset
                    batch_strictness = strictness
                    batch_focus = custom_focus
                    batch_rec_col = rec_col

                    def worker(idx):
                        url = str(df.at[idx, batch_rec_col]).strip()
                        if not url or url.lower() in ("nan", "none", ""):
                            return idx, {
                                "audit_status": "skip",
                                "summary": "no recording link",
                            }
                        try:
                            ev = audit_one(
                                url, True, batch_preset, batch_strictness, batch_focus
                            )
                            record_audit(url, ev, source="batch")
                            return idx, flatten_for_sheet(ev)
                        except Exception as e:
                            return idx, {
                                "audit_status": "error",
                                "summary": f"{type(e).__name__}: {e}",
                            }

                    completed = 0
                    with ThreadPoolExecutor(max_workers=concurrency) as ex:
                        futures = [ex.submit(worker, i) for i in todo]
                        for fut in as_completed(futures):
                            idx, row = fut.result()
                            for k, v in row.items():
                                if k not in df.columns:
                                    df[k] = ""
                                df.at[idx, k] = v
                            completed += 1
                            progress.progress(
                                completed / len(todo),
                                text=f"{completed} / {len(todo)} audited",
                            )
                            if completed % max(1, len(todo) // 20) == 0:
                                preview_cols = [
                                    rec_col,
                                    "audit_status",
                                    "overall_score",
                                    "summary",
                                ]
                                live_table.dataframe(
                                    df[
                                        df["audit_status"].astype(str) != ""
                                    ][[c for c in preview_cols if c in df.columns]]
                                    .tail(10),
                                    use_container_width=True,
                                )

                    progress.empty()
                    pipeline_slot.empty()
                    st.session_state["batch_df"] = df
                    st.session_state["batch_name"] = uploaded.name
                    st.session_state["fresh_batch"] = True
                    st.toast(f"Otis audited {len(todo)} calls.", icon="🎉")

            if "batch_df" in st.session_state:
                if st.session_state.pop("fresh_batch", False):
                    render_confetti()
                df = st.session_state["batch_df"]
                ok = (df["audit_status"] == "ok").sum()
                err = (df["audit_status"] == "error").sum()
                skip = (df["audit_status"] == "skip").sum()

                rc1, rc2, rc3 = st.columns(3)
                with rc1:
                    st.markdown(
                        f"<div class='metric-card ok'>"
                        f"<div class='metric-num' style='color:#10b981;'>{int(ok)}</div>"
                        f"<div class='metric-label'>Audited OK</div></div>",
                        unsafe_allow_html=True,
                    )
                with rc2:
                    st.markdown(
                        f"<div class='metric-card err'>"
                        f"<div class='metric-num' style='color:#ef4444;'>{int(err)}</div>"
                        f"<div class='metric-label'>Errors</div></div>",
                        unsafe_allow_html=True,
                    )
                with rc3:
                    st.markdown(
                        f"<div class='metric-card skip'>"
                        f"<div class='metric-num' style='color:#f59e0b;'>{int(skip)}</div>"
                        f"<div class='metric-label'>Skipped</div></div>",
                        unsafe_allow_html=True,
                    )

                if ok:
                    audited = df[df["audit_status"] == "ok"].copy()
                    audited["overall_score"] = pd.to_numeric(
                        audited["overall_score"], errors="coerce"
                    )

                    chart_col, dim_col = st.columns(2)
                    with chart_col:
                        st.markdown(
                            "<div class='section-head'>Overall score distribution</div>",
                            unsafe_allow_html=True,
                        )
                        dist = (
                            audited["overall_score"]
                            .dropna()
                            .astype(int)
                            .value_counts()
                            .sort_index()
                            .reset_index()
                        )
                        dist.columns = ["score", "count"]
                        chart = (
                            alt.Chart(dist)
                            .mark_bar(cornerRadiusTopLeft=6, cornerRadiusTopRight=6)
                            .encode(
                                x=alt.X("score:O", title="Overall score"),
                                y=alt.Y("count:Q", title="Calls"),
                                color=alt.Color(
                                    "score:O",
                                    scale=alt.Scale(
                                        domain=[1, 2, 3, 4, 5],
                                        range=[
                                            "#ef4444",
                                            "#f97316",
                                            "#f59e0b",
                                            "#84cc16",
                                            "#10b981",
                                        ],
                                    ),
                                    legend=None,
                                ),
                                tooltip=["score", "count"],
                            )
                        )
                        st.altair_chart(chart, use_container_width=True)

                    with dim_col:
                        st.markdown(
                            "<div class='section-head'>Average per dimension</div>",
                            unsafe_allow_html=True,
                        )
                        dim_rows = []
                        for d in RUBRIC_DIMENSIONS:
                            col = f"score_{d['key']}"
                            if col in audited.columns:
                                vals = pd.to_numeric(
                                    audited[col], errors="coerce"
                                ).dropna()
                                if len(vals):
                                    dim_rows.append(
                                        {
                                            "Dimension": d["name"],
                                            "Avg": round(vals.mean(), 2),
                                        }
                                    )
                        if dim_rows:
                            dim_df = pd.DataFrame(dim_rows)
                            chart2 = (
                                alt.Chart(dim_df)
                                .mark_bar(
                                    cornerRadiusTopRight=6, cornerRadiusBottomRight=6
                                )
                                .encode(
                                    y=alt.Y("Dimension:N", sort="-x", title=None),
                                    x=alt.X("Avg:Q", scale=alt.Scale(domain=[0, 5])),
                                    color=alt.Color(
                                        "Avg:Q",
                                        scale=alt.Scale(
                                            domain=[1, 3, 5],
                                            range=["#ef4444", "#f59e0b", "#10b981"],
                                        ),
                                        legend=None,
                                    ),
                                    tooltip=["Dimension", "Avg"],
                                )
                            )
                            st.altair_chart(chart2, use_container_width=True)

                audited_idx = df[df["audit_status"] == "ok"].index.tolist()
                rec_col_for_export = (
                    rec_col if rec_col in df.columns else None
                )

                buf = io.BytesIO()
                with pd.ExcelWriter(buf, engine="openpyxl") as writer:
                    df.to_excel(writer, sheet_name="Summary", index=False)

                    detail_rows = []
                    for i_pos, idx in enumerate(audited_idx, start=1):
                        link = (
                            str(df.at[idx, rec_col_for_export])
                            if rec_col_for_export
                            else ""
                        )
                        detail_rows.append(
                            {
                                "Field": f"━━━  CALL {i_pos}  (row {idx})  ━━━",
                                "Value": "",
                            }
                        )
                        detail_rows.append({"Field": "Recording", "Value": link})
                        detail_rows.append(
                            {
                                "Field": "Overall score",
                                "Value": df.at[idx, "overall_score"],
                            }
                        )
                        detail_rows.append(
                            {
                                "Field": "Summary",
                                "Value": str(df.at[idx, "summary"] or ""),
                            }
                        )
                        detail_rows.append(
                            {
                                "Field": "Strengths",
                                "Value": str(df.at[idx, "strengths"] or ""),
                            }
                        )
                        detail_rows.append(
                            {
                                "Field": "What was lacking",
                                "Value": str(df.at[idx, "what_was_lacking"] or ""),
                            }
                        )
                        detail_rows.append(
                            {
                                "Field": "Recommendations",
                                "Value": str(df.at[idx, "recommendations"] or ""),
                            }
                        )
                        if "preset" in df.columns:
                            detail_rows.append(
                                {
                                    "Field": "Preset",
                                    "Value": str(df.at[idx, "preset"] or ""),
                                }
                            )
                        if "strictness" in df.columns:
                            detail_rows.append(
                                {
                                    "Field": "Strictness",
                                    "Value": str(df.at[idx, "strictness"] or ""),
                                }
                            )
                        detail_rows.append(
                            {"Field": "— Per-dimension —", "Value": ""}
                        )
                        for d in RUBRIC_DIMENSIONS:
                            sv = df.at[idx, f"score_{d['key']}"]
                            nv = df.at[idx, f"note_{d['key']}"]
                            detail_rows.append(
                                {
                                    "Field": d["name"],
                                    "Value": f"[{sv}/5]  {nv}",
                                }
                            )
                        detail_rows.append(
                            {
                                "Field": "Transcript",
                                "Value": str(df.at[idx, "transcript"] or ""),
                            }
                        )
                        detail_rows.append({"Field": "", "Value": ""})

                    if detail_rows:
                        pd.DataFrame(detail_rows).to_excel(
                            writer, sheet_name="Per call", index=False
                        )
                buf.seek(0)
                base = Path(st.session_state.get("batch_name", "audit.xlsx")).stem
                st.download_button(
                    "⬇  Download audited sheet (Summary + Per-call)",
                    data=buf,
                    file_name=f"{base}_audited.xlsx",
                    mime=(
                        "application/vnd.openxmlformats-officedocument."
                        "spreadsheetml.sheet"
                    ),
                )

                st.markdown(
                    f"<div class='section-head'>Per-call audits · {len(audited_idx)} calls</div>",
                    unsafe_allow_html=True,
                )
                st.caption(
                    "Each call has its own audit card below. Click any to expand the full "
                    "evaluation — per-dimension scores with timestamped rationales, "
                    "strengths, what was lacking, recommendations, and transcript."
                )

                if not audited_idx:
                    st.info("No successfully audited calls yet.")
                else:
                    for i_pos, idx in enumerate(audited_idx, start=1):
                        overall = df.at[idx, "overall_score"]
                        summary = str(df.at[idx, "summary"] or "")
                        summary_preview = (
                            summary[:80] + ("…" if len(summary) > 80 else "")
                        )
                        try:
                            score_str = f"{int(overall)}/5"
                        except (TypeError, ValueError):
                            score_str = "—/5"
                        label = f"Call {i_pos}  ·  {score_str}  ·  {summary_preview}"
                        with st.expander(label):
                            link = (
                                str(df.at[idx, rec_col_for_export])
                                if rec_col_for_export
                                else ""
                            )
                            if link:
                                st.markdown(
                                    f"<div style='font-size:0.82em;opacity:0.6;"
                                    f"font-family:SF Mono,Monaco,monospace;"
                                    f"word-break:break-all;margin-bottom:10px;'>"
                                    f"🔗 {escape(link)}</div>",
                                    unsafe_allow_html=True,
                                )
                            ev = {
                                "overall_score": df.at[idx, "overall_score"],
                                "summary": df.at[idx, "summary"],
                                "strengths": df.at[idx, "strengths"],
                                "what_was_lacking": df.at[idx, "what_was_lacking"],
                                "improvement_recommendations": [
                                    r.strip()
                                    for r in str(
                                        df.at[idx, "recommendations"]
                                    ).split("\n")
                                    if r.strip()
                                ],
                                "scores": {
                                    d["key"]: {
                                        "score": df.at[idx, f"score_{d['key']}"],
                                        "rationale": df.at[idx, f"note_{d['key']}"],
                                    }
                                    for d in RUBRIC_DIMENSIONS
                                },
                                "transcript": df.at[idx, "transcript"],
                                "llm_provider": (
                                    df.at[idx, "llm_provider"]
                                    if "llm_provider" in df.columns
                                    else ""
                                ),
                                "llm_fallback_reason": (
                                    df.at[idx, "llm_fallback_reason"]
                                    if "llm_fallback_reason" in df.columns
                                    else ""
                                ),
                            }
                            render_evaluation(ev)

                with st.expander(
                    f"📋  View all rows as a flat table  ({len(df)} rows)",
                    expanded=False,
                ):
                    st.dataframe(df, use_container_width=True, height=400)


# ---------- calibration ----------


with tab_calibration:
    st.markdown(
        "<div class='section-head'>Calibrate the auditor against human grades</div>",
        unsafe_allow_html=True,
    )
    st.caption(
        "Hand-grade 20-50 calls, upload them here, and see how closely Claude's "
        "scores match yours. This is what turns a toy auditor into one you can trust at scale."
    )

    with st.expander("CSV format expected", expanded=False):
        st.markdown(
            "**Required columns**\n"
            "- a recording-URL column — any name containing `recording` and `link` or `url` "
            "(`recording_link`, `Recording URL`, `recordingUrl`, etc.)\n"
            "- `human_overall` — your overall score, 1-5\n\n"
            "**Optional columns** (one per rubric dimension you also hand-grade)\n"
            + "\n".join(
                f"- `human_{d['key']}` — your score for *{d['name']}*"
                for d in RUBRIC_DIMENSIONS
            )
            + "\n\nThe more dimensions you grade, the more insight you'll get into where "
            "Claude diverges from your judgment. A good calibration on `overall`: "
            "MAD < 0.7, % within 1 > 85%, Pearson > 0.7."
        )

    cal_uploaded = st.file_uploader(
        "Calibration set (.csv or .xlsx)",
        type=["csv", "xlsx"],
        key="cal_upload",
        label_visibility="collapsed",
    )

    if cal_uploaded:
        if cal_uploaded.name.lower().endswith(".csv"):
            cal_df = pd.read_csv(cal_uploaded)
        else:
            cal_df = pd.read_excel(cal_uploaded)

        cal_rec_col = find_recording_column(cal_df)
        missing = []
        if cal_rec_col is None:
            missing.append("recording_link / Recording URL (any variant)")
        if "human_overall" not in cal_df.columns:
            missing.append("human_overall")
        if missing:
            st.error(
                f"Missing required columns: {missing}. "
                f"Found: {list(cal_df.columns)}"
            )
        else:
            if cal_rec_col != "recording_link":
                st.caption(f"Using column **`{cal_rec_col}`** for recording URLs.")
            graded_dims = [
                d for d in RUBRIC_DIMENSIONS if f"human_{d['key']}" in cal_df.columns
            ]

            cm1, cm2, cm3 = st.columns(3)
            with cm1:
                st.markdown(
                    f"<div class='metric-card'>"
                    f"<div class='metric-num'>{len(cal_df)}</div>"
                    f"<div class='metric-label'>Calls graded</div></div>",
                    unsafe_allow_html=True,
                )
            with cm2:
                st.markdown(
                    f"<div class='metric-card'>"
                    f"<div class='metric-num'>{len(graded_dims)}</div>"
                    f"<div class='metric-label'>Dimensions graded</div></div>",
                    unsafe_allow_html=True,
                )
            with cm3:
                st.markdown(
                    f"<div class='metric-card'>"
                    f"<div class='metric-num' style='font-size:1.4em;'>{escape(AUDIT_PRESETS[preset]['name'])}</div>"
                    f"<div class='metric-label'>Active preset</div></div>",
                    unsafe_allow_html=True,
                )

            with st.expander("Preview first 10 rows"):
                st.dataframe(cal_df.head(10), use_container_width=True)

            cal_disabled = not ready_for_audit
            cal_btn_label = (
                f"▶  Run calibration · {AUDIT_PRESETS[preset]['name']}"
                if not cal_disabled
                else "Add API keys in .env to begin"
            )
            if st.button(
                cal_btn_label,
                type="primary",
                disabled=cal_disabled,
                key="cal_run",
            ):
                cal_pipeline_slot = st.empty()
                with cal_pipeline_slot.container():
                    render_pipeline_animation(
                        f"Calibration · {len(cal_df)} calls vs human grades"
                    )
                cal_progress = st.progress(0.0, text=f"0 / {len(cal_df)}")

                cal_preset = preset
                cal_strictness = strictness
                cal_focus = custom_focus
                cal_rec_col_local = cal_rec_col

                def cal_worker(idx):
                    url = str(cal_df.at[idx, cal_rec_col_local]).strip()
                    if not url or url.lower() in ("nan", "none", ""):
                        return idx, {
                            "audit_status": "skip",
                            "summary": "no recording link",
                        }
                    try:
                        ev = audit_one(
                            url, True, cal_preset, cal_strictness, cal_focus
                        )
                        return idx, flatten_for_sheet(ev)
                    except Exception as e:
                        return idx, {
                            "audit_status": "error",
                            "summary": f"{type(e).__name__}: {e}",
                        }

                completed = 0
                with ThreadPoolExecutor(max_workers=concurrency) as ex:
                    futures = [ex.submit(cal_worker, i) for i in cal_df.index]
                    for fut in as_completed(futures):
                        idx, row = fut.result()
                        for k, v in row.items():
                            if k not in cal_df.columns:
                                cal_df[k] = ""
                            cal_df.at[idx, k] = v
                        completed += 1
                        cal_progress.progress(
                            completed / len(cal_df),
                            text=f"{completed} / {len(cal_df)} audited",
                        )

                cal_progress.empty()
                cal_pipeline_slot.empty()
                st.session_state["calibration_df"] = cal_df
                st.session_state["calibration_preset"] = preset
                st.session_state["calibration_strictness"] = strictness
                st.session_state["fresh_calibration"] = True
                st.toast("Calibration complete — see how Otis stacks up against humans.", icon="🎯")

    if "calibration_df" in st.session_state:
        if st.session_state.pop("fresh_calibration", False):
            render_confetti()
        cdf = st.session_state["calibration_df"]
        cdf_ok = cdf[cdf.get("audit_status") == "ok"] if "audit_status" in cdf.columns else cdf

        if len(cdf_ok) == 0:
            st.warning("No successfully audited rows to compare against.")
        else:
            metrics = compute_metrics(cdf_ok["human_overall"], cdf_ok["overall_score"])

            st.markdown(
                "<div class='section-head'>Overall agreement</div>",
                unsafe_allow_html=True,
            )

            def fmt(v, dp=2):
                return "—" if v is None else f"{v:.{dp}f}"

            mad = metrics.get("mad")
            pearson = metrics.get("pearson")
            within = metrics.get("within_1_pct")

            mad_color = (
                "#10b981" if mad is not None and mad < 0.7
                else "#f59e0b" if mad is not None and mad < 1.2
                else "#ef4444"
            )
            pear_color = (
                "#10b981" if pearson is not None and pearson > 0.7
                else "#f59e0b" if pearson is not None and pearson > 0.4
                else "#ef4444"
            )
            within_color = (
                "#10b981" if within is not None and within > 85
                else "#f59e0b" if within is not None and within > 65
                else "#ef4444"
            )

            mc1, mc2, mc3, mc4 = st.columns(4)
            with mc1:
                st.markdown(
                    f"<div class='metric-card'>"
                    f"<div class='metric-num'>{metrics.get('n', 0)}</div>"
                    f"<div class='metric-label'>Calls compared</div></div>",
                    unsafe_allow_html=True,
                )
            with mc2:
                st.markdown(
                    f"<div class='metric-card' style='border-left:4px solid {mad_color};'>"
                    f"<div class='metric-num' style='color:{mad_color};'>{fmt(mad)}</div>"
                    f"<div class='metric-label'>Mean abs deviation</div></div>",
                    unsafe_allow_html=True,
                )
            with mc3:
                st.markdown(
                    f"<div class='metric-card' style='border-left:4px solid {within_color};'>"
                    f"<div class='metric-num' style='color:{within_color};'>{fmt(within, 0)}%</div>"
                    f"<div class='metric-label'>Within 1 point</div></div>",
                    unsafe_allow_html=True,
                )
            with mc4:
                st.markdown(
                    f"<div class='metric-card' style='border-left:4px solid {pear_color};'>"
                    f"<div class='metric-num' style='color:{pear_color};'>{fmt(pearson)}</div>"
                    f"<div class='metric-label'>Pearson r</div></div>",
                    unsafe_allow_html=True,
                )

            mh = metrics.get("mean_human")
            ml = metrics.get("mean_llm")
            if mh is not None and ml is not None:
                bias = ml - mh
                bias_text = (
                    f"Claude scores **{abs(bias):.2f} points {'higher' if bias > 0 else 'lower'}** "
                    f"on average than humans (mean human {mh:.2f} vs mean LLM {ml:.2f})."
                    if abs(bias) > 0.1
                    else f"Mean scores nearly identical (human {mh:.2f}, LLM {ml:.2f}). No systematic bias."
                )
                st.markdown(
                    f"<div class='card' style='font-size:0.95em;'>{bias_text}</div>",
                    unsafe_allow_html=True,
                )

            st.markdown(
                "<div class='section-head'>Human vs LLM scores</div>",
                unsafe_allow_html=True,
            )

            scatter_df = pd.DataFrame({
                "human": pd.to_numeric(cdf_ok["human_overall"], errors="coerce"),
                "llm": pd.to_numeric(cdf_ok["overall_score"], errors="coerce"),
            }).dropna()

            if len(scatter_df) > 0:
                line_df = pd.DataFrame({"x": [1, 5], "y": [1, 5]})
                base = (
                    alt.Chart(scatter_df)
                    .mark_circle(size=140, opacity=0.6)
                    .encode(
                        x=alt.X("human:Q", scale=alt.Scale(domain=[0.5, 5.5]),
                                axis=alt.Axis(values=[1, 2, 3, 4, 5], title="Human score")),
                        y=alt.Y("llm:Q", scale=alt.Scale(domain=[0.5, 5.5]),
                                axis=alt.Axis(values=[1, 2, 3, 4, 5], title="Claude score")),
                        color=alt.Color(
                            "llm:Q",
                            scale=alt.Scale(
                                domain=[1, 3, 5],
                                range=["#ef4444", "#f59e0b", "#10b981"],
                            ),
                            legend=None,
                        ),
                        tooltip=["human", "llm"],
                    )
                )
                diag = (
                    alt.Chart(line_df)
                    .mark_line(strokeDash=[5, 5], color="rgba(148,163,184,0.5)")
                    .encode(x="x:Q", y="y:Q")
                )
                chart = (diag + base).properties(height=320).interactive()
                st.altair_chart(chart, use_container_width=True)
                st.caption(
                    "Dots near the diagonal = Claude agrees with humans. "
                    "Dots far from the diagonal are where you'd want to investigate."
                )

            dim_metrics = per_dimension_metrics(cdf_ok)
            if dim_metrics:
                st.markdown(
                    "<div class='section-head'>Per-dimension agreement</div>",
                    unsafe_allow_html=True,
                )
                dim_table = []
                for k, m in dim_metrics.items():
                    dim_table.append({
                        "Dimension": m["name"],
                        "n": m.get("n", 0),
                        "MAD": fmt(m.get("mad")),
                        "Within 1": f"{fmt(m.get('within_1_pct'), 0)}%" if m.get("within_1_pct") is not None else "—",
                        "Pearson": fmt(m.get("pearson")),
                    })
                st.dataframe(pd.DataFrame(dim_table), use_container_width=True, hide_index=True)

            dis_df = disagreements(cdf_ok, threshold=2.0)
            st.markdown(
                f"<div class='section-head'>Disagreements (≥2 points apart) "
                f"· {len(dis_df)} call{'s' if len(dis_df) != 1 else ''}</div>",
                unsafe_allow_html=True,
            )
            if len(dis_df) == 0:
                st.success(
                    "No major disagreements — Claude is within 1 point of every human grade."
                )
            else:
                st.caption(
                    "These are the calls where Claude and the human reviewer diverged most. "
                    "Investigating them will tell you whether the prompt, rubric, or human grade needs adjustment."
                )
                disagreement_rec_col = find_recording_column(cdf_ok)
                for idx, row in dis_df.head(10).iterrows():
                    h = row.get("human_overall", "—")
                    l = row.get("overall_score", "—")
                    diff = row.get("__diff", 0)
                    summary = str(row.get("summary", "") or "")
                    link = (
                        str(row.get(disagreement_rec_col, "") or "")
                        if disagreement_rec_col
                        else ""
                    )
                    try:
                        direction = "higher" if float(l) > float(h) else "lower"
                    except (TypeError, ValueError):
                        direction = "differs"
                    st.markdown(
                        f"<div class='card' style='border-left:4px solid #ef4444;'>"
                        f"<div style='display:flex;align-items:center;gap:14px;flex-wrap:wrap;'>"
                        f"<div style='font-size:0.78em;text-transform:uppercase;letter-spacing:0.1em;opacity:0.6;'>Human</div>"
                        f"{score_badge_html(h)}"
                        f"<div style='opacity:0.4;'>→</div>"
                        f"<div style='font-size:0.78em;text-transform:uppercase;letter-spacing:0.1em;opacity:0.6;'>Claude ({direction})</div>"
                        f"{score_badge_html(l)}"
                        f"<div style='margin-left:auto;font-size:0.85em;opacity:0.7;'>Δ {diff:.0f} points</div>"
                        f"</div>"
                        f"<div style='margin-top:10px;font-size:0.92em;opacity:0.85;line-height:1.55;'>{escape(summary[:300])}</div>"
                        + (
                            f"<div style='margin-top:6px;font-size:0.78em;opacity:0.5;font-family:SF Mono,Monaco,monospace;word-break:break-all;'>{escape(link)}</div>"
                            if link
                            else ""
                        )
                        + "</div>",
                        unsafe_allow_html=True,
                    )

            buf = io.BytesIO()
            cdf.to_excel(buf, index=False)
            buf.seek(0)
            st.download_button(
                "⬇  Download calibration results",
                data=buf,
                file_name="calibration_results.xlsx",
                mime=(
                    "application/vnd.openxmlformats-officedocument."
                    "spreadsheetml.sheet"
                ),
            )


# ---------- history ----------


with tab_history:
    st.markdown(
        "<div class='section-head'>Past audits</div>",
        unsafe_allow_html=True,
    )
    st.caption(
        "Every audit you run — single or batch — is saved to disk at "
        "`.cache/history/audits.jsonl`. Survives browser refreshes and restarts."
    )

    total_count = history_stats().get("total", 0)

    if total_count == 0:
        st.info(
            "No history yet. Run an audit on the **Single call** or **Batch** tab "
            "and it'll show up here."
        )
    else:
        all_presets = history_distinct("preset")
        all_providers = history_distinct("llm_provider")

        col_search, col_preset, col_provider, col_score = st.columns([3, 2, 2, 2])
        with col_search:
            q = st.text_input(
                "Search target (URL or filename)",
                key="history_search",
                placeholder="paste any part of a URL or filename…",
                label_visibility="collapsed",
            )
        with col_preset:
            preset_filter = st.selectbox(
                "Preset",
                ["All presets"] + all_presets,
                key="history_preset_filter",
                label_visibility="collapsed",
            )
        with col_provider:
            provider_filter = st.selectbox(
                "LLM",
                ["All LLMs"] + all_providers,
                key="history_provider_filter",
                label_visibility="collapsed",
            )
        with col_score:
            min_score_label = st.selectbox(
                "Min score",
                ["Any score", "≥ 1", "≥ 2", "≥ 3", "≥ 4", "= 5"],
                key="history_score_filter",
                label_visibility="collapsed",
            )

        _filter_kwargs = {
            "search": q.strip() if q else "",
            "preset": preset_filter if preset_filter != "All presets" else "",
            "provider": provider_filter if provider_filter != "All LLMs" else "",
            "min_score": (
                5 if min_score_label == "= 5"
                else int(min_score_label.split()[-1]) if min_score_label != "Any score"
                else 0
            ),
        }

        stats = history_stats(**_filter_kwargs)
        filtered = load_history(limit=200, **_filter_kwargs)

        # The "= 5" case needs an exact match — SQL has min_score>=5 already,
        # which equals "= 5" since the column is capped at 5.

        mc1, mc2, mc3, mc4 = st.columns(4)
        with mc1:
            st.markdown(
                f"<div class='metric-card'>"
                f"<div class='metric-num'>{stats['total']}</div>"
                f"<div class='metric-label'>Total audits</div></div>",
                unsafe_allow_html=True,
            )
        with mc2:
            st.markdown(
                f"<div class='metric-card'>"
                f"<div class='metric-num'>{stats['matching']}</div>"
                f"<div class='metric-label'>Matching filters</div></div>",
                unsafe_allow_html=True,
            )
        with mc3:
            avg_text = (
                f"{stats['avg_score']:.1f}" if stats.get("avg_score") is not None else "—"
            )
            st.markdown(
                f"<div class='metric-card'>"
                f"<div class='metric-num'>{escape(avg_text)}</div>"
                f"<div class='metric-label'>Avg overall (filtered)</div></div>",
                unsafe_allow_html=True,
            )
        with mc4:
            sources = sorted({r.get("source", "single") for r in filtered})
            source_text = "/".join(sources) if sources else "—"
            st.markdown(
                f"<div class='metric-card'>"
                f"<div class='metric-num' style='font-size:1.4em;'>{escape(source_text)}</div>"
                f"<div class='metric-label'>Sources</div></div>",
                unsafe_allow_html=True,
            )

        st.markdown(
            f"<div class='section-head'>Audits ({stats['matching']})</div>",
            unsafe_allow_html=True,
        )

        if not filtered:
            st.caption("No audits match the current filters.")
        else:
            for r in filtered:
                ts_iso = r.get("timestamp", "")
                try:
                    ts = datetime.fromisoformat(
                        ts_iso.replace("Z", "+00:00")
                    ).strftime("%Y-%m-%d %H:%M")
                except (ValueError, TypeError):
                    ts = ts_iso[:16]
                target = str(r.get("target", "") or "")
                target_short = target if len(target) < 60 else target[:57] + "…"
                overall = r.get("overall_score", "")
                try:
                    score_str = f"{int(overall)}/5"
                except (TypeError, ValueError):
                    score_str = "—/5"
                preset_name = AUDIT_PRESETS.get(
                    r.get("preset", ""), {}
                ).get("name", r.get("preset", ""))
                source_tag = r.get("source", "single")
                summary_preview = str(r.get("summary", "") or "")[:60]
                if len(str(r.get("summary", ""))) > 60:
                    summary_preview += "…"
                label = (
                    f"{ts}  ·  {score_str}  ·  {preset_name or '—'}  ·  "
                    f"[{source_tag}]  ·  {target_short}"
                )
                with st.expander(label):
                    st.markdown(
                        f"<div style='font-size:0.82em;opacity:0.7;"
                        f"font-family:SF Mono,Monaco,monospace;"
                        f"word-break:break-all;margin-bottom:8px;'>"
                        f"🔗 {escape(target)}</div>",
                        unsafe_allow_html=True,
                    )
                    if summary_preview:
                        st.caption(summary_preview)
                    ev = {
                        "overall_score": r.get("overall_score", ""),
                        "summary": r.get("summary", ""),
                        "strengths": r.get("strengths", ""),
                        "what_was_lacking": r.get("what_was_lacking", ""),
                        "improvement_recommendations": r.get(
                            "improvement_recommendations", []
                        ),
                        "scores": r.get("scores", {}),
                        "transcript": r.get("transcript", ""),
                        "llm_provider": r.get("llm_provider", ""),
                        "llm_fallback_reason": r.get("llm_fallback_reason", ""),
                    }
                    render_evaluation(ev)

            if stats["matching"] > len(filtered):
                st.caption(
                    f"Showing newest {len(filtered)} of {stats['matching']}. "
                    f"Refine filters to surface older audits."
                )

        st.divider()
        st.markdown(
            "<div class='section-head'>Maintenance</div>", unsafe_allow_html=True
        )
        col_clear, col_cache, _ = st.columns([1, 1, 2])
        with col_clear:
            if st.button(
                "🗑  Clear all history",
                key="clear_history_btn",
                help="Delete every record in .cache/history/audits.jsonl",
            ):
                if clear_history():
                    st.toast("History cleared.", icon="🗑️")
                    st.rerun()
                else:
                    st.error("Couldn't clear history file.")
        with col_cache:
            if st.button(
                "🧹  Clear transcript cache",
                key="clear_cache_btn",
                help="Delete every cached transcript so the next audit re-transcribes.",
            ):
                n = clear_transcript_cache()
                st.toast(f"Cleared {n} cached transcripts.", icon="🧹")


# ---------- rubric ----------


with tab_rubric:
    st.markdown(
        "<div class='section-head'>Audit presets</div>", unsafe_allow_html=True
    )
    st.caption(
        "Each preset is the same rubric below — just with different "
        "dimensions weighted more heavily in the overall score."
    )

    preset_html = ['<div class="rubric-grid">']
    for i, (key, p) in enumerate(AUDIT_PRESETS.items()):
        emphasis = p.get("emphasis_keys", [])
        emphasis_label = (
            ", ".join(
                next((d["name"] for d in RUBRIC_DIMENSIONS if d["key"] == k), k)
                for k in emphasis
            )
            if emphasis
            else "All dimensions weighted equally."
        )
        is_active = key == preset
        active_style = (
            "border-color:rgba(99,102,241,0.55);background:rgba(99,102,241,0.08);"
            if is_active
            else ""
        )
        preset_html.append(
            f"<div class='rubric-card' data-active='{str(is_active).lower()}' "
            f"style='animation-delay:{i*0.04:.2f}s;{active_style}'>"
            f"<div class='rubric-name'>{escape(p['name'])}"
            + (
                " <span style='font-size:0.7em;color:#6366f1;font-weight:700;"
                "letter-spacing:0.1em;text-transform:uppercase;margin-left:6px;'>"
                "● Active</span>"
                if key == preset
                else ""
            )
            + f"</div>"
            f"<span class='rubric-key'>{escape(key)}</span>"
            f"<div class='rubric-criteria'>{escape(p['description'])}</div>"
            f"<div style='margin-top:10px;font-size:0.82em;opacity:0.7;'>"
            f"<b>Emphasis:</b> {escape(emphasis_label)}</div>"
            f"</div>"
        )
    preset_html.append("</div>")
    st.markdown("".join(preset_html), unsafe_allow_html=True)

    st.markdown(
        "<div class='section-head' style='margin-top:28px;'>Scoring dimensions</div>",
        unsafe_allow_html=True,
    )
    st.caption(
        "Edit `rubric.py` to change these. Changes apply on next audit (no restart needed)."
    )

    rubric_html = ['<div class="rubric-grid">']
    for i, d in enumerate(RUBRIC_DIMENSIONS):
        is_emphasized = d["key"] in AUDIT_PRESETS[preset].get("emphasis_keys", [])
        emphasis_badge = (
            "<span style='font-size:0.7em;color:#6366f1;font-weight:700;"
            "letter-spacing:0.1em;text-transform:uppercase;margin-left:6px;'>"
            "★ Primary</span>"
            if is_emphasized
            else ""
        )
        active_style = (
            "border-color:rgba(99,102,241,0.4);" if is_emphasized else ""
        )
        rubric_html.append(
            f"<div class='rubric-card' style='animation-delay:{i*0.04:.2f}s;{active_style}'>"
            f"<div class='rubric-name'>{escape(d['name'])}{emphasis_badge}</div>"
            f"<span class='rubric-key'>{escape(d['key'])}</span>"
            f"<div class='rubric-criteria'>{escape(d['criteria'])}</div>"
            f"</div>"
        )
    rubric_html.append("</div>")
    st.markdown("".join(rubric_html), unsafe_allow_html=True)
