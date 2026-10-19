#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Shuaihan He
"""Filter DIA-NN main-report rows; never recompute protein quantities."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import math
import operator
from pathlib import Path
import platform

import pandas as pd

VERSION = "0.2.0"
OPS = {"<": operator.lt, "<=": operator.le, ">": operator.gt, ">=": operator.ge}


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def validate_config(cfg):
    allowed = {"schema_version", "description", "filters", "exclude_protein_group_contains", "minimum_distinct_peptides", "peptide_count_scope"}
    unknown = set(cfg) - allowed
    if unknown or cfg.get("schema_version") != 1:
        raise ValueError(f"Unsupported configuration keys/version: {sorted(unknown)}")
    if not isinstance(cfg.get("filters"), list) or not cfg["filters"]:
        raise ValueError("Provide at least one explicit numeric filter")
    for rule in cfg["filters"]:
        if not isinstance(rule, list) or len(rule) != 3:
            raise ValueError("Each filter must be [column, operator, numeric threshold]")
        col, op, value = rule
        if not isinstance(col, str) or not col or op not in OPS:
            raise ValueError(f"Unsupported column/operator: {rule}")
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            raise ValueError(f"Invalid numeric threshold: {rule}")
    minimum = cfg.get("minimum_distinct_peptides", 0)
    if type(minimum) is not int or minimum < 0:
        raise ValueError("minimum_distinct_peptides must be a nonnegative integer")
    if cfg.get("peptide_count_scope", "protein_group") not in {"protein_group", "run_protein_group"}:
        raise ValueError("peptide_count_scope must be protein_group or run_protein_group")
    patterns = cfg.get("exclude_protein_group_contains", [])
    if not isinstance(patterns, list) or any(not isinstance(p, str) or not p for p in patterns):
        raise ValueError("Contaminant tags must be nonempty literal strings")


def filter_report(frame, cfg):
    validate_config(cfg)
    required = {"Run", "Protein.Group", *(r[0] for r in cfg["filters"])}
    if cfg.get("minimum_distinct_peptides", 0):
        required.add("Stripped.Sequence")
    missing = required - set(frame.columns)
    if missing:
        raise ValueError(f"Missing required columns (no rules skipped): {sorted(missing)}")
    if frame.columns.duplicated().any():
        raise ValueError("Duplicate column names")
    for col in ["Run", "Protein.Group"]:
        if frame[col].isna().any() or frame[col].astype(str).str.strip().eq("").any():
            raise ValueError(f"Missing/blank identifiers: {col}")
    selected = pd.Series(True, index=frame.index)
    audit = []

    def record(label, mask, invalid=None):
        nonlocal selected
        before = int(selected.sum())
        invalid_in = int((selected & invalid).sum()) if invalid is not None else None
        selected &= mask.fillna(False)
        item = {"rule": label, "before": before, "after": int(selected.sum()), "removed": before - int(selected.sum())}
        if invalid_in is not None:
            item["missing_nonnumeric_or_nonfinite_in_incoming_rows"] = invalid_in
        audit.append(item)

    for col, op, threshold in cfg["filters"]:
        values = pd.to_numeric(frame[col], errors="coerce")
        finite = values.notna() & ~values.isin([float("inf"), -float("inf")])
        record(f"{col} {op} {threshold}", finite & OPS[op](values, threshold), ~finite)
    # Literal, case-sensitive tags, no regular-expression evaluation.
    for tag in cfg.get("exclude_protein_group_contains", []):
        record(f"Protein.Group excludes literal {tag!r}", ~frame["Protein.Group"].astype(str).str.contains(tag, regex=False))
    minimum = cfg.get("minimum_distinct_peptides", 0)
    if minimum:
        passed = frame.loc[selected]
        keys = ["Protein.Group"] if cfg.get("peptide_count_scope", "protein_group") == "protein_group" else ["Run", "Protein.Group"]
        # Modified forms/charge states of the same stripped peptide count once.
        peptide = passed["Stripped.Sequence"].astype("string").str.strip().replace("", pd.NA)
        counts = passed.assign(_peptide=peptide).groupby(keys, sort=False)["_peptide"].transform("nunique")
        keep = pd.Series(False, index=frame.index)
        keep.loc[passed.index] = counts.ge(minimum)
        record(f"distinct Stripped.Sequence >= {minimum}; scope={'+'.join(keys)}", keep)
    result = frame.loc[selected].copy()
    summary = {"input_rows": len(frame), "output_rows": len(result), "stages": audit,
               "input_protein_groups": int(frame["Protein.Group"].nunique()),
               "output_protein_groups": int(result["Protein.Group"].nunique()),
               "normalization": "none by this script", "imputation": "none", "aggregation": "none",
               "quantities": "preserved as reported; upstream PG.MaxLFQ not recalculated"}
    # Include runs with zero retained rows. Counts are rows and groups, not sums of intensities.
    runs = frame.groupby("Run", sort=False).size().rename("input_rows").to_frame()
    runs["output_rows"] = result.groupby("Run").size().reindex(runs.index, fill_value=0)
    runs["protein_groups"] = result.groupby("Run")["Protein.Group"].nunique().reindex(runs.index, fill_value=0)
    return result, summary, runs.reset_index()


def read_report(path):
    if path.suffix.lower() == ".parquet":
        return pd.read_parquet(path)
    if path.suffix.lower() in {".csv", ".tsv", ".txt"}:
        # Keep identifiers such as NA/NULL intact; only empty fields become missing.
        return pd.read_csv(path, sep="," if path.suffix.lower() == ".csv" else "\t",
                           keep_default_na=False, na_values=[""], dtype={"Run": "string", "Protein.Group": "string", "Stripped.Sequence": "string"})
    raise ValueError("Input must be .parquet, .csv or tab-delimited .tsv/.txt")


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--input", type=Path, required=True)
    cli.add_argument("--config", type=Path, required=True)
    cli.add_argument("--output-dir", type=Path, required=True, help="Must be a new directory")
    args = cli.parse_args()
    if args.output_dir.exists():
        cli.error("Output directory already exists; use a new name to preserve earlier results")
    cfg = json.loads(args.config.read_text(encoding="utf-8-sig"))
    validate_config(cfg)
    # Fail before writing on invalid input/schema/configuration.
    input_hash = sha256(args.input)
    frame = read_report(args.input)
    result, summary, runs = filter_report(frame, cfg)
    args.output_dir.mkdir(parents=True, exist_ok=False)
    out = args.output_dir / "filtered_report.parquet"
    result.to_parquet(out, index=False)
    runs.to_csv(args.output_dir / "run_counts.csv", index=False)
    (args.output_dir / "config.used.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
    summary.update({"script_version": VERSION, "utc": datetime.now(timezone.utc).isoformat(),
                    "input": str(args.input.resolve()), "input_sha256": input_hash,
                    "config_sha256": sha256(args.config), "script_sha256": sha256(__file__),
                    "output_sha256": sha256(out), "python": platform.python_version(),
                    "dependencies": {k: importlib.metadata.version(k) for k in ["pandas", "pyarrow"]}})
    (args.output_dir / "audit.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Rows: {len(frame)} -> {len(result)}; output: {args.output_dir}")


if __name__ == "__main__":
    main()
