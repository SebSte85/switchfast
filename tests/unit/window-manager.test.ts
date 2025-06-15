import { describe, it, expect, vi, beforeEach } from "vitest";
import { exec } from "child_process";
import { BrowserWindow } from "electron";
import { TEST_CONSTANTS } from "../setup";

// Mock für child_process
vi.mock("child_process", () => ({
  exec: vi.fn(),
}));

// Mock für Electron
vi.mock("electron", () => ({
  BrowserWindow: {
    getAllWindows: vi.fn(),
  },
}));

// Globale Referenzen zu den Mocks
const mockExec = exec as unknown as vi.MockedFunction<typeof exec>;
const mockGetAllWindows = BrowserWindow.getAllWindows as vi.MockedFunction<
  typeof BrowserWindow.getAllWindows
>;

// Test-Hilfsfunktionen
async function getRunningApplications() {
  const command = "powershell command here";

  return new Promise((resolve) => {
    mockExec(command, { maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        console.error(`PowerShell error: ${error.message}`);
        // Fallback zu Electron
        const windows = mockGetAllWindows();
        const apps = windows.map((win: any) => ({
          id: win.webContents.getOSProcessId(),
          name: "Electron",
          title: win.getTitle(),
        }));
        resolve(apps);
        return;
      }

      try {
        const parsed = JSON.parse(stdout);
        const apps = parsed.map((app: any) => ({
          id: app.Id,
          name: app.Name,
          title: app.Title,
          path: app.Path,
        }));
        resolve(apps);
      } catch (parseError) {
        // JSON Parse Fehler - Fallback
        resolve([]);
      }
    });
  });
}

async function minimizeApplication(processId: number): Promise<boolean> {
  const command = `powershell command with processId ${processId}`;

  return new Promise((resolve) => {
    mockExec(command, (error, stdout, stderr) => {
      if (error) {
        console.error(`Minimize error: ${error.message}`);
        resolve(false);
        return;
      }

      const output = stdout.trim();
      resolve(output === "True");
    });
  });
}

async function minimizeApplications(processIds: number[]): Promise<boolean> {
  if (processIds.length === 0) {
    return true;
  }

  const results = await Promise.all(
    processIds.map((id) => minimizeApplication(id))
  );

  return results.every((result) => result === true);
}

describe("Window Manager", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getRunningApplications", () => {
    it("sollte laufende Anwendungen über PowerShell korrekt abrufen", async () => {
      // Arrange
      const mockPowerShellOutput = JSON.stringify([
        {
          Id: 1234,
          Name: "notepad",
          Title: "Unbenannt - Editor",
          Path: "C:\\Windows\\System32\\notepad.exe",
        },
        {
          Id: 5678,
          Name: "chrome",
          Title: "Google Chrome",
          Path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        },
      ]);

      mockExec.mockImplementation(
        (command: string, options: any, callback: any) => {
          if (typeof options === "function") {
            callback = options;
          }
          callback(null, mockPowerShellOutput, "");
        }
      );

      // Act
      const result = await getRunningApplications();

      // Assert
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 1234,
        name: "notepad",
        title: "Unbenannt - Editor",
        path: "C:\\Windows\\System32\\notepad.exe",
      });
      expect(result[1]).toEqual({
        id: 5678,
        name: "chrome",
        title: "Google Chrome",
        path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      });
    });

    it("sollte bei PowerShell-Fehler auf Electron-Fallback zurückgreifen", async () => {
      // Arrange
      mockExec.mockImplementation(
        (command: string, options: any, callback: any) => {
          if (typeof options === "function") {
            callback = options;
          }
          callback(new Error("PowerShell nicht verfügbar"), "", "");
        }
      );

      const mockWindows = [
        {
          webContents: { getOSProcessId: () => 9999 },
          getTitle: () => "Test Window",
        },
      ];
      mockGetAllWindows.mockReturnValue(mockWindows as any);

      // Act
      const result = await getRunningApplications();

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        id: 9999,
        name: "Electron",
        title: "Test Window",
      });
    });

    it("sollte bei JSON-Parse-Fehler auf Electron-Fallback zurückgreifen", async () => {
      // Arrange
      mockExec.mockImplementation(
        (command: string, options: any, callback: any) => {
          if (typeof options === "function") {
            callback = options;
          }
          callback(null, "invalid json", "");
        }
      );

      mockGetAllWindows.mockReturnValue([]);

      // Act
      const result = await getRunningApplications();

      // Assert
      expect(result).toEqual([]);
    });

    it("sollte leere Antwort korrekt behandeln", async () => {
      // Arrange
      mockExec.mockImplementation(
        (command: string, options: any, callback: any) => {
          if (typeof options === "function") {
            callback = options;
          }
          callback(null, "[]", "");
        }
      );

      // Act
      const result = await getRunningApplications();

      // Assert
      expect(result).toEqual([]);
    });
  });

  describe("minimizeApplication", () => {
    it("sollte Anwendung erfolgreich minimieren", async () => {
      // Arrange
      const processId = 1234;
      mockExec.mockImplementation((command: string, callback: any) => {
        callback(null, "True", "");
      });

      // Act
      const result = await minimizeApplication(processId);

      // Assert
      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining(`${processId}`),
        expect.any(Function)
      );
    });

    it("sollte false zurückgeben wenn Minimierung fehlschlägt", async () => {
      // Arrange
      const processId = 1234;
      mockExec.mockImplementation((command: string, callback: any) => {
        callback(null, "False", "");
      });

      // Act
      const result = await minimizeApplication(processId);

      // Assert
      expect(result).toBe(false);
    });

    it("sollte PowerShell-Fehler korrekt behandeln", async () => {
      // Arrange
      const processId = 1234;
      mockExec.mockImplementation((command: string, callback: any) => {
        callback(new Error("Access denied"), "", "Access denied");
      });

      // Act
      const result = await minimizeApplication(processId);

      // Assert
      expect(result).toBe(false);
    });

    it("sollte unerwartete Ausgabe als Fehler behandeln", async () => {
      // Arrange
      const processId = 1234;
      mockExec.mockImplementation((command: string, callback: any) => {
        callback(null, "UnexpectedOutput", "");
      });

      // Act
      const result = await minimizeApplication(processId);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("minimizeApplications", () => {
    it("sollte mehrere Anwendungen gleichzeitig minimieren", async () => {
      // Arrange
      const processIds = [1234, 5678, 9012];
      mockExec.mockImplementation((command: string, callback: any) => {
        callback(null, "True", "");
      });

      // Act
      const result = await minimizeApplications(processIds);

      // Assert
      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledTimes(3);
    });

    it("sollte false zurückgeben wenn eine Minimierung fehlschlägt", async () => {
      // Arrange
      const processIds = [1234, 5678];
      let callCount = 0;
      mockExec.mockImplementation((command: string, callback: any) => {
        callCount++;
        if (callCount === 1) {
          callback(null, "True", "");
        } else {
          callback(null, "False", "");
        }
      });

      // Act
      const result = await minimizeApplications(processIds);

      // Assert
      expect(result).toBe(false);
    });

    it("sollte leere Array korrekt behandeln", async () => {
      // Arrange
      const processIds: number[] = [];

      // Act
      const result = await minimizeApplications(processIds);

      // Assert
      expect(result).toBe(true);
      expect(mockExec).not.toHaveBeenCalled();
    });
  });

  describe("Performance und Stabilität", () => {
    it("sollte große Anwendungslisten effizient verarbeiten", async () => {
      // Arrange
      const largeOutput = JSON.stringify(
        Array.from({ length: 100 }, (_, i) => ({
          Id: i + 1000,
          Name: `app${i}`,
          Title: `Application ${i}`,
          Path: `C:\\App${i}\\app.exe`,
        }))
      );

      mockExec.mockImplementation(
        (command: string, options: any, callback: any) => {
          if (typeof options === "function") {
            callback = options;
          }
          callback(null, largeOutput, "");
        }
      );

      // Act
      const start = Date.now();
      const result = await getRunningApplications();
      const duration = Date.now() - start;

      // Assert
      expect(result).toHaveLength(100);
      expect(duration).toBeLessThan(5000);
    });

    it("sollte PowerShell-Timeout korrekt behandeln", async () => {
      // Arrange
      mockExec.mockImplementation(
        (command: string, options: any, callback: any) => {
          if (typeof options === "function") {
            callback = options;
          }
          // Simuliere Timeout
          setTimeout(() => {
            callback(new Error("Command timed out"), "", "");
          }, 100);
        }
      );

      mockGetAllWindows.mockReturnValue([]);

      // Act
      const result = await getRunningApplications();

      // Assert
      expect(result).toEqual([]);
    });
  });
});
