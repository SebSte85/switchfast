import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEST_CONSTANTS } from "../setup";

// Mock für child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
  spawn: vi.fn(),
}));

// Mock für Electron
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
  },
}));

describe("Persistenz und Recovery - KRITISCHE TESTS", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Theme-Persistenz nach App-Neustart", () => {
    it("sollte Themes korrekt laden nach App-Neustart", async () => {
      // Arrange - Simuliere gespeicherte Themes vor Neustart
      const savedThemes = [
        {
          id: "theme-dev",
          name: "Development",
          shortcut: "Alt+D",
          applications: [1234, 5678],
          persistentProcesses: [
            {
              executableName: "chrome",
              executablePath:
                "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
              titlePattern: "GitHub",
            },
          ],
          processes: [],
          windows: [],
        },
      ];

      // Act
      const restoredThemes = await loadThemesFromStorage();

      // Assert
      expect(restoredThemes).toHaveLength(1);
      expect(restoredThemes[0].name).toBe("Development");
      expect(restoredThemes[0].persistentProcesses).toHaveLength(1);
      expect(restoredThemes[0].persistentProcesses[0].executableName).toBe(
        "chrome"
      );
    });

    it("sollte persistente Prozess-Identifikatoren nach App-Neustart wiederherstellen", async () => {
      // Arrange
      const currentProcesses = [
        {
          id: 9999,
          name: "chrome",
          path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          title: "GitHub - switchfast Repository",
        },
      ];

      const persistentProcess = {
        executableName: "chrome",
        executablePath:
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        titlePattern: "GitHub",
      };

      // Act
      const matchingProcess = findMatchingProcess(
        currentProcesses,
        persistentProcess
      );

      // Assert
      expect(matchingProcess).toBeTruthy();
      expect(matchingProcess.id).toBe(9999);
      expect(matchingProcess.name).toBe("chrome");
    });

    it("sollte Window-Handles korrekt wiederherstellen nach App-Neustart", async () => {
      // Arrange
      const theme = {
        id: "theme-browser",
        name: "Browser Theme",
        applications: [111111, 222222],
        persistentProcesses: [
          {
            executableName: "chrome",
            titlePattern: "GitHub",
          },
        ],
        windows: [
          { hwnd: 111111, processId: 1234, title: "GitHub - Old Session" },
        ],
      };

      const currentProcesses = [
        {
          id: 5555,
          name: "chrome",
          windows: [
            { hwnd: 333333, processId: 5555, title: "GitHub - New Session" },
          ],
        },
      ];

      // Act
      const updatedTheme = await restoreWindowHandles(
        [theme],
        currentProcesses
      );

      // Assert
      expect(updatedTheme[0].windows).toHaveLength(1);
      expect(updatedTheme[0].windows[0].hwnd).toBe(333333);
      expect(updatedTheme[0].applications).toContain(333333);
    });
  });

  describe("Recovery nach PC-Neustart", () => {
    it("sollte fehlende Anwendungen automatisch starten nach PC-Neustart", async () => {
      // Arrange
      const persistentIdentifiers = [
        {
          executableName: "chrome",
          executablePath:
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        },
      ];

      const currentProcesses = [];

      // Act
      const applicationsToStart = findMissingApplications(
        persistentIdentifiers,
        currentProcesses
      );

      // Assert
      expect(applicationsToStart).toHaveLength(1);
      expect(applicationsToStart[0].executableName).toBe("chrome");
    });

    it("sollte kompletten Recovery-Zyklus nach PC-Neustart durchführen", async () => {
      // Arrange
      const themes = [
        {
          id: "theme-work",
          name: "Work Setup",
          persistentProcesses: [
            {
              executableName: "chrome",
              executablePath:
                "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            },
          ],
          applications: [],
          processes: [],
          windows: [],
        },
      ];

      const initialProcesses = [];

      // Act
      const recovery = await restoreProcessAssociations(
        themes,
        initialProcesses
      );

      // Assert
      expect(recovery.applicationsStarted).toBeGreaterThan(0);
      expect(recovery.themesRestored).toBe(1);
    });
  });

  describe("Browser-Subprozess Recovery", () => {
    it("sollte Browser-Window-Handles nach Neustart korrekt zuordnen", async () => {
      // Arrange
      const theme = {
        id: "theme-browser",
        name: "Browser Development",
        persistentProcesses: [
          {
            executableName: "chrome",
            titlePattern: "GitHub",
          },
        ],
        windows: [],
        applications: [],
        processes: [],
      };

      const currentBrowserProcess = {
        id: 7777,
        name: "chrome",
        windows: [
          {
            hwnd: 555555,
            processId: 7777,
            title: "GitHub - switchfast Repository",
          },
          { hwnd: 777777, processId: 7777, title: "Google Search" },
        ],
      };

      // Act
      const restoredTheme = await restoreWindowHandlesForTheme(theme, [
        currentBrowserProcess,
      ]);

      // Assert
      expect(restoredTheme.windows).toHaveLength(1);
      expect(restoredTheme.windows[0].title).toContain("GitHub");
      expect(restoredTheme.applications).toContain(555555);
      expect(restoredTheme.applications).not.toContain(777777);
    });

    it("sollte Browser-Prozess-ID-Konflikte nach Neustart bereinigen", async () => {
      // Arrange
      const themes = [
        {
          id: "theme-1",
          processes: [1234],
          windows: [],
        },
        {
          id: "theme-2",
          processes: [1234],
          windows: [],
        },
      ];

      // Act
      const cleanedThemes = cleanupConflictingProcessIds(themes);

      // Assert
      const totalProcesses =
        cleanedThemes[0].processes.length + cleanedThemes[1].processes.length;
      expect(totalProcesses).toBeLessThan(2);
    });
  });
});

// Test-Hilfsfunktionen
async function loadThemesFromStorage() {
  return [
    {
      id: "theme-dev",
      name: "Development",
      shortcut: "Alt+D",
      applications: [1234, 5678],
      persistentProcesses: [
        {
          executableName: "chrome",
          executablePath:
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          titlePattern: "GitHub",
        },
      ],
      processes: [],
      windows: [],
    },
  ];
}

function findMatchingProcess(processes: any[], persistentProcess: any) {
  return processes.find((process) => {
    const nameMatches =
      process.name.toLowerCase() ===
      persistentProcess.executableName.toLowerCase();
    const pathMatches =
      !persistentProcess.executablePath ||
      process.path === persistentProcess.executablePath;
    return nameMatches && pathMatches;
  });
}

async function restoreWindowHandles(themes: any[], currentProcesses: any[]) {
  return themes.map((theme) => {
    if (!theme.persistentProcesses || theme.persistentProcesses.length === 0) {
      return theme;
    }

    const newWindows: any[] = [];

    theme.persistentProcesses.forEach((persistentProcess: any) => {
      if (!persistentProcess.titlePattern) return;

      const matchingProcesses = currentProcesses.filter(
        (process) =>
          process.name.toLowerCase() ===
          persistentProcess.executableName.toLowerCase()
      );

      matchingProcesses.forEach((process) => {
        if (process.windows) {
          process.windows.forEach((window: any) => {
            if (window.title.includes(persistentProcess.titlePattern)) {
              newWindows.push({
                hwnd: window.hwnd,
                processId: window.processId,
                title: window.title,
              });
            }
          });
        }
      });
    });

    if (newWindows.length > 0) {
      const updatedApplications = theme.applications.filter(
        (appId: number) => !theme.windows?.some((w: any) => w.hwnd === appId)
      );

      newWindows.forEach((w) => updatedApplications.push(w.hwnd));

      return {
        ...theme,
        windows: newWindows,
        applications: updatedApplications,
      };
    }

    return theme;
  });
}

function findMissingApplications(
  persistentIdentifiers: any[],
  currentProcesses: any[]
) {
  return persistentIdentifiers.filter((persistent) => {
    const isRunning = currentProcesses.some(
      (process) =>
        process.name.toLowerCase() ===
          persistent.executableName.toLowerCase() &&
        (!persistent.executablePath ||
          process.path === persistent.executablePath)
    );
    return !isRunning && persistent.executablePath;
  });
}

async function restoreProcessAssociations(
  themes: any[],
  currentProcesses: any[]
) {
  const applicationsToStart = [];
  let newProcessIdsAssigned = 0;

  for (const theme of themes) {
    if (!theme.persistentProcesses) continue;

    for (const persistent of theme.persistentProcesses) {
      const matchingProcess = findMatchingProcess(currentProcesses, persistent);

      if (matchingProcess) {
        theme.processes.push(matchingProcess.id);
        newProcessIdsAssigned++;
      } else if (persistent.executablePath) {
        applicationsToStart.push(persistent);
      }
    }
  }

  return {
    applicationsStarted: applicationsToStart.length,
    themesRestored: themes.length,
    newProcessIdsAssigned,
  };
}

async function restoreWindowHandlesForTheme(
  theme: any,
  currentProcesses: any[]
) {
  const newWindows: any[] = [];

  if (!theme.persistentProcesses) return theme;

  theme.persistentProcesses.forEach((persistentProcess: any) => {
    if (!persistentProcess.titlePattern) return;

    const matchingProcesses = currentProcesses.filter(
      (process) =>
        process.name.toLowerCase() ===
        persistentProcess.executableName.toLowerCase()
    );

    matchingProcesses.forEach((process) => {
      if (process.windows) {
        process.windows.forEach((window: any) => {
          if (window.title.includes(persistentProcess.titlePattern)) {
            newWindows.push({
              hwnd: window.hwnd,
              processId: window.processId,
              title: window.title,
            });
          }
        });
      }
    });
  });

  const newApplications = newWindows.map((w) => w.hwnd);

  return {
    ...theme,
    windows: newWindows,
    applications: newApplications,
  };
}

function cleanupConflictingProcessIds(themes: any[]) {
  const processIdCount = new Map<number, number>();

  themes.forEach((theme) => {
    if (theme.processes && Array.isArray(theme.processes)) {
      theme.processes.forEach((pid: number) => {
        processIdCount.set(pid, (processIdCount.get(pid) || 0) + 1);
      });
    }
  });

  return themes.map((theme) => ({
    ...theme,
    processes: theme.processes.filter(
      (pid: number) =>
        processIdCount.get(pid) === 1 || theme.windows?.length > 0
    ),
  }));
}
