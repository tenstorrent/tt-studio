// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2026 Tenstorrent AI ULC

import { useEffect } from "react";
import { ReactFlowProvider } from "@xyflow/react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "../components/ui/resizable";
import { useWorkflowStore } from "../store/workflowStore";
import WorkflowCanvas from "../components/workflows/WorkflowCanvas";
import NodePalette from "../components/workflows/NodePalette";
import NodeConfigPanel from "../components/workflows/NodeConfigPanel";
import WorkflowToolbar from "../components/workflows/WorkflowToolbar";
import ExecutionPanel from "../components/workflows/ExecutionPanel";
import { useFooterVisibility } from "../hooks/useFooterVisibility";

export default function WorkflowsPage() {
  const { loadWorkflows, loadTemplates, selectedNodeId, nodes, loadExampleWorkflow } =
    useWorkflowStore();
  const { setShowFooter } = useFooterVisibility();

  useEffect(() => {
    loadWorkflows();
    loadTemplates();
  }, [loadWorkflows, loadTemplates]);

  useEffect(() => {
    if (nodes.length === 0) {
      loadExampleWorkflow();
    }
  }, []);

  useEffect(() => {
    setShowFooter(false);
    return () => setShowFooter(true);
  }, [setShowFooter]);

  return (
    <ReactFlowProvider>
      <div className="fixed top-0 bottom-0 right-0 left-16 flex flex-col z-20">
        <WorkflowToolbar />
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0">
          <ResizablePanel defaultSize={15} minSize={10} maxSize={25}>
            <NodePalette />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={selectedNodeId ? 50 : 85} minSize={30}>
            <div className="flex flex-col h-full">
              <div className="flex-1 min-h-0">
                <WorkflowCanvas />
              </div>
              <ExecutionPanel />
            </div>
          </ResizablePanel>
          {selectedNodeId && (
            <>
              <ResizableHandle withHandle />
              <ResizablePanel defaultSize={35} minSize={25} maxSize={50}>
                <NodeConfigPanel />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </div>
    </ReactFlowProvider>
  );
}
