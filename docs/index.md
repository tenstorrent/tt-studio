# TT-Studio

::::{container} hero

<div class="hero-copy">
<p class="hero-eyebrow">TT-Studio</p>
<h1 class="hero-title">Run local AI on your <span>Tenstorrent</span> hardware.</h1>
<p class="hero-lede">Deploy language models, voice agents, and image and video generation
through one interface — privately, on hardware you own, without paying for tokens.</p>
</div>

:::{container} hero-cta
[Get started](start/quickstart.md) [What is TT-Studio?](start/what-is-tt-studio.md)
:::

::::

## Up and running in one command

```bash
tt-studio
```

That's once it's installed. From a fresh clone it's `python3 run.py`, which fetches the inference
server artifact, writes your configuration, picks the right Docker overlays for your hardware, and
brings up the whole stack. See the [Quickstart](start/quickstart.md).

## One stack. Every modality.

Everything you need to deploy, talk to, and build on AI models, running on your own cards.

:::{list-table}
:class: tt-feature-cards
:widths: 33 33 34

* - Chat with language models

    Deploy a model and start talking. Llama, Qwen, Mistral and more, served from your cards.
  - Voice agent

    Speak and listen, with a bundled wake word and per-stage latency you can actually see.
  - Media generation

    FLUX, Stable Diffusion and Wan video, generated entirely on-device.
* - Retrieval over your documents

    Ask questions about your own PDFs and notes. Nothing is uploaded anywhere.
  - Your box as an endpoint

    Point Claude Code, OpenCode or any OpenAI-compatible client at your own hardware.
  - No card? Still works

    Use models running on cards elsewhere, or exercise the whole stack on CPU.
:::

## Start here

:::{list-table}
:class: tt-index-cards
:widths: 33 33 34

* - [What is TT-Studio?](start/what-is-tt-studio.md)

    What it does, where it sits in the Tenstorrent stack, and when to use something else instead.
  - [Will it run on my machine?](start/will-it-run.md)

    Supported boards, what's deployable on each, and the two paths if you have no hardware.
  - [Quickstart](start/quickstart.md)

    From clone to a model answering questions, in about ten minutes.
:::

## Explore the docs

:::{list-table}
:class: tt-index-cards
:widths: 50 50

* - [What you can build](start/use-cases.md)

    The jobs people use TT-Studio for, and the features behind each one.
  - [Examples](examples/index.md)

    Eight worked walkthroughs, from document retrieval to unattended deployment.
* - [Architecture Overview](architecture.md)

    How the frontend, backend, gateway and control services fit together.
  - [Backend Services](backend/index.md)

    The Django app: container control, model control, board telemetry, vector store, logs.
* - [Docker Control Service](docker-control-service/index.md)

    The host-side proxy that manages containers, and its security model.
  - [AI Agent Service](agent/index.md)

    Model discovery, health monitoring, and the agent's tool integrations.
* - [Frontend Application](frontend/index.md)

    App shell, chat, deployment, retrieval and the specialised model interfaces.
  - [Model Integration](model-integration/index.md)

    The model catalog and configuration schema, and the reference echo model.
* - [Setup reference](start/setup-reference.md)

    Prerequisites, environment configuration, hardware detection and run modes.
  - [Glossary](glossary.md)

    Terms used across TT-Studio and the wider Tenstorrent stack.
:::

## Other resources

More open-source tools from Tenstorrent.

:::{list-table}
:class: tt-index-cards
:widths: 33 33 34

* - [TT Developer Toolkit](https://docs.tenstorrent.com/tt-vscode-toolkit/)

    Interactive AI lessons, hardware monitoring, and production inference templates, all inside
    your editor.
  - [tt-toplike](https://docs.tenstorrent.com/tt-toplike/)

    A psychedelic, ASCII-native terminal monitor for Tenstorrent Blackhole and Wormhole hardware.
  - [tt-local-generator](https://docs.tenstorrent.com/tt-local-generator/)

    Local AI image and video generation for builders, running entirely on your own hardware.
:::

```{toctree}
:hidden:
:caption: Start here
:maxdepth: 2

start/what-is-tt-studio
start/use-cases
start/will-it-run
start/quickstart
start/setup-reference
```

```{toctree}
:hidden:
:caption: How it works
:maxdepth: 2

architecture
backend/index
docker-control-service/index
agent/index
frontend/index
model-integration/index
```

```{toctree}
:hidden:
:caption: Reference
:maxdepth: 2

glossary
contributing
```

```{toctree}
:hidden:
:caption: Examples
:maxdepth: 2

examples/index
```
