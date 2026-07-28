# Batch-transcribe recordings

## What you'll build

A folder of audio files turned into a folder of transcripts, using Whisper on your own cards. This
is also the example that shows the UI isn't a cage: everything TT-Studio deploys is reachable over
a normal HTTP API, so anything you can do by clicking you can also do from a script.

## You'll need

- **`whisper-large-v3`** for accuracy, or **`distil-large-v3`** when throughput matters more.
  Both are marked complete and run on N150, N300, P150, P300x2, T3K and Galaxy.
- `curl` and a shell, or Python.

## Steps

### 1. Deploy a Whisper model

Deploy one of the two. If you're transcribing hours of audio, start with `distil-large-v3` — it's
meaningfully faster and the accuracy difference is small for clean recordings.

### 2. Try one file in the UI

Open **Speech to Text**, upload a single recording, and check the result. Do this before scripting
anything: it confirms the model is healthy and shows you what the output looks like.

### 3. Find the endpoint

Open the **API info** page for the deployed model. It gives you the exact base URL, the route, and
a ready-made request you can copy. The transcription route follows the OpenAI convention:

```
POST /v1/audio/transcriptions
```

### 4. Loop over the folder

```bash
#!/usr/bin/env bash
# Transcribe every audio file in ./recordings into ./transcripts.
set -euo pipefail

ENDPOINT="http://localhost:7000/v1/audio/transcriptions"   # from the API info page
mkdir -p transcripts

for f in recordings/*.{wav,mp3,m4a}; do
  [ -e "$f" ] || continue
  out="transcripts/$(basename "${f%.*}").txt"
  echo "→ $(basename "$f")"
  curl -sS -X POST "$ENDPOINT" \
    -F "file=@${f}" \
    -F "model=whisper-large-v3" \
    | python3 -c 'import json,sys; print(json.load(sys.stdin)["text"])' \
    > "$out"
done

echo "done: $(ls transcripts | wc -l) transcripts"
```

Take the port from the API info page rather than assuming it — each deployed model gets its own,
starting at 7000.

## Make it yours

**Run several at once.** Whisper requests are independent, so `xargs -P 4` over the same loop will
keep the card busier than a serial loop. Watch the board telemetry and back off if it saturates.

**Use the Python SDK.** The endpoint is OpenAI-compatible, so the `openai` package works against it
directly — point `base_url` at your model and pass any string as the key.

**Feed it into a summariser.** Chain the transcript into a deployed chat model to get summaries or
action items. If you'd rather build that visually, see
[Wire up a workflow](wire-up-a-workflow.md).

## Troubleshooting

**Connection refused.** The port belongs to the model container, not the backend. Re-check the API
info page — it changes per deployment.

**Empty transcripts.** Confirm the file actually has audio and is in a format ffmpeg can read. Very
long single files are better split into chunks.

**It's slower than expected.** `distil-large-v3` is the faster of the two. Also check nothing else
is deployed and competing for the same chips.

## Next steps

- [A voice assistant that greets you by name](voice-assistant-that-knows-you.md) — the interactive version
- [Point a coding agent at your own box](coding-agent-on-your-own-box.md) — the same API-first idea, for chat
