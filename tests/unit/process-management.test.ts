import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEST_CONSTANTS } from "../setup";

describe("Process Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Prozess-Baum-Aufbau", () => {
    it("sollte flache Prozessliste zu Baum-Struktur konvertieren", () => {
      // Arrange
      const processes = [
        { id: 1000, name: "explorer", title: "Windows Explorer", parentId: 0 },
        { id: 1234, name: "chrome", title: "Google Chrome", parentId: 1000 },
        { id: 5678, name: "chrome", title: "Tab Process", parentId: 1234 },
        { id: 9012, name: "notepad", title: "Notepad", parentId: 1000 },
      ];

      // Act
      const processTree = buildProcessTree(processes);

      // Assert
      expect(processTree).toHaveLength(1); // Nur Root-Prozess
      expect(processTree[0].id).toBe(1000);
      expect(processTree[0].children).toHaveLength(2); // Chrome und Notepad

      const chromeProcess = processTree[0].children?.find((p) => p.id === 1234);
      expect(chromeProcess?.children).toHaveLength(1); // Tab Process
      expect(chromeProcess?.children?.[0].id).toBe(5678);
    });

    it("sollte Prozesse ohne Eltern als Root-Prozesse behandeln", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "standalone1", title: "Standalone App 1" },
        { id: 5678, name: "standalone2", title: "Standalone App 2" },
      ];

      // Act
      const processTree = buildProcessTree(processes);

      // Assert
      expect(processTree).toHaveLength(2);
      expect(processTree[0].children).toBeUndefined();
      expect(processTree[1].children).toBeUndefined();
    });

    it("sollte zirkuläre Referenzen handhaben", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "process1", title: "Process 1", parentId: 5678 },
        { id: 5678, name: "process2", title: "Process 2", parentId: 1234 },
      ];

      // Act & Assert
      expect(() => buildProcessTree(processes)).not.toThrow();
      const processTree = buildProcessTree(processes);
      expect(processTree).toHaveLength(2); // Beide als Root-Prozesse
    });
  });

  describe("Prozess-Identifikation", () => {
    it("sollte Prozess anhand der ID finden", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "notepad", title: "Notepad" },
        { id: 5678, name: "chrome", title: "Chrome" },
      ];

      // Act
      const foundProcess = findProcessById(processes, 5678);

      // Assert
      expect(foundProcess).toEqual({
        id: 5678,
        name: "chrome",
        title: "Chrome",
      });
    });

    it("sollte null zurückgeben wenn Prozess nicht gefunden", () => {
      // Arrange
      const processes = [{ id: 1234, name: "notepad", title: "Notepad" }];

      // Act
      const foundProcess = findProcessById(processes, 9999);

      // Assert
      expect(foundProcess).toBeNull();
    });

    it("sollte Prozess anhand des Namens finden", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "notepad", title: "Document.txt - Notepad" },
        { id: 5678, name: "chrome", title: "Google Chrome" },
        { id: 9012, name: "chrome", title: "Chrome - New Tab" },
      ];

      // Act
      const chromeProcesses = findProcessesByName(processes, "chrome");

      // Assert
      expect(chromeProcesses).toHaveLength(2);
      expect(chromeProcesses.map((p) => p.id)).toEqual([5678, 9012]);
    });

    it("sollte Prozess anhand des Titel-Patterns finden", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "notepad", title: "document.txt - Editor" },
        { id: 5678, name: "notepad", title: "readme.md - Editor" },
        { id: 9012, name: "chrome", title: "Google Chrome" },
      ];

      // Act
      const editorProcesses = findProcessesByTitlePattern(
        processes,
        "* - Editor"
      );

      // Assert
      expect(editorProcesses).toHaveLength(2);
      expect(editorProcesses.map((p) => p.id)).toEqual([1234, 5678]);
    });
  });

  describe("Prozess-Filterung", () => {
    it("sollte sichtbare Prozesse filtern", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "notepad", title: "Notepad", isVisible: true },
        { id: 5678, name: "background", title: "", isVisible: false },
        { id: 9012, name: "chrome", title: "Chrome", isVisible: true },
      ];

      // Act
      const visibleProcesses = filterVisibleProcesses(processes);

      // Assert
      expect(visibleProcesses).toHaveLength(2);
      expect(visibleProcesses.map((p) => p.id)).toEqual([1234, 9012]);
    });

    it("sollte Prozesse ohne Titel ausfiltern", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "notepad", title: "Notepad" },
        { id: 5678, name: "background", title: "" },
        { id: 9012, name: "service", title: "   " },
        { id: 3456, name: "chrome", title: "Chrome" },
      ];

      // Act
      const processesWithTitle = filterProcessesWithTitle(processes);

      // Assert
      expect(processesWithTitle).toHaveLength(2);
      expect(processesWithTitle.map((p) => p.id)).toEqual([1234, 3456]);
    });

    it("sollte System-Prozesse ausfiltern", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "notepad", title: "Notepad" },
        { id: 5678, name: "csrss", title: "Client Server Runtime" },
        { id: 9012, name: "winlogon", title: "Windows Logon" },
        { id: 3456, name: "chrome", title: "Chrome" },
      ];

      // Act
      const userProcesses = filterUserProcesses(processes);

      // Assert
      expect(userProcesses).toHaveLength(2);
      expect(userProcesses.map((p) => p.name)).toEqual(["notepad", "chrome"]);
    });
  });

  describe("Prozess-Gruppen-Management", () => {
    it("sollte verwandte Prozesse gruppieren", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "chrome", title: "Google Chrome" },
        { id: 5678, name: "chrome", title: "YouTube - Chrome" },
        { id: 9012, name: "chrome", title: "GitHub - Chrome" },
        { id: 3456, name: "notepad", title: "Notepad" },
      ];

      // Act
      const groups = groupRelatedProcesses(processes);

      // Assert
      expect(groups).toHaveProperty("chrome");
      expect(groups).toHaveProperty("notepad");
      expect(groups.chrome).toHaveLength(3);
      expect(groups.notepad).toHaveLength(1);
    });

    it("sollte Browser-Subprozesse identifizieren", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "chrome", title: "Google Chrome", parentId: 0 },
        { id: 5678, name: "chrome", title: "Renderer", parentId: 1234 },
        { id: 9012, name: "chrome", title: "GPU Process", parentId: 1234 },
      ];

      // Act
      const browserProcesses = identifyBrowserSubprocesses(processes);

      // Assert
      expect(browserProcesses.mainProcess.id).toBe(1234);
      expect(browserProcesses.subprocesses).toHaveLength(2);
      expect(browserProcesses.subprocesses.map((p) => p.id)).toEqual([
        5678, 9012,
      ]);
    });

    it("sollte Prozess-Hierarchie korrekt bestimmen", () => {
      // Arrange
      const processes = [
        { id: 1000, name: "explorer", title: "Windows Explorer", parentId: 0 },
        { id: 1234, name: "chrome", title: "Chrome", parentId: 1000 },
        { id: 5678, name: "chrome", title: "Tab", parentId: 1234 },
      ];

      // Act
      const hierarchy = getProcessHierarchy(processes, 5678);

      // Assert
      expect(hierarchy).toEqual([
        { id: 1000, name: "explorer", title: "Windows Explorer" },
        { id: 1234, name: "chrome", title: "Chrome" },
        { id: 5678, name: "chrome", title: "Tab" },
      ]);
    });
  });

  describe("Prozess-Überwachung", () => {
    it("sollte neue Prozesse erkennen", () => {
      // Arrange
      const oldProcesses = [
        { id: 1234, name: "notepad", title: "Notepad" },
        { id: 5678, name: "chrome", title: "Chrome" },
      ];

      const newProcesses = [
        { id: 1234, name: "notepad", title: "Notepad" },
        { id: 5678, name: "chrome", title: "Chrome" },
        { id: 9012, name: "calculator", title: "Calculator" },
      ];

      // Act
      const diff = compareProcessLists(oldProcesses, newProcesses);

      // Assert
      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].id).toBe(9012);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(0);
    });

    it("sollte beendete Prozesse erkennen", () => {
      // Arrange
      const oldProcesses = [
        { id: 1234, name: "notepad", title: "Notepad" },
        { id: 5678, name: "chrome", title: "Chrome" },
        { id: 9012, name: "calculator", title: "Calculator" },
      ];

      const newProcesses = [
        { id: 1234, name: "notepad", title: "Notepad" },
        { id: 5678, name: "chrome", title: "Chrome" },
      ];

      // Act
      const diff = compareProcessLists(oldProcesses, newProcesses);

      // Assert
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].id).toBe(9012);
      expect(diff.changed).toHaveLength(0);
    });

    it("sollte geänderte Prozesse erkennen", () => {
      // Arrange
      const oldProcesses = [
        { id: 1234, name: "notepad", title: "Untitled - Notepad" },
        { id: 5678, name: "chrome", title: "Chrome" },
      ];

      const newProcesses = [
        { id: 1234, name: "notepad", title: "document.txt - Notepad" },
        { id: 5678, name: "chrome", title: "Chrome" },
      ];

      // Act
      const diff = compareProcessLists(oldProcesses, newProcesses);

      // Assert
      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.changed).toHaveLength(1);
      expect(diff.changed[0].id).toBe(1234);
    });
  });

  describe("Fehlerbehandlung", () => {
    it("sollte leere Prozessliste handhaben", () => {
      // Act & Assert
      expect(() => buildProcessTree([])).not.toThrow();
      expect(buildProcessTree([])).toEqual([]);
    });

    it("sollte ungültige Prozess-IDs handhaben", () => {
      // Arrange
      const processes = [
        { id: -1, name: "invalid", title: "Invalid Process" },
        { id: 0, name: "system", title: "System" },
        { id: 1234, name: "valid", title: "Valid Process" },
      ];

      // Act
      const validProcesses = validateProcessList(processes);

      // Assert
      expect(validProcesses).toHaveLength(1);
      expect(validProcesses[0].id).toBe(1234);
    });

    it("sollte Prozesse mit fehlenden Eigenschaften handhaben", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "notepad" }, // Fehlt title
        { id: 5678, title: "Chrome" }, // Fehlt name
        { id: 9012, name: "complete", title: "Complete Process" },
      ];

      // Act
      const sanitizedProcesses = sanitizeProcessList(processes);

      // Assert
      expect(sanitizedProcesses).toHaveLength(3);
      expect(sanitizedProcesses[0].title).toBe(""); // Default title
      expect(sanitizedProcesses[1].name).toBe("Unknown"); // Default name
      expect(sanitizedProcesses[2]).toEqual({
        id: 9012,
        name: "complete",
        title: "Complete Process",
      });
    });
  });
});

// Hilfsfunktionen für Tests (vereinfachte Versionen der echten Funktionen)
function buildProcessTree(processes: any[]): any[] {
  // Erstelle eine Map für schnellen Lookup
  const processMap = new Map();
  const rootProcesses: any[] = [];

  // Initialisiere alle Prozesse mit leeren children Arrays
  processes.forEach((process) => {
    processMap.set(process.id, { ...process, children: [] });
  });

  // Baue den Baum auf
  processes.forEach((process) => {
    const processNode = processMap.get(process.id);

    // Prüfe auf zirkuläre Referenzen
    if (
      process.parentId &&
      process.parentId !== process.id &&
      process.parentId !== 0
    ) {
      const parent = processMap.get(process.parentId);
      if (
        parent &&
        parent.children &&
        !hasCircularReference(process.id, process.parentId, processMap)
      ) {
        parent.children.push(processNode);
      } else {
        // Bei zirkulärer Referenz oder fehlendem Parent als Root behandeln
        delete processNode.children; // Entferne children für Root-Prozesse ohne Kinder
        rootProcesses.push(processNode);
      }
    } else {
      // Prozess ohne Parent oder mit Parent = self/0 ist Root
      rootProcesses.push(processNode);
    }
  });

  // Bereinige leere children Arrays für Root-Prozesse
  rootProcesses.forEach((process) => {
    if (process.children && process.children.length === 0) {
      delete process.children;
    }
  });

  // Bereinige leere children Arrays für alle Prozesse rekursiv
  const cleanupChildren = (process: any) => {
    if (process.children) {
      process.children.forEach(cleanupChildren);
      if (process.children.length === 0) {
        delete process.children;
      }
    }
  };

  rootProcesses.forEach(cleanupChildren);

  return rootProcesses;
}

function hasCircularReference(
  processId: number,
  parentId: number,
  processMap: Map<any, any>
): boolean {
  const visited = new Set();
  let currentId = parentId;

  while (currentId && !visited.has(currentId)) {
    if (currentId === processId) {
      return true; // Zirkuläre Referenz gefunden
    }
    visited.add(currentId);
    const currentProcess = processMap.get(currentId);
    currentId = currentProcess?.parentId;
  }

  return false;
}

function findProcessById(processes: any[], id: number) {
  return processes.find((p) => p.id === id) || null;
}

function findProcessesByName(processes: any[], name: string) {
  return processes.filter((p) => p.name === name);
}

function findProcessesByTitlePattern(processes: any[], pattern: string) {
  const regex = new RegExp(pattern.replace(/\*/g, ".*"));
  return processes.filter((p) => regex.test(p.title));
}

function filterVisibleProcesses(processes: any[]) {
  return processes.filter((p) => p.isVisible);
}

function filterProcessesWithTitle(processes: any[]) {
  return processes.filter((p) => p.title && p.title.trim() !== "");
}

function filterUserProcesses(processes: any[]) {
  const systemProcesses = ["csrss", "winlogon", "services", "lsass", "svchost"];
  return processes.filter((p) => !systemProcesses.includes(p.name));
}

function groupRelatedProcesses(processes: any[]) {
  const groups: { [key: string]: any[] } = {};

  processes.forEach((process) => {
    if (!groups[process.name]) {
      groups[process.name] = [];
    }
    groups[process.name].push(process);
  });

  return groups;
}

function identifyBrowserSubprocesses(processes: any[]) {
  const mainProcess = processes.find((p) => p.parentId === 0 || !p.parentId);
  const subprocesses = processes.filter((p) => p.parentId === mainProcess?.id);

  return {
    mainProcess,
    subprocesses,
  };
}

function getProcessHierarchy(processes: any[], processId: number): any[] {
  const hierarchy: any[] = [];
  const processMap = new Map();

  // Erstelle eine Map für schnellen Lookup
  processes.forEach((process) => {
    processMap.set(process.id, process);
  });

  let currentProcess = processMap.get(processId);

  // Gehe die Hierarchie nach oben
  while (currentProcess) {
    // Entferne parentId aus dem Ergebnis-Objekt
    const { parentId, ...processWithoutParentId } = currentProcess;
    hierarchy.unshift(processWithoutParentId);

    if (currentProcess.parentId && currentProcess.parentId !== 0) {
      currentProcess = processMap.get(currentProcess.parentId);
    } else {
      break;
    }
  }

  return hierarchy;
}

function compareProcessLists(oldProcesses: any[], newProcesses: any[]) {
  const oldMap = new Map(oldProcesses.map((p) => [p.id, p]));
  const newMap = new Map(newProcesses.map((p) => [p.id, p]));

  const added = newProcesses.filter((p) => !oldMap.has(p.id));
  const removed = oldProcesses.filter((p) => !newMap.has(p.id));
  const changed = newProcesses.filter((p) => {
    const oldProcess = oldMap.get(p.id);
    return oldProcess && JSON.stringify(oldProcess) !== JSON.stringify(p);
  });

  return { added, removed, changed };
}

function validateProcessList(processes: any[]) {
  return processes.filter((p) => p.id > 0);
}

function sanitizeProcessList(processes: any[]) {
  return processes.map((p) => ({
    id: p.id,
    name: p.name || "Unknown",
    title: p.title || "",
    ...p,
  }));
}
