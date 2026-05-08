"""
Call Auditor — evaluate AI-human call recordings against a quality rubric.

Pipeline: AssemblyAI (transcription + diarization)  →  Claude Opus 4.7 (scoring).

Usage:
    python auditor.py --sheet input.xlsx [--out output.xlsx]
    python auditor.py --url   https://example.com/recording.mp3
    python auditor.py --file  ./recording.mp3

Audit options:
    --preset      {general,sales,support,compliance,onboarding}   (default: general)
    --strictness  {lenient,standard,strict}                        (default: standard)
    --focus       "free-text additional focus for the auditor"

Required env vars:
    ANTHROPIC_API_KEY    — Claude
    ASSEMBLYAI_API_KEY   — Transcription with speaker diarization

Optional env vars:
    ANTHROPIC_MODEL      (default: claude-opus-4-7)
    ASSEMBLYAI_LANGUAGE  (default: hi — handles Hindi/English/Hinglish; 'en' for English-only)
    EFFORT               (default: high — Claude reasoning effort: low|medium|high|max)
    MAX_CONCURRENCY      (default: 4 — for batch sheet runs)

Audited rows get score / note / summary columns appended; rerunning skips
rows where audit_status == "ok" (resumable).
"""

import argparse
import hashlib
import json
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Optional

import assemblyai as aai
import pandas as pd
import requests
from anthropic import Anthropic
from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types
from tqdm import tqdm

from rubric import AUDIT_PRESETS, RUBRIC_DIMENSIONS, output_schema, system_prompt

load_dotenv(override=True)

DEFAULT_ANTHROPIC_MODEL = "claude-opus-4-7"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"
DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434"
DEFAULT_OLLAMA_MODEL = "qwen2.5:7b"
DEFAULT_LANGUAGE = "hi"
DEFAULT_EFFORT = "high"
DEFAULT_CONCURRENCY = 4

_PROJECT_DIR = Path(__file__).resolve().parent
_CACHE_DIR = Path(
    os.getenv("AUDITOR_CACHE_DIR", _PROJECT_DIR / ".cache")
)
TRANSCRIPT_CACHE_DIR = _CACHE_DIR / "transcripts"


_anthropic_client_cache: Optional[Anthropic] = None
_gemini_client_cache = None
_client_lock = threading.Lock()


def _llm_provider() -> str:
    """Pick the primary LLM. Explicit LLM_PROVIDER env wins; otherwise
    prefer Gemini (generous free tier) if its key is set, else Claude.
    Ollama (local) is the implicit final fallback when reachable."""
    explicit = os.getenv("LLM_PROVIDER", "").strip().lower()
    if explicit:
        return explicit
    if os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"):
        return "gemini"
    if os.getenv("ANTHROPIC_API_KEY"):
        return "anthropic"
    return "ollama"


def _anthropic_model() -> str:
    return os.getenv("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL)


def _gemini_model() -> str:
    return os.getenv("GEMINI_MODEL", DEFAULT_GEMINI_MODEL)


def _ollama_base_url() -> str:
    return os.getenv("OLLAMA_BASE_URL", DEFAULT_OLLAMA_BASE_URL).rstrip("/")


def _ollama_model() -> str:
    return os.getenv("OLLAMA_MODEL", DEFAULT_OLLAMA_MODEL)


def ollama_reachable(timeout: float = 1.5) -> bool:
    """Quick health-check on the local Ollama server. Used by the UI for
    a status indicator; not used by evaluate() (which lets connection
    errors fail fast through the fallback chain)."""
    try:
        r = requests.get(f"{_ollama_base_url()}/api/tags", timeout=timeout)
        return r.ok
    except Exception:
        return False


def _language() -> str:
    return os.getenv("ASSEMBLYAI_LANGUAGE", DEFAULT_LANGUAGE)


def _effort() -> str:
    return os.getenv("EFFORT", DEFAULT_EFFORT)


def _concurrency() -> int:
    return int(os.getenv("MAX_CONCURRENCY", str(DEFAULT_CONCURRENCY)))


def find_recording_column(df) -> Optional[str]:
    """Locate the column holding recording URLs. Accepts any column name
    containing 'recording' plus 'link' or 'url' (case- and separator-
    insensitive): `recording_link`, `Recording URL`, `recordingUrl`,
    `Recording-Link`, etc."""
    for col in df.columns:
        s = str(col).lower()
        if "recording" in s and ("link" in s or "url" in s):
            return col
    return None


def _ensure_assemblyai_key():
    key = os.getenv("ASSEMBLYAI_API_KEY", "")
    if not key:
        raise RuntimeError("ASSEMBLYAI_API_KEY is not set in .env")
    aai.settings.api_key = key


def _get_anthropic_client() -> Anthropic:
    global _anthropic_client_cache
    with _client_lock:
        if _anthropic_client_cache is None:
            if not os.getenv("ANTHROPIC_API_KEY"):
                raise RuntimeError("ANTHROPIC_API_KEY is not set in .env")
            _anthropic_client_cache = Anthropic()
    return _anthropic_client_cache


def _get_gemini_client():
    global _gemini_client_cache
    with _client_lock:
        if _gemini_client_cache is None:
            api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
            if not api_key:
                raise RuntimeError(
                    "GOOGLE_API_KEY (or GEMINI_API_KEY) is not set in .env. "
                    "Get a free one at https://aistudio.google.com/apikey"
                )
            _gemini_client_cache = genai.Client(api_key=api_key)
    return _gemini_client_cache


def _gemini_schema() -> dict:
    """Gemini-compatible schema (uses `nullable` instead of anyOf-null,
    omits `additionalProperties` which Gemini ignores)."""
    score_block = {
        "type": "OBJECT",
        "properties": {
            "score": {"type": "INTEGER", "nullable": True},
            "rationale": {"type": "STRING"},
        },
        "required": ["score", "rationale"],
    }
    return {
        "type": "OBJECT",
        "properties": {
            "scores": {
                "type": "OBJECT",
                "properties": {d["key"]: score_block for d in RUBRIC_DIMENSIONS},
                "required": [d["key"] for d in RUBRIC_DIMENSIONS],
            },
            "overall_score": {"type": "INTEGER"},
            "summary": {"type": "STRING"},
            "strengths": {"type": "STRING"},
            "what_was_lacking": {"type": "STRING"},
            "improvement_recommendations": {
                "type": "ARRAY",
                "items": {"type": "STRING"},
            },
        },
        "required": [
            "scores",
            "overall_score",
            "summary",
            "strengths",
            "what_was_lacking",
            "improvement_recommendations",
        ],
    }


def _transcript_cache_path(target: str) -> Path:
    """Cache key = sha256(target + language) so different languages
    don't collide for the same audio."""
    digest = hashlib.sha256(
        f"{target}::{_language()}".encode("utf-8")
    ).hexdigest()[:24]
    return TRANSCRIPT_CACHE_DIR / f"{digest}.txt"


def transcribe(audio_url_or_path: str) -> str:
    """Transcribe via AssemblyAI with speaker diarization, with a disk
    cache so re-running the same recording (e.g. during calibration with
    a different preset) skips the slow + costly AssemblyAI call.
    Returns a timestamped transcript like:

        [00:03] Speaker A: Namaste sir, main XYZ se baat kar raha hoon...
        [00:08] Speaker B: Haan boliye.

    Disable the cache with `TRANSCRIPT_CACHE_DISABLED=true` in `.env`.
    Cache lives in `.cache/transcripts/` next to the project."""
    cache_disabled = (
        os.getenv("TRANSCRIPT_CACHE_DISABLED", "").strip().lower() == "true"
    )
    cache_path = None if cache_disabled else _transcript_cache_path(audio_url_or_path)
    if cache_path is not None and cache_path.exists():
        try:
            cached = cache_path.read_text(encoding="utf-8")
            if cached:
                return cached
        except OSError:
            pass

    transcript = _transcribe_assemblyai(audio_url_or_path)

    if cache_path is not None and transcript:
        try:
            TRANSCRIPT_CACHE_DIR.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(transcript, encoding="utf-8")
        except OSError:
            pass

    return transcript


def _transcribe_assemblyai(audio_url_or_path: str) -> str:
    _ensure_assemblyai_key()
    config = aai.TranscriptionConfig(
        speech_models=["universal"],
        speaker_labels=True,
        language_code=_language(),
        punctuate=True,
        format_text=True,
    )
    transcript = aai.Transcriber(config=config).transcribe(audio_url_or_path)

    if transcript.status == aai.TranscriptStatus.error:
        raise RuntimeError(f"AssemblyAI transcription failed: {transcript.error}")

    utterances = getattr(transcript, "utterances", None) or []
    if utterances:
        lines = []
        for u in utterances:
            secs = (u.start or 0) / 1000.0
            ts = f"[{int(secs // 60):02d}:{int(secs % 60):02d}]"
            lines.append(f"{ts} Speaker {u.speaker}: {u.text}")
        return "\n".join(lines)
    return transcript.text or ""


def clear_transcript_cache() -> int:
    """Delete every cached transcript. Returns the number of files removed."""
    if not TRANSCRIPT_CACHE_DIR.exists():
        return 0
    n = 0
    for p in TRANSCRIPT_CACHE_DIR.glob("*.txt"):
        try:
            p.unlink()
            n += 1
        except OSError:
            pass
    return n


def _provider_key_present(provider: str) -> bool:
    """Cheap check (no network) for whether a provider can be attempted.
    For ollama, we always include it in the chain unless explicitly
    disabled — its connection-refused error fails fast (~1ms) when
    the server isn't running."""
    if provider == "anthropic":
        return bool(os.getenv("ANTHROPIC_API_KEY"))
    if provider == "gemini":
        return bool(os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY"))
    if provider == "ollama":
        return os.getenv("OLLAMA_DISABLED", "").strip().lower() != "true"
    return False


def evaluate(
    transcript: str,
    preset: str = "general",
    strictness: str = "standard",
    custom_focus: str = "",
) -> dict:
    """Score the transcript against the rubric through a fallback chain:
    primary → other cloud provider (if key set) → local Ollama (if running).
    The chain stops at the first success. Disable fallback with
    `LLM_FALLBACK=false` in `.env`."""
    primary = _llm_provider()
    funcs = {
        "gemini": _evaluate_gemini,
        "anthropic": _evaluate_anthropic,
        "ollama": _evaluate_ollama,
    }
    if primary not in funcs:
        raise ValueError(f"Unknown LLM_PROVIDER: {primary!r}")

    fallback_enabled = (
        os.getenv("LLM_FALLBACK", "").strip().lower() != "false"
    )

    chain = [primary]
    if fallback_enabled:
        for p in ("gemini", "anthropic", "ollama"):
            if p != primary and _provider_key_present(p):
                chain.append(p)

    errors = []
    for i, provider in enumerate(chain):
        try:
            ev = funcs[provider](transcript, preset, strictness, custom_focus)
            ev["llm_provider"] = provider
            if errors:
                ev["llm_fallback_reason"] = "  →  ".join(errors)
            return ev
        except Exception as exc:
            errors.append(f"{provider}: {type(exc).__name__}: {exc}")

    raise RuntimeError("All LLMs failed.  " + "  →  ".join(errors))


def _ollama_schema() -> dict:
    """Schema for Ollama's structured-output mode. Same shape as
    output_schema() but without `additionalProperties` and `anyOf` —
    Ollama's JSON-schema parser is stricter and chokes on those.
    A null score is represented by omitting it (not allowed by required),
    so we make `score` non-nullable here and let the model use 1 if
    a dimension truly doesn't apply."""
    score_block = {
        "type": "object",
        "properties": {
            "score": {"type": "integer", "minimum": 1, "maximum": 5},
            "rationale": {"type": "string"},
        },
        "required": ["score", "rationale"],
    }
    return {
        "type": "object",
        "properties": {
            "scores": {
                "type": "object",
                "properties": {d["key"]: score_block for d in RUBRIC_DIMENSIONS},
                "required": [d["key"] for d in RUBRIC_DIMENSIONS],
            },
            "overall_score": {"type": "integer", "minimum": 1, "maximum": 5},
            "summary": {"type": "string"},
            "strengths": {"type": "string"},
            "what_was_lacking": {"type": "string"},
            "improvement_recommendations": {
                "type": "array",
                "items": {"type": "string"},
            },
        },
        "required": [
            "scores",
            "overall_score",
            "summary",
            "strengths",
            "what_was_lacking",
            "improvement_recommendations",
        ],
    }


def _evaluate_ollama(
    transcript: str, preset: str, strictness: str, custom_focus: str
) -> dict:
    """Local model via Ollama (http://localhost:11434 by default).
    Free, offline, no quota — lower quality than the cloud models, but
    Ollama's structured-output mode (passing a real JSON schema) keeps
    small models like qwen2.5:7b honest about producing all rubric fields.
    Set `OLLAMA_MODEL=...` in `.env` to pick a model (default: qwen2.5:7b).
    Set `OLLAMA_DISABLED=true` to skip Ollama in the fallback chain."""
    body = {
        "model": _ollama_model(),
        "messages": [
            {
                "role": "system",
                "content": system_prompt(preset, strictness, custom_focus),
            },
            {
                "role": "user",
                "content": (
                    f"<transcript>\n{transcript}\n</transcript>\n\n"
                    "Return the JSON evaluation. You MUST include the `scores` "
                    "object with all 10 dimensions: opening, language_match, "
                    "discovery, product_accuracy, objection_handling, "
                    "compliance, tone_empathy, flow, closing, goal."
                ),
            },
        ],
        "format": _ollama_schema(),
        "stream": False,
        "options": {"temperature": 0.2, "num_ctx": 16384},
    }
    r = requests.post(
        f"{_ollama_base_url()}/api/chat",
        json=body,
        timeout=900,
    )
    r.raise_for_status()
    data = r.json()
    text = (data.get("message") or {}).get("content", "")
    if not text:
        raise RuntimeError("Ollama returned an empty response")
    parsed = json.loads(text)
    # Defensive: a small model may still skip the scores block. Normalize
    # to the shape the rest of the code expects so downstream doesn't crash.
    if "scores" not in parsed or not isinstance(parsed.get("scores"), dict):
        raise RuntimeError(
            "Ollama returned no `scores` block — model may be too small "
            "for this rubric. Try OLLAMA_MODEL=qwen2.5:14b or a larger model."
        )
    return parsed


def _evaluate_anthropic(
    transcript: str, preset: str, strictness: str, custom_focus: str
) -> dict:
    client = _get_anthropic_client()
    user_content = (
        f"<transcript>\n{transcript}\n</transcript>\n\n"
        "Return the JSON evaluation per the schema."
    )
    resp = client.messages.create(
        model=_anthropic_model(),
        max_tokens=8000,
        thinking={"type": "adaptive"},
        output_config={
            "effort": _effort(),
            "format": {"type": "json_schema", "schema": output_schema()},
        },
        system=[
            {
                "type": "text",
                "text": system_prompt(preset, strictness, custom_focus),
                "cache_control": {"type": "ephemeral"},
            }
        ],
        messages=[{"role": "user", "content": user_content}],
    )
    text = next((b.text for b in resp.content if b.type == "text"), "")
    return json.loads(text)


def _evaluate_gemini(
    transcript: str, preset: str, strictness: str, custom_focus: str
) -> dict:
    client = _get_gemini_client()
    config = genai_types.GenerateContentConfig(
        system_instruction=system_prompt(preset, strictness, custom_focus),
        response_mime_type="application/json",
        response_schema=_gemini_schema(),
        temperature=0.2,
    )
    resp = client.models.generate_content(
        model=_gemini_model(),
        contents=(
            f"<transcript>\n{transcript}\n</transcript>\n\n"
            "Return the JSON evaluation."
        ),
        config=config,
    )
    text = (resp.text or "").strip()
    if not text:
        raise RuntimeError("Gemini returned an empty response")
    return json.loads(text)


def audit_one(
    target: str,
    is_url: bool,
    preset: str = "general",
    strictness: str = "standard",
    custom_focus: str = "",
) -> dict:
    """Audit a single recording. `target` is a URL or a local file path."""
    if not is_url and not Path(target).exists():
        raise FileNotFoundError(target)
    transcript = transcribe(target)
    evaluation = evaluate(transcript, preset, strictness, custom_focus)
    evaluation["transcript"] = transcript
    evaluation["preset"] = preset
    evaluation["strictness"] = strictness
    if custom_focus:
        evaluation["custom_focus"] = custom_focus
    return evaluation


def flatten_for_sheet(evaluation: dict) -> dict:
    row = {"audit_status": "ok"}
    scores = evaluation.get("scores", {})
    for d in RUBRIC_DIMENSIONS:
        s = scores.get(d["key"], {}) or {}
        row[f"score_{d['key']}"] = s.get("score", "")
        row[f"note_{d['key']}"] = s.get("rationale", "")
    row["overall_score"] = evaluation.get("overall_score", "")
    row["summary"] = evaluation.get("summary", "")
    row["strengths"] = evaluation.get("strengths", "")
    row["what_was_lacking"] = evaluation.get("what_was_lacking", "")
    row["recommendations"] = "\n".join(
        evaluation.get("improvement_recommendations", []) or []
    )
    row["preset"] = evaluation.get("preset", "")
    row["strictness"] = evaluation.get("strictness", "")
    row["llm_provider"] = evaluation.get("llm_provider", "")
    row["llm_fallback_reason"] = evaluation.get("llm_fallback_reason", "")
    row["transcript"] = evaluation.get("transcript", "")
    return row


def _read_sheet(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    return pd.read_excel(path)


def _write_sheet(df: pd.DataFrame, path: Path) -> None:
    if path.suffix.lower() == ".csv":
        df.to_csv(path, index=False)
    else:
        df.to_excel(path, index=False)


def audit_sheet(
    sheet_path: Path,
    out_path: Path,
    preset: str = "general",
    strictness: str = "standard",
    custom_focus: str = "",
) -> None:
    df = _read_sheet(sheet_path)
    rec_col = find_recording_column(df)
    if rec_col is None:
        sys.exit(
            "Error: input sheet must have a column containing 'recording' "
            "and 'link' or 'url' (e.g. recording_link, Recording URL). "
            f"Found: {list(df.columns)}"
        )

    if "audit_status" not in df.columns:
        df["audit_status"] = ""
    df["audit_status"] = df["audit_status"].fillna("").astype(str)

    todo = df.index[df["audit_status"].str.lower() != "ok"].tolist()
    provider = _llm_provider()
    model_name = _gemini_model() if provider == "gemini" else _anthropic_model()
    print(
        f"Auditing {len(todo)} of {len(df)} rows "
        f"(skipping {len(df) - len(todo)} already audited). "
        f"concurrency={_concurrency()}, llm={provider}/{model_name}, "
        f"language={_language()}, preset={preset}, strictness={strictness}"
    )

    def worker(idx):
        url = str(df.at[idx, rec_col]).strip()
        if not url or url.lower() in ("nan", "none", ""):
            return idx, {"audit_status": "skip", "summary": "no recording link"}
        try:
            ev = audit_one(url, True, preset, strictness, custom_focus)
            return idx, flatten_for_sheet(ev)
        except Exception as e:
            return idx, {
                "audit_status": "error",
                "summary": f"{type(e).__name__}: {e}",
            }

    save_every = max(5, len(todo) // 20)
    completed = 0
    with ThreadPoolExecutor(max_workers=_concurrency()) as ex:
        futures = {ex.submit(worker, i): i for i in todo}
        for fut in tqdm(as_completed(futures), total=len(futures), desc="audit"):
            idx, row = fut.result()
            for k, v in row.items():
                if k not in df.columns:
                    df[k] = ""
                df.at[idx, k] = v
            completed += 1
            if completed % save_every == 0:
                _write_sheet(df, out_path)

    _write_sheet(df, out_path)
    ok = (df["audit_status"] == "ok").sum()
    err = (df["audit_status"] == "error").sum()
    skip = (df["audit_status"] == "skip").sum()
    print(f"Done. ok={ok} error={err} skip={skip}  →  {out_path}")


def main():
    p = argparse.ArgumentParser(description="Audit AI-human call recordings.")
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument("--sheet", help="Path to xlsx/csv with a 'recording_link' column.")
    g.add_argument("--url", help="Single recording URL.")
    g.add_argument("--file", help="Single local audio file.")
    p.add_argument("--out", help="Output sheet path. Default: <input>_audited.<ext>")
    p.add_argument(
        "--preset",
        choices=list(AUDIT_PRESETS.keys()),
        default="general",
        help="Audit focus preset.",
    )
    p.add_argument(
        "--strictness",
        choices=["lenient", "standard", "strict"],
        default="standard",
    )
    p.add_argument(
        "--focus",
        default="",
        help="Free-text 'pay extra attention to X' instruction.",
    )
    args = p.parse_args()

    if args.sheet:
        sheet = Path(args.sheet)
        out = (
            Path(args.out)
            if args.out
            else sheet.with_name(f"{sheet.stem}_audited{sheet.suffix}")
        )
        audit_sheet(sheet, out, args.preset, args.strictness, args.focus)
        return

    target = args.url or args.file
    is_url = bool(args.url)
    ev = audit_one(target, is_url, args.preset, args.strictness, args.focus)
    print(json.dumps(ev, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
