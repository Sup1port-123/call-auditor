"""Calibration harness — measure how well the LLM auditor agrees with humans.

Workflow:
1. A reviewer hand-grades 20-50 calls and saves a CSV/XLSX with columns:
       recording_link            (required)
       human_overall             (required, 1-5)
       human_<dimension_key>     (optional, per-rubric-dimension)
2. The harness runs the auditor on every call and computes:
       - n                  : number of comparable rows
       - mad                : mean absolute deviation, |llm - human|
       - pearson            : Pearson correlation between human and LLM
       - within_1_pct       : % of calls where |llm - human| <= 1
       - exact_pct          : % of calls where llm == human
       - mean_human / mean_llm : average scores (catches systematic bias)
3. Calls with overall deviation >= 2 are flagged — these are the prompt /
   rubric tuning targets.

A good calibration on overall_score: MAD < 0.7, % within 1 > 85%, Pearson > 0.7.
"""

from __future__ import annotations

import math
from typing import Iterable, Optional

import pandas as pd

from rubric import RUBRIC_DIMENSIONS


def _to_float(x) -> Optional[float]:
    try:
        v = float(x)
    except (TypeError, ValueError):
        return None
    if math.isnan(v):
        return None
    return v


def _pearson(xs: list, ys: list) -> Optional[float]:
    n = len(xs)
    if n < 2:
        return None
    mx = sum(xs) / n
    my = sum(ys) / n
    sx = sum((x - mx) ** 2 for x in xs) ** 0.5
    sy = sum((y - my) ** 2 for y in ys) ** 0.5
    if sx == 0 or sy == 0:
        return None
    cov = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    return cov / (sx * sy)


def compute_metrics(human: Iterable, llm: Iterable) -> dict:
    """Compute calibration stats from two parallel score columns. Rows where
    either side is missing/non-numeric are dropped."""
    pairs = [
        (h, l)
        for h, l in zip(
            (_to_float(x) for x in human),
            (_to_float(x) for x in llm),
        )
        if h is not None and l is not None
    ]
    if not pairs:
        return {"n": 0}
    h_vals = [p[0] for p in pairs]
    l_vals = [p[1] for p in pairs]
    diffs = [abs(l - h) for h, l in pairs]
    return {
        "n": len(pairs),
        "mad": sum(diffs) / len(diffs),
        "pearson": _pearson(h_vals, l_vals),
        "within_1_pct": sum(1 for d in diffs if d <= 1) / len(diffs) * 100,
        "exact_pct": sum(1 for d in diffs if d == 0) / len(diffs) * 100,
        "mean_human": sum(h_vals) / len(h_vals),
        "mean_llm": sum(l_vals) / len(l_vals),
    }


def per_dimension_metrics(df: pd.DataFrame) -> dict:
    """For each rubric dimension where the df has both human_<key> and
    score_<key>, return calibration metrics."""
    out = {}
    for d in RUBRIC_DIMENSIONS:
        h_col = f"human_{d['key']}"
        l_col = f"score_{d['key']}"
        if h_col in df.columns and l_col in df.columns:
            out[d["key"]] = {
                "name": d["name"],
                **compute_metrics(df[h_col], df[l_col]),
            }
    return out


def disagreements(df: pd.DataFrame, threshold: float = 2.0) -> pd.DataFrame:
    """Return rows where |llm - human| >= threshold on the overall score,
    sorted worst-first. The returned df has an extra `__diff` column."""
    if "human_overall" not in df.columns or "overall_score" not in df.columns:
        return df.iloc[0:0]
    h = pd.to_numeric(df["human_overall"], errors="coerce")
    l = pd.to_numeric(df["overall_score"], errors="coerce")
    diff = (l - h).abs()
    mask = diff >= threshold
    out = df[mask].copy()
    out["__diff"] = diff[mask]
    return out.sort_values("__diff", ascending=False)
