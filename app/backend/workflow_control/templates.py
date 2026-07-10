# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
Preset workflow template definitions.

Each template is a ``graph_data`` dict in React Flow format (nodes + edges).
These are seeded as ``Workflow(is_template=True)`` rows on first startup via
``seed_templates()``.
"""

from shared_config.logger_config import get_logger

logger = get_logger(__name__)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NODE_DEFAULTS = {
    "input": {"label": "User Input", "text": ""},
    "output": {"label": "Output"},
    "llm": {"label": "LLM", "prompt_template": "{input}", "temperature": 0.7, "max_tokens": 1024},
    "rag_query": {"label": "RAG Query", "collection_name": "", "n_results": 5},
    "agent": {"label": "Agent", "goal": "", "thread_id": ""},
}


def _node(node_id: str, node_type: str, x: int, y: int, **data_overrides):
    base = dict(_NODE_DEFAULTS.get(node_type, {}))
    base.update(data_overrides)
    return {
        "id": node_id,
        "type": node_type,
        "position": {"x": x, "y": y},
        "data": base,
    }


def _edge(source: str, target: str):
    return {
        "id": f"e-{source}-{target}",
        "source": source,
        "target": target,
    }


# ---------------------------------------------------------------------------
# Template definitions
# ---------------------------------------------------------------------------

RESEARCH_BRIEFING = {
    "name": "Research Briefing",
    "description": "Agent searches the web and RAG, then an LLM summarises the findings.",
    "graph_data": {
        "nodes": [
            _node("input-1", "input", 0, 200, label="Research Topic"),
            _node("agent-1", "agent", 300, 200, label="Research Agent", goal="Research this topic thoroughly and extract key findings."),
            _node("llm-1", "llm", 600, 200, label="Summariser", prompt_template="Summarise the following research findings into a clear briefing:\n\n{input}"),
            _node("output-1", "output", 900, 200, label="Briefing"),
        ],
        "edges": [
            _edge("input-1", "agent-1"),
            _edge("agent-1", "llm-1"),
            _edge("llm-1", "output-1"),
        ],
    },
}

DOCUMENT_PROCESSOR = {
    "name": "Document Processor",
    "description": "Query a RAG collection and extract key information with an LLM.",
    "graph_data": {
        "nodes": [
            _node("input-1", "input", 0, 200, label="Query"),
            _node("rag-1", "rag_query", 300, 200, label="Document Search", n_results=5),
            _node("llm-1", "llm", 600, 200, label="Extractor", prompt_template="Based on the following documents, extract the key information relevant to the query:\n\n{input}"),
            _node("output-1", "output", 900, 200, label="Extracted Info"),
        ],
        "edges": [
            _edge("input-1", "rag-1"),
            _edge("rag-1", "llm-1"),
            _edge("llm-1", "output-1"),
        ],
    },
}

QA_PIPELINE = {
    "name": "Q&A Pipeline",
    "description": "Answer questions using RAG-retrieved context and an LLM.",
    "graph_data": {
        "nodes": [
            _node("input-1", "input", 0, 200, label="Question"),
            _node("rag-1", "rag_query", 300, 200, label="Context Retrieval", n_results=5),
            _node("llm-1", "llm", 600, 200, label="Answer Generator", prompt_template="Answer the following question using the provided context. If the context does not contain enough information, say so.\n\nContext:\n{input}"),
            _node("output-1", "output", 900, 200, label="Answer"),
        ],
        "edges": [
            _edge("input-1", "rag-1"),
            _edge("rag-1", "llm-1"),
            _edge("llm-1", "output-1"),
        ],
    },
}

ALL_TEMPLATES = [RESEARCH_BRIEFING, DOCUMENT_PROCESSOR, QA_PIPELINE]


def seed_templates():
    """Create template Workflow rows if they don't already exist."""
    from .models import Workflow

    for tmpl in ALL_TEMPLATES:
        _, created = Workflow.objects.get_or_create(
            name=tmpl["name"],
            is_template=True,
            defaults={
                "description": tmpl["description"],
                "graph_data": tmpl["graph_data"],
            },
        )
        if created:
            logger.info(f"Seeded workflow template: {tmpl['name']}")
