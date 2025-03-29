import React, { useState } from "react";
import { ProcessInfo } from "../../types";

interface ProcessTreeProps {
  processes: ProcessInfo[];
  selectedProcessIds?: Set<number | string>;
  onProcessClick?: (process: ProcessInfo) => void;
  level?: number;
}

const ChevronRight = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M9.29 6.71a.996.996 0 0 0 0 1.41L13.17 12l-3.88 3.88a.996.996 0 1 0 1.41 1.41l4.59-4.59a.996.996 0 0 0 0-1.41L10.7 6.7c-.38-.38-1.02-.38-1.41.01z" />
  </svg>
);

const ChevronDown = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6 1.41-1.41z" />
  </svg>
);

const DragHandle = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <circle cx="8" cy="8" r="2" />
    <circle cx="16" cy="8" r="2" />
    <circle cx="8" cy="16" r="2" />
    <circle cx="16" cy="16" r="2" />
  </svg>
);

const ProcessTree: React.FC<ProcessTreeProps> = ({
  processes,
  selectedProcessIds = new Set(),
  onProcessClick,
  level = 0,
}) => {
  // Zustand für expandierte Prozesse - nur Root-Level ist standardmäßig expandiert
  const [expanded, setExpanded] = useState<Set<number>>(
    level === 0 ? new Set() : new Set()
  );

  const toggleExpanded = (processId: number, event: React.MouseEvent) => {
    event.stopPropagation();
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(processId)) {
        next.delete(processId);
      } else {
        next.add(processId);
      }
      return next;
    });
  };

  const handleProcessClick = (process: ProcessInfo) => {
    if (onProcessClick) {
      onProcessClick(process);
    }
  };

  // Drag & Drop Handlers
  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    process: ProcessInfo
  ) => {
    e.dataTransfer.setData("application", process.id.toString());
    e.currentTarget.classList.add("dragging");
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove("dragging");
  };

  return (
    <div className="process-tree">
      {processes.map((process) => {
        const hasChildren =
          (process.children && process.children.length > 0) ||
          (process.windows && process.windows.length > 0);
        const isExpanded = expanded.has(process.id);
        const isSelected = selectedProcessIds.has(process.id);

        return (
          <div key={process.id} className="process-node">
            {/* Process Item */}
            <div
              className={`process-item ${isSelected ? "selected" : ""} ${
                hasChildren ? "has-children" : ""
              }`}
              onClick={() => handleProcessClick(process)}
              draggable="true"
              onDragStart={(e) => handleDragStart(e, process)}
              onDragEnd={handleDragEnd}
            >
              {/* Expander oder Placeholder */}
              {hasChildren ? (
                <button
                  className="process-expander"
                  onClick={(e) => toggleExpanded(process.id, e)}
                >
                  {isExpanded ? <ChevronDown /> : <ChevronRight />}
                </button>
              ) : (
                <span className="process-expander-placeholder" />
              )}

              {/* Process Name und Title */}
              <span className="process-name">{process.name}</span>
              <span className="process-title">{process.title}</span>

              {/* Drag Handle */}
              <span className="process-drag-handle">
                <DragHandle />
              </span>
            </div>

            {/* Children */}
            {isExpanded && hasChildren && (
              <div className="process-children">
                {/* Rekursiver Aufruf für Unterprozesse */}
                {process.children && process.children.length > 0 && (
                  <ProcessTree
                    processes={process.children}
                    selectedProcessIds={selectedProcessIds}
                    onProcessClick={onProcessClick}
                    level={level + 1}
                  />
                )}

                {/* Windows des Prozesses */}
                {process.windows &&
                  process.windows.map((window) => (
                    <div
                      key={window.hwnd}
                      className={`window-item ${
                        selectedProcessIds.has(window.hwnd) ? "selected" : ""
                      }`}
                      onClick={() =>
                        onProcessClick?.({
                          ...process,
                          id: window.hwnd,
                          title: window.title,
                        })
                      }
                      draggable="true"
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "application",
                          `w${window.hwnd}`
                        );
                        e.currentTarget.classList.add("dragging");
                      }}
                      onDragEnd={(e) =>
                        e.currentTarget.classList.remove("dragging")
                      }
                    >
                      <span className="window-title">{window.title}</span>
                      <span className="process-drag-handle">
                        <DragHandle />
                      </span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ProcessTree;
