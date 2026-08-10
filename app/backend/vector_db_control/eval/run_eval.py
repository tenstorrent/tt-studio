# SPDX-License-Identifier: Apache-2.0
#
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

"""Retrieval eval for the /collections/retrieve pipeline.

Runs the QA set in qa_pairs.json against a running backend and reports
hit-rate@k per configuration, so retrieval changes are measured rather than
vibes-tested. Not wired into CI — run it manually:

    python vector_db_control/eval/run_eval.py --base-url http://localhost:8000
"""

import argparse
import json
import sys
from pathlib import Path

import requests

CONFIGS = {
    "full": [],
    "dense": ["rewrite", "hybrid", "rerank"],
    "no-rerank": ["rerank"],
}
DEFAULT_KS = (1, 3, 5)


def load_pairs(path: Path) -> list:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def retrieve(base_url: str, query: str, disable: list, top_k: int) -> dict:
    response = requests.post(
        f"{base_url}/collections/retrieve",
        json={
            "query_text": query,
            "collection": "tenstorrent_internal_knowledge",
            "top_k": top_k,
            "disable_stages": disable,
        },
        timeout=60,
    )
    response.raise_for_status()
    return response.json()


def is_hit(results: list, keywords: list, k: int) -> bool:
    """Hit@k: any single top-k result contains ALL expected keywords."""
    for result in results[:k]:
        text = (result.get("text") or "").lower()
        if all(kw.lower() in text for kw in keywords):
            return True
    return False


def run_config(name: str, pairs: list, base_url: str, disable: list, ks) -> dict:
    hits = {k: 0 for k in ks}
    latencies = []
    misses = []
    for pair in pairs:
        data = retrieve(base_url, pair["question"], disable, top_k=max(ks))
        results = data.get("results", [])
        latencies.append((data.get("meta") or {}).get("latency_ms") or 0)
        for k in ks:
            if is_hit(results, pair["expected_keywords"], k):
                hits[k] += 1
            elif k == max(ks):
                misses.append(pair["id"])
    n = len(pairs)
    return {
        "config": name,
        **{f"hit@{k}": f"{hits[k]}/{n} ({hits[k] / n:.0%})" for k in ks},
        "avg_ms": round(sum(latencies) / max(1, len(latencies))),
        "misses": misses,
    }


def print_table(rows: list, ks) -> None:
    columns = ["config"] + [f"hit@{k}" for k in ks] + ["avg_ms"]
    widths = {c: max(len(c), *(len(str(r[c])) for r in rows)) for c in columns}
    header = "  ".join(c.ljust(widths[c]) for c in columns)
    print(header)
    print("-" * len(header))
    for row in rows:
        print("  ".join(str(row[c]).ljust(widths[c]) for c in columns))
    for row in rows:
        if row["misses"]:
            print(f"\n[{row['config']}] missed@{max(ks)}: {', '.join(row['misses'])}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default="http://localhost:8000")
    parser.add_argument("--k", type=int, nargs="+", default=list(DEFAULT_KS))
    parser.add_argument(
        "--configs",
        default="full,dense",
        help=f"comma-separated subset of: {', '.join(CONFIGS)}",
    )
    args = parser.parse_args()

    pairs = load_pairs(Path(__file__).parent / "qa_pairs.json")
    ks = tuple(sorted(args.k))
    rows = []
    for name in args.configs.split(","):
        name = name.strip()
        if name not in CONFIGS:
            print(f"Unknown config {name!r}; choices: {', '.join(CONFIGS)}")
            return 2
        print(f"Running {name} ({len(pairs)} questions)...")
        try:
            rows.append(run_config(name, pairs, args.base_url, CONFIGS[name], ks))
        except requests.RequestException as e:
            print(f"Backend request failed: {e}")
            return 1
    print()
    print_table(rows, ks)
    return 0


if __name__ == "__main__":
    sys.exit(main())
