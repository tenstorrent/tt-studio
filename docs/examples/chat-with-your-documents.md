# Chat with your documents

## What you'll build

An assistant that answers from your own material — a folder of PDFs, a set of internal notes, a
codebase — instead of from whatever it memorised during training. Nothing is uploaded anywhere: the
documents are chunked and embedded by a ChromaDB instance running in your own stack, and the
retrieved passages are passed to a model on your own cards.

## You'll need

- A deployed chat model. Llama-3.1-8B-Instruct is enough and runs on any board from an N150 up.
- Documents in one of the supported formats: `.pdf`, `.txt`, `.docx`, `.md`, `.html`, or source
  files (`.py`, `.js`, `.ts`, `.tsx`, `.jsx`).

## Steps

### 1. Create a collection and upload

Open **RAG Management** from the navigation and drop a file onto the upload area. Creating the
collection and ingesting the first document happen in one step — you don't need to set the
collection up first.

Behind the scenes each document is split into roughly 1,000-character chunks with a 100-character
overlap, and each chunk is embedded and stored. Larger PDFs take a few seconds.

Add the rest of your documents to the same collection. Collection names must be unique; you'll get
a toast if you reuse one.

### 2. Ask questions against it

Open **Chat**, pick your model, and select the collection you just created. Ask something that can
only be answered from your documents — a specific figure, a policy detail, a function name.

The relevant chunks are retrieved and prepended to your prompt as context, so the model answers
from your material rather than guessing.

### 3. Tighten it when answers drift

If the model starts answering from general knowledge, or citing passages that aren't really
relevant, the retrieval is matching too loosely. Set a relevance threshold:

```bash
RAG_RELEVANCE_THRESHOLD=0.6
```

This is a maximum cosine distance — results further away than the threshold are dropped rather than
passed to the model. Lower it to be stricter. You can also pass `max_distance` per query if you're
calling the API directly.

## Make it yours

**Separate collections per topic.** Retrieval quality drops when one collection mixes unrelated
material. A collection per project or per document set works better than one large one.

**Know about the built-in Tenstorrent corpus.** TT-Studio ships a shared collection of Tenstorrent
documentation that is merged into query results alongside your own. If you ask a hardware question
and get a confident, accurate answer you didn't upload, that's where it came from — not a
hallucination.

**Administer across users.** The RAG admin page lists every collection on the instance, not just
your own. It's password-protected via `RAG_ADMIN_PASSWORD`.

## Troubleshooting

:::{warning} Your collections vanished
Collections are scoped per browser. If you switched browsers, opened a private window, or cleared
site data, you're a different user as far as the backend is concerned and you'll see an empty list.
The data is still there — the admin page can see it.
:::

**Upload succeeds but the collection stays empty.** Check the file extension is in the supported
list. Scanned PDFs with no text layer produce no chunks; run OCR over them first.

**Answers ignore the documents entirely.** Confirm the collection is actually selected in the chat
page — it isn't sticky across sessions.

## Next steps

- [Wire up a workflow](wire-up-a-workflow.md) — use retrieval as a step in a larger pipeline
- [What you can build](../start/use-cases.md) — the other jobs TT-Studio covers
