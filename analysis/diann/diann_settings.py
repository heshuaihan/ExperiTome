#!/usr/bin/env python3
# SPDX-License-Identifier: MIT
# Copyright (c) 2026 Shuaihan He
"""Extract explicitly logged DIA-NN CLI settings; do not infer GUI defaults."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

VERSION = "0.2.0"


def extract(text):
    command = next((line.strip() for line in text.splitlines()
                    if re.search(r"(?:^|[\\/\s\"])diann(?:\.exe)?(?:\"?\s).*?--", line, re.I)), None)
    if command is None:
        raise ValueError("No single-line DIA-NN CLI command found; retain the original log and record manually")
    # Split flags rather than spaces: Windows paths can contain unquoted spaces.
    matches = list(re.finditer(r"(?:^|\s)--([a-zA-Z0-9-]+)(?=\s|$)", command))
    flags = {}
    for i, match in enumerate(matches):
        end = matches[i + 1].start() if i + 1 < len(matches) else len(command)
        value = command[match.end():end].strip()
        flags.setdefault(match[1], []).append(value if value else True)
    version = re.search(r"DIA-NN\s+(\d+\.\d+(?:\.\d+)?)([^\r\n]*)", text)
    return {"extractor_version": VERSION, "diann_version": version[1] if version else None,
            "edition_text": version[2].strip() if version else None,
            "explicit_flags": flags, "input_file_count": len(flags.get("f", [])),
            "normalization": "disabled (--no-norm)" if "no-norm" in flags else "not inferred; verify pipeline/log",
            "mbr": "enabled (--reanalyse)" if "reanalyse" in flags else "not inferred; verify pipeline/log",
            "rt_profiling": "library IDs/RT/IM profiling; not intensity normalization" if "rt-profiling" in flags else "not explicitly flagged",
            "limitations": "Explicit CLI flags only; absent flags do not establish GUI defaults, quantification strategy, completion or successful analysis. Single-line commands only. Flag-like tokens inside paths require manual review. Output may contain private paths/run names."}


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--log", type=Path, required=True)
    cli.add_argument("--output", type=Path, required=True)
    args = cli.parse_args()
    result = extract(args.log.read_text(encoding="utf-8-sig", errors="strict"))
    result.update({"log_sha256": hashlib.sha256(args.log.read_bytes()).hexdigest(),
                   "utc": datetime.now(timezone.utc).isoformat()})
    # Exclusive create: never overwrite the original log or an earlier record.
    with args.output.open("x", encoding="utf-8") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
    print(f"DIA-NN {result['diann_version']}; {result['input_file_count']} files; {result['normalization']}")


if __name__ == "__main__":
    main()
