# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

"""
DAG executor for workflow graphs.

Parses the React Flow ``graph_data`` (nodes + edges), topologically sorts
them, and runs each node's handler in dependency order while piping outputs
between connected nodes.  All progress is yielded as SSE event dicts so the
view can stream them to the browser.
"""

import json
from graphlib import TopologicalSorter
from typing import AsyncGenerator

from django.utils import timezone

from shared_config.logger_config import get_logger

from .handlers import NODE_HANDLERS
from .models import WorkflowRun

logger = get_logger(__name__)


def _build_adjacency(graph_data: dict):
    """Return (node_map, predecessors) from React Flow graph_data.

    ``node_map``   – {node_id: node_dict}
    ``predecessors`` – {node_id: set(upstream_node_ids)}  for TopologicalSorter
    ``edge_map``   – {target_node_id: [source_node_ids]}  for wiring outputs
    """
    nodes = graph_data.get("nodes", [])
    edges = graph_data.get("edges", [])

    node_map = {n["id"]: n for n in nodes}
    predecessors: dict[str, set[str]] = {n["id"]: set() for n in nodes}
    edge_map: dict[str, list[str]] = {n["id"]: [] for n in nodes}

    for edge in edges:
        src = edge["source"]
        tgt = edge["target"]
        if tgt in predecessors:
            predecessors[tgt].add(src)
        if tgt in edge_map:
            edge_map[tgt].append(src)

    return node_map, predecessors, edge_map


def _sse_event(event_type: str, data: dict) -> str:
    """Format a single SSE ``data:`` line."""
    payload = {"event": event_type, **data}
    return f"data: {json.dumps(payload)}\n\n"


async def execute_workflow(
    workflow_graph: dict,
    initial_input: str,
    run: WorkflowRun,
) -> AsyncGenerator[str, None]:
    """Execute the workflow DAG and yield SSE-formatted strings.

    The caller (view) wraps this in a ``StreamingHttpResponse``.
    """
    run.status = WorkflowRun.Status.RUNNING
    run.started_at = timezone.now()
    await run.asave(update_fields=["status", "started_at"])

    yield _sse_event("run_started", {"run_id": str(run.id)})

    node_map, predecessors, edge_map = _build_adjacency(workflow_graph)

    if not node_map:
        run.status = WorkflowRun.Status.FAILED
        run.error = "Workflow has no nodes"
        run.completed_at = timezone.now()
        await run.asave(update_fields=["status", "error", "completed_at"])
        yield _sse_event("run_error", {"error": "Workflow has no nodes"})
        return

    sorter = TopologicalSorter(predecessors)
    try:
        order = list(sorter.static_order())
    except Exception as exc:
        run.status = WorkflowRun.Status.FAILED
        run.error = f"Invalid graph: {exc}"
        run.completed_at = timezone.now()
        await run.asave(update_fields=["status", "error", "completed_at"])
        yield _sse_event("run_error", {"error": str(exc)})
        return

    node_outputs: dict[str, str] = {}
    total = len(order)
    completed_count = 0

    for node_id in order:
        node = node_map[node_id]
        node_type = node.get("type", "unknown")
        config = node.get("data", {})

        handler = NODE_HANDLERS.get(node_type)
        if handler is None:
            logger.warning(f"No handler for node type '{node_type}', skipping {node_id}")
            node_outputs[node_id] = ""
            completed_count += 1
            continue

        # Wire upstream outputs into this node's inputs
        inputs: dict[str, str] = {}
        for src_id in edge_map.get(node_id, []):
            inputs[src_id] = node_outputs.get(src_id, "")

        # Inject the user's initial input for input nodes
        if node_type == "input":
            inputs["__initial_input__"] = initial_input

        yield _sse_event("node_started", {"node_id": node_id, "type": node_type})

        node_output = ""
        try:
            async for evt in handler(node_id, config, inputs, str(run.id)):
                event_type = evt.get("event", "")
                evt_node_id = evt.get("node_id", node_id)
                evt_data = evt.get("data", {})

                if event_type == "node_done":
                    node_output = evt_data.get("output", "")
                elif event_type == "node_error":
                    run.status = WorkflowRun.Status.FAILED
                    run.error = evt_data.get("error", "Unknown error")
                    run.completed_at = timezone.now()
                    await run.asave(update_fields=["status", "error", "completed_at"])
                    yield _sse_event("node_error", {
                        "node_id": evt_node_id,
                        "error": run.error,
                    })
                    yield _sse_event("run_error", {"error": run.error})
                    return

                # Forward all handler events to the client
                yield _sse_event(event_type, {
                    "node_id": evt_node_id,
                    **evt_data,
                })
        except Exception as exc:
            logger.error(f"Node {node_id} ({node_type}) failed: {exc}")
            run.status = WorkflowRun.Status.FAILED
            run.error = str(exc)
            run.completed_at = timezone.now()
            await run.asave(update_fields=["status", "error", "completed_at"])
            yield _sse_event("node_error", {"node_id": node_id, "error": str(exc)})
            yield _sse_event("run_error", {"error": str(exc)})
            return

        node_outputs[node_id] = node_output
        completed_count += 1
        yield _sse_event("node_completed", {
            "node_id": node_id,
            "progress": completed_count / total,
        })

    # Persist results
    run.status = WorkflowRun.Status.COMPLETED
    run.node_outputs = node_outputs
    run.completed_at = timezone.now()
    await run.asave(update_fields=["status", "node_outputs", "completed_at"])

    yield _sse_event("run_completed", {
        "run_id": str(run.id),
        "node_outputs": node_outputs,
    })
