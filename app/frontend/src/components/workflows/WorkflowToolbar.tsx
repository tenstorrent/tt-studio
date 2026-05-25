// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: © 2025 Tenstorrent AI ULC

import { useState } from "react";
import { Save, FolderOpen, FilePlus, Trash2, LayoutTemplate } from "lucide-react";
import { useWorkflowStore } from "../../store/workflowStore";
import type { Workflow } from "../../types/workflow";

export default function WorkflowToolbar() {
  const {
    currentWorkflow,
    workflows,
    templates,
    saveWorkflow,
    createWorkflow,
    deleteWorkflow,
    setCurrentWorkflow,
    loadFromTemplate,
  } = useWorkflowStore();

  const [showList, setShowList] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [newName, setNewName] = useState("");
  const [showNewDialog, setShowNewDialog] = useState(false);
  const [dialogMode, setDialogMode] = useState<"new" | "save">("new");

  const handleNew = () => {
    setDialogMode("new");
    setShowNewDialog(true);
    setNewName("Untitled Workflow");
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    await createWorkflow(newName.trim(), "", dialogMode === "new");
    setShowNewDialog(false);
    setNewName("");
  };

  const handleSave = async () => {
    if (!currentWorkflow) {
      setDialogMode("save");
      setShowNewDialog(true);
      setNewName("Untitled Workflow");
      return;
    }
    await saveWorkflow();
  };

  const handleOpen = (wf: Workflow) => {
    setCurrentWorkflow(wf);
    setShowList(false);
  };

  const handleDelete = async () => {
    if (!currentWorkflow) return;
    await deleteWorkflow(currentWorkflow.id);
  };

  const handleLoadTemplate = (tmpl: Workflow) => {
    loadFromTemplate(tmpl);
    setShowTemplates(false);
  };

  return (
    <div className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border-b border-zinc-800">
      {/* Workflow name */}
      <span className="text-sm font-medium text-zinc-300 mr-2 truncate max-w-48">
        {currentWorkflow?.name || "New Workflow"}
      </span>

      <div className="h-4 w-px bg-zinc-700" />

      {/* Action buttons */}
      <ToolbarButton icon={FilePlus} label="New" onClick={handleNew} />
      <ToolbarButton icon={Save} label="Save" onClick={handleSave} />
      <div className="relative">
        <ToolbarButton
          icon={FolderOpen}
          label="Open"
          onClick={() => {
            setShowList(!showList);
            setShowTemplates(false);
          }}
        />
        {showList && (
          <DropdownMenu
            items={workflows}
            onSelect={handleOpen}
            onClose={() => setShowList(false)}
            emptyLabel="No saved workflows"
          />
        )}
      </div>
      <div className="relative">
        <ToolbarButton
          icon={LayoutTemplate}
          label="Templates"
          onClick={() => {
            setShowTemplates(!showTemplates);
            setShowList(false);
          }}
        />
        {showTemplates && (
          <DropdownMenu
            items={templates}
            onSelect={handleLoadTemplate}
            onClose={() => setShowTemplates(false)}
            emptyLabel="No templates available"
          />
        )}
      </div>
      {currentWorkflow && (
        <ToolbarButton icon={Trash2} label="Delete" onClick={handleDelete} />
      )}

      {/* New workflow dialog */}
      {showNewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg p-6 w-96">
            <h3 className="text-sm font-semibold text-zinc-200 mb-4">
              {dialogMode === "save" ? "Save Workflow" : "Create New Workflow"}
            </h3>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              autoFocus
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded text-sm text-zinc-200 
                         focus:outline-none focus:ring-1 focus:ring-violet-500 mb-4"
              placeholder="Workflow name"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowNewDialog(false)}
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                className="px-3 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors"
              >
                {dialogMode === "save" ? "Save" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 
                 hover:bg-zinc-800 rounded transition-colors"
    >
      <Icon className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function DropdownMenu({
  items,
  onSelect,
  onClose,
  emptyLabel,
}: {
  items: Workflow[];
  onSelect: (wf: Workflow) => void;
  onClose: () => void;
  emptyLabel: string;
}) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 py-1 max-h-64 overflow-y-auto">
        {items.length === 0 ? (
          <p className="px-3 py-2 text-xs text-zinc-500">{emptyLabel}</p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              onClick={() => onSelect(item)}
              className="w-full text-left px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-800 transition-colors"
            >
              <p className="font-medium truncate">{item.name}</p>
              {item.description && (
                <p className="text-xs text-zinc-500 truncate">
                  {item.description}
                </p>
              )}
            </button>
          ))
        )}
      </div>
    </>
  );
}
