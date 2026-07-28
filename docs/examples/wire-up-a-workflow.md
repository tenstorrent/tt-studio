# Wire up a workflow

## What you'll build

A multi-step pipeline assembled as a node graph — take a question, retrieve from your documents,
send both to a model, return the answer — without writing any code. Then save it as a template and
run it again.

## You'll need

- A deployed chat model. **Workflows** only appears in the navigation once one is healthy.
- A RAG collection, if you want to use the retrieval node. See
  [Chat with your documents](chat-with-your-documents.md).
- A Tavily API key, if you want the agent node to search the web. Set it under Settings.

## The nodes

| Node | What it does |
| :--- | :--- |
| **Input** | Where the run starts. Holds the question or text you feed in. |
| **RAG query** | Retrieves matching chunks from one of your collections. |
| **LLM** | Sends a prompt to a deployed model and returns the reply. |
| **Agent** | Hands the task to the agent service, which can search the web and run code in a sandbox. |
| **Output** | Where the run ends and the result is shown. |

## Steps

### 1. Open the canvas

Open **Workflows** and start a new workflow. The palette on the left holds the node types; drag one
onto the canvas to add it.

### 2. Build a retrieval-augmented chain

Drop an **Input**, a **RAG query**, an **LLM** and an **Output**, then connect them left to right.
Each node has a configuration panel — click it to set:

- **RAG query** — which collection to search. It picks your first collection automatically, so if
  you only have one there's nothing to do.
- **LLM** — which deployed model to use, and the prompt template that receives the retrieved
  context.

The editor will stop you connecting nodes in an order that can't run, and won't let you execute a
graph that's missing a required node.

### 3. Run it

Type a question into the input node and run the workflow. The execution panel shows progress, and
the edges change appearance as each step completes, so you can see where a run is and where it
stalled.

### 4. Save it as a template

Save the graph and it becomes a template you can start from next time. The toolbar shows the
template name and marks it when you have unsaved changes.

## Make it yours

**Add web search.** Swap the LLM node for an **Agent** node and the pipeline can search the web
through Tavily and run code in an E2B sandbox as part of answering. You'll need the API keys set
under Settings.

**Branch on the question.** Feed one input into two different models and compare their answers side
by side in separate output nodes.

**Try Canvas instead.** Canvas is the sibling feature: a chat that streams code and renders a live
preview as it writes. Where Workflows is for chaining models, Canvas is for building something you
can see while the model writes it. Both appear in the navigation once a chat model is healthy.

## Troubleshooting

**Workflows isn't in the navigation.** No healthy chat model. Deploy one first.

**A run won't start.** The graph is missing a required node or a connection — usually an output
node, or an unconnected input. The editor flags it.

**The RAG node returns nothing.** Confirm the collection actually has documents, and remember
collections are scoped per browser: a collection created in a different browser won't be visible
here.

## Next steps

- [Chat with your documents](chat-with-your-documents.md) — build the collection a RAG node needs
- [What you can build](../start/use-cases.md) — the rest of the surface
