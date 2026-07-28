# A voice assistant that greets you by name

## What you'll build

Something you talk to. It sits idle until it hears a wake phrase, transcribes what you say, thinks
about it, and answers out loud — with the whole loop running on your own hardware. Add face
recognition and it greets you by name when you sit down.

## You'll need

Three models deployed and healthy:

- **Whisper** (`whisper-large-v3` or `distil-large-v3`) for speech-to-text
- **A chat model** for the reply
- **SpeechT5** for text-to-speech

:::{admonition} Check your board first
:class: warning

SpeechT5 targets N150, N300, P150 and P300x2 only. On a T3K there is no text-to-speech model in the
catalog, so you can build the listening half of the pipeline but it won't speak back. See
[Will it run on my machine?](../start/will-it-run.md).
:::

You'll also need a microphone, and the browser will ask for permission to use it.

## Steps

### 1. Deploy the three models

Deploy all three and wait for each to report healthy. **Voice Agent** only appears in the
navigation once the whole stack is up — if it's missing, one of the three isn't ready.

### 2. Have a conversation

Open **Voice Agent** and speak. The stage indicator walks through the pipeline as it runs:

`idle → recording → transcribing → thinking → speaking → done`

Recording stops on its own when you stop talking, so you don't need to press anything to finish a
turn. Conversations are kept in a sidebar so you can go back to earlier ones.

### 3. Turn on the wake word

A wake-word model ships with TT-Studio, so it works without downloading anything. The default
phrase is "hey quiet box".

```bash
WAKEWORD_MODEL=hey_quiet_box
WAKEWORD_THRESHOLD=0.3
```

Audio is streamed from the browser to the backend over a WebSocket and scored frame by frame; only
the wake event comes back. Lower the threshold if it isn't triggering, raise it if it fires at
random. To see the scores while you tune:

```bash
WAKEWORD_DEBUG_SCORES=true
```

### 4. Have it recognise you

Register a face on the **Face Recognition** page. The voice agent then greets a recognised user by
name when they appear, rather than starting cold.

## Make it yours

**Change its personality without redeploying.** The system prompt is editable in the voice agent's
settings while it's running. Change it, speak again, hear the difference.

**Find your bottleneck.** The metrics panel reports latency per stage. This is the most useful
thing on the page: a slow first response is usually the chat model, while a slow *start* is usually
transcription. Swapping `whisper-large-v3` for `distil-large-v3` trades a little accuracy for a
noticeably faster transcribe stage.

**Run it without the wake word.** Push-to-talk works fine and avoids false triggers in a noisy
room.

## Troubleshooting

**Voice Agent isn't in the navigation.** All three models must be deployed and healthy. Check which
one is missing on the deployed models page.

**The wake word never fires.** Confirm the microphone is permitted in the browser, then lower
`WAKEWORD_THRESHOLD` and turn on debug scores to see whether it's hearing anything at all. If the
backend reports the wake word as unavailable, the model file isn't on disk.

**It transcribes but never speaks.** Text-to-speech isn't deployed, or your board has no compatible
model — see the board warning above.

## Next steps

- [Batch-transcribe recordings](batch-transcribe-recordings.md) — use the speech models from a script
- [Wire up a workflow](wire-up-a-workflow.md) — chain models without writing code
