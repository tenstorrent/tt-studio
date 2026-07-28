# Examples

Each example is a complete path from a running TT-Studio to a working thing. They all assume you've
been through the [Quickstart](../start/quickstart.md) and have the app open at
`http://localhost:3000`.

The "You'll need" column names the models and the minimum board, so you can tell before you start
whether your hardware can finish.

| Example | What you end up with | You'll need |
| :--- | :--- | :--- |
| [Chat with your documents](chat-with-your-documents.md) | An assistant that answers from your own PDFs and notes | Any chat model |
| [Point a coding agent at your own box](coding-agent-on-your-own-box.md) | Claude Code or OpenCode running on your hardware | Llama-3.1-8B-Instruct or larger |
| [A voice assistant that greets you by name](voice-assistant-that-knows-you.md) | Speak to it, it speaks back | Whisper, a chat model, SpeechT5 |
| [Batch-transcribe recordings](batch-transcribe-recordings.md) | A folder of audio turned into text | Whisper |
| [Generate images and video](generate-images-and-video.md) | Images, and video if your board is big enough | SDXL; FLUX and video need T3K or bigger |
| [Run without a Tenstorrent card](run-without-a-tenstorrent-card.md) | A working TT-Studio on a laptop | No accelerator |
| [Wire up a workflow](wire-up-a-workflow.md) | A multi-step pipeline built as a node graph | A chat model |
| [Deploy a model in one command](unattended-deploy.md) | A box that comes up with a model already running | Any supported model |

:::{tip}
Not sure what your board can run? The table in
[Will it run on my machine?](../start/will-it-run.md) breaks it down per board and modality.
:::

```{toctree}
:hidden:
:maxdepth: 1

chat-with-your-documents
coding-agent-on-your-own-box
voice-assistant-that-knows-you
batch-transcribe-recordings
generate-images-and-video
run-without-a-tenstorrent-card
wire-up-a-workflow
unattended-deploy
```
