#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC
#
# Decide whether to disable HuggingFace Xet on THIS network.
# The throughput A/B is the real signal; pings are a rough sniff only.
# Requires a Python with huggingface_hub (+ hf_xet to test the Xet path):
#   pip install -U "huggingface_hub[hf_xet]"
# If your interpreter isn't python3/python, point HF_PY at it:
#   HF_PY=/path/to/venv/bin/python bash scripts/hf-xet-check.sh
#
# If "Xet disabled" is clearly faster, set HF_HUB_DISABLE_XET=1 in app/.env and
# re-run `python run.py`. See dev-docs/troubleshooting.md.
set -u
REPO="Qwen/Qwen3-0.6B"; FILE="model.safetensors"   # public, Xet-backed, large
CAP=25                                              # seconds per download sample

echo "=== Latency sniff (rough only) ==="
for h in huggingface.co cas-bridge.xethub.hf.co; do
  printf "%-28s " "$h"
  ping -c 5 -i 0.2 "$h" 2>/dev/null | tail -1 || echo "ping failed"
done
echo

PY=""
for cand in "${HF_PY:-}" python3 python; do
  [ -n "$cand" ] || continue
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -c "import huggingface_hub" 2>/dev/null; then
    PY="$cand"; break
  fi
done
if [ -z "$PY" ]; then
  echo "!! No python with huggingface_hub found."
  echo "   Install:  pip install -U 'huggingface_hub[hf_xet]'"
  echo "   Or set HF_PY=/path/to/venv/bin/python and re-run."
  exit 1
fi
echo "python : $PY ($("$PY" -c 'import huggingface_hub as h;print(h.__version__)'))"
if "$PY" -c "import hf_xet" 2>/dev/null; then echo "hf_xet : installed (Xet path testable)"
else echo "hf_xet : NOT installed — Xet is already effectively off here"; fi

DL='import os
from huggingface_hub import hf_hub_download
hf_hub_download(repo_id=os.environ["REPO"], filename=os.environ["FILE"], cache_dir=os.environ["CD"])'

sample () {  # $1 = "1" to disable Xet, else ""
  local cd err b; cd=$(mktemp -d)
  err=$( export REPO FILE CD="$cd"; [ -n "$1" ] && export HF_HUB_DISABLE_XET=1
         timeout "$CAP" "$PY" -c "$DL" 2>&1 >/dev/null )
  b=$(find "$cd" -type f -exec du -bc {} + 2>/dev/null | tail -1 | awk '{print $1}')
  rm -rf "$cd"
  [ "${b:-0}" -gt 0 ] 2>/dev/null || echo "   (sample error: ${err:-no bytes downloaded})" >&2
  awk -v b="${b:-0}" -v c="$CAP" 'BEGIN{printf "%.2f", b/c/1048576}'
}

echo
echo "=== Throughput A/B ($REPO/$FILE, ${CAP}s each) ==="
XET=$(sample "");   echo "Xet (default) : $XET MB/s"
LEG=$(sample "1");  echo "Xet disabled  : $LEG MB/s"

echo
awk -v x="$XET" -v l="$LEG" 'BEGIN{
  if (x==0 && l==0) { print "VERDICT: both samples got 0 bytes — see errors above (network/auth/proxy?)"; exit }
  if (x==0)        { print "VERDICT: set HF_HUB_DISABLE_XET=1 (Xet sample failed)"; exit }
  if (l==0)        { print "VERDICT: keep Xet (legacy sample failed)"; exit }
  if (l > x*1.3)      printf "VERDICT: set HF_HUB_DISABLE_XET=1  (legacy %.1fx faster)\n", l/x;
  else if (x > l*1.3) printf "VERDICT: keep Xet (unset)  (Xet %.1fx faster)\n", x/l;
  else                print "VERDICT: comparable — either is fine; keep default (Xet)";
}'
