import React, { useState } from "react";
import { ProcessInfo } from "../../types";

interface ProcessTreeProps {
  processes: ProcessInfo[];
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, processId: number) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}

interface ProcessNodeProps {
  process: ProcessInfo;
  level: number;
  onDragStart?: (e: React.DragEvent<HTMLDivElement>, processId: number) => void;
  onDragEnd?: (e: React.DragEvent<HTMLDivElement>) => void;
}

const ProcessNode: React.FC<ProcessNodeProps> = ({
  process,
  level,
  onDragStart,
  onDragEnd,
}) => {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = process.children && process.children.length > 0;

  const toggleExpanded = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded(!expanded);
  };

  return (
    <div className="process-node">
      <div
        className={`process-item ${hasChildren ? "has-children" : ""}`}
        draggable
        onDragStart={(e) => onDragStart && onDragStart(e, process.id)}
        onDragEnd={onDragEnd}
      >
        {hasChildren && (
          <div className="process-expander" onClick={toggleExpanded}>
            {expanded ? "−" : "+"}
          </div>
        )}
        {!hasChildren && <div className="process-expander-placeholder"></div>}

        <div className="process-name">{process.title}</div>

        <div
          className="process-drag-handle"
          title="Ziehen, um zur Gruppe hinzuzufügen"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="drag-handle-icon"
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="8" cy="8" r="2" />
            <circle cx="16" cy="8" r="2" />
            <circle cx="8" cy="16" r="2" />
            <circle cx="16" cy="16" r="2" />
          </svg>
        </div>
      </div>

      {hasChildren && expanded && (
        <div className="process-children">
          {process.children!.map((child) => (
            <ProcessNode
              key={child.id}
              process={child}
              level={level + 1}
              onDragStart={onDragStart}
              onDragEnd={onDragEnd}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ProcessTree: React.FC<ProcessTreeProps> = ({
  processes,
  onDragStart,
  onDragEnd,
}) => {
  return (
    <div className="process-tree">
      {processes.map((process) => (
        <ProcessNode
          key={process.id}
          process={process}
          level={0}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
        />
      ))}
    </div>
  );
};

export default ProcessTree;
