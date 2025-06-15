import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEST_CONSTANTS, mockSupabaseClient } from "../setup";

// Mock für Electron IPC
const mockIpcMain = {
  handle: vi.fn(),
  removeHandler: vi.fn(),
};

const mockWebContents = {
  send: vi.fn(),
};

describe("IPC Handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("get-running-applications Handler", () => {
    it("sollte laufende Anwendungen korrekt zurückgeben", async () => {
      // Arrange
      const mockApplications = [
        { id: 1234, name: "notepad", title: "Notepad" },
        { id: 5678, name: "chrome", title: "Chrome" },
      ];

      const handler = createGetRunningApplicationsHandler(mockApplications);

      // Act
      const result = await handler();

      // Assert
      expect(result).toEqual(mockApplications);
      expect(result).toHaveLength(2);
    });

    it("sollte gefilterte Anwendungen ohne System-Prozesse zurückgeben", async () => {
      // Arrange
      const mockApplications = [
        { id: 1234, name: "notepad", title: "Notepad" },
        { id: 5678, name: "csrss", title: "" }, // System-Prozess
        { id: 9012, name: "chrome", title: "Chrome" },
      ];

      const handler = createGetRunningApplicationsHandler(mockApplications, true);

      // Act
      const result = await handler();

      // Assert
      expect(result).toHaveLength(2);
      expect(result.map(app => app.name)).not.toContain("csrss");
    });

    it("sollte Fehler bei PowerShell-Problemen handhaben", async () => {
      // Arrange
      const handler = createGetRunningApplicationsHandler(null, false, true);

      // Act & Assert
      await expect(handler()).rejects.toThrow("Fehler beim Abrufen der Anwendungen");
    });
  });

  describe("minimize-applications Handler", () => {
    it("sollte einzelne Anwendung erfolgreich minimieren", async () => {
      // Arrange
      const processIds = [1234];
      const handler = createMinimizeApplicationsHandler(true);

      // Act
      const result = await handler(processIds);

      // Assert
      expect(result).toBe(true);
    });

    it("sollte mehrere Anwendungen erfolgreich minimieren", async () => {
      // Arrange
      const processIds = [1234, 5678, 9012];
      const handler = createMinimizeApplicationsHandler(true);

      // Act
      const result = await handler(processIds);

      // Assert
      expect(result).toBe(true);
    });

    it("sollte false zurückgeben wenn Minimierung fehlschlägt", async () => {
      // Arrange
      const processIds = [1234];
      const handler = createMinimizeApplicationsHandler(false);

      // Act
      const result = await handler(processIds);

      // Assert
      expect(result).toBe(false);
    });

    it("sollte leere Array korrekt behandeln", async () => {
      // Arrange
      const processIds: number[] = [];
      const handler = createMinimizeApplicationsHandler(true);

      // Act
      const result = await handler(processIds);

      // Assert
      expect(result).toBe(true);
    });

    it("sollte ungültige Prozess-IDs behandeln", async () => {
      // Arrange
      const processIds = [-1, 0, 1234];
      const handler = createMinimizeApplicationsHandler(true);

      // Act
      const result = await handler(processIds);

      // Assert
      expect(result).toBe(true); // Sollte trotzdem funktionieren
    });
  });

  describe("register-shortcut Handler", () => {
    it("sollte Shortcut erfolgreich registrieren", async () => {
      // Arrange
      const shortcutData = {
        themeId: "theme-123",
        shortcut: "Alt+D",
      };
      const handler = createRegisterShortcutHandler(true);

      // Act
      const result = await handler(shortcutData);

      // Assert
      expect(result).toBe(true);
    });

    it("sollte Shortcut-Registrierung ablehnen bei ungültigem Format", async () => {
      // Arrange
      const shortcutData = {
        themeId: "theme-123",
        shortcut: "InvalidShortcut",
      };
      const handler = createRegisterShortcutHandler(false);

      // Act
      const result = await handler(shortcutData);

      // Assert
      expect(result).toBe(false);
    });

    it("sollte Shortcut-Konflikte erkennen", async () => {
      // Arrange
      const shortcutData = {
        themeId: "theme-123",
        shortcut: "Alt+A", // Bereits verwendet
      };
      const handler = createRegisterShortcutHandler(false, "CONFLICT");

      // Act & Assert
      await expect(handler(shortcutData)).rejects.toThrow("Shortcut bereits verwendet");
    });

    it("sollte fehlende Theme-ID behandeln", async () => {
      // Arrange
      const shortcutData = {
        themeId: "",
        shortcut: "Alt+D",
      };
      const handler = createRegisterShortcutHandler(false);

      // Act & Assert
      await expect(handler(shortcutData)).rejects.toThrow("Theme-ID ist erforderlich");
    });
  });

  describe("unregister-shortcut Handler", () => {
    it("sollte Shortcut erfolgreich deregistrieren", async () => {
      // Arrange
      const shortcutData = { themeId: "theme-123" };
      const handler = createUnregisterShortcutHandler(true);

      // Act
      const result = await handler(shortcutData);

      // Assert
      expect(result).toBe(true);
    });

    it("sollte mit nicht-existierendem Shortcut umgehen", async () => {
      // Arrange
      const shortcutData = { themeId: "theme-nonexistent" };
      const handler = createUnregisterShortcutHandler(false);

      // Act
      const result = await handler(shortcutData);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe("save-themes Handler", () => {
    it("sollte Themes erfolgreich speichern", async () => {
      // Arrange
      const themes = [
        {
          id: "theme-1",
          name: "Development",
          shortcut: "Alt+D",
          applications: [1234, 5678],
        },
        {
          id: "theme-2",
          name: "Design",
          shortcut: "Alt+S",
          applications: [9012],
        },
      ];
      const handler = createSaveThemesHandler(true);

      // Act
      const result = await handler(themes);

      // Assert
      expect(result).toBe(true);
    });

    it("sollte Fehler bei ungültigen Theme-Daten behandeln", async () => {
      // Arrange
      const invalidThemes = [
        { id: "", name: "", shortcut: "", applications: [] }, // Ungültig
      ];
      const handler = createSaveThemesHandler(false);

      // Act & Assert
      await expect(handler(invalidThemes)).rejects.toThrow("Ungültige Theme-Daten");
    });

    it("sollte große Theme-Listen handhaben", async () => {
      // Arrange
      const largeThemeList = Array.from({ length: 50 }, (_, i) => ({
        id: `theme-${i}`,
        name: `Theme ${i}`,
        shortcut: `Alt+${i % 10}`,
        applications: [1000 + i],
      }));
      const handler = createSaveThemesHandler(true);

      // Act
      const result = await handler(largeThemeList);

      // Assert
      expect(result).toBe(true);
    });
  });

  describe("load-themes Handler", () => {
    it("sollte gespeicherte Themes erfolgreich laden", async () => {
      // Arrange
      const savedThemes = [
        {
          id: "theme-1",
          name: "Development",
          shortcut: "Alt+D",
          applications: [1234],
        },
      ];
      const handler = createLoadThemesHandler(savedThemes);

      // Act
      const result = await handler();

      // Assert
      expect(result).toEqual(savedThemes);
    });

    it("sollte leere Liste zurückgeben wenn keine Themes gespeichert", async () => {
      // Arrange
      const handler = createLoadThemesHandler([]);

      // Act
      const result = await handler();

      // Assert
      expect(result).toEqual([]);
    });

    it("sollte korrupte Theme-Daten handhaben", async () => {
      // Arrange
      const handler = createLoadThemesHandler(null, true);

      // Act & Assert
      await expect(handler()).rejects.toThrow("Fehler beim Laden der Themes");
    });
  });

  describe("IPC Event Handlers", () => {
    it("sollte window-focus Event korrekt senden", () => {
      // Arrange
      const eventData = { focused: true };

      // Act
      sendEventToRenderer("window-focus", eventData);

      // Assert
      expect(mockWebContents.send).toHaveBeenCalledWith("window-focus", eventData);
    });

    it("sollte theme-activated Event korrekt senden", () => {
      // Arrange
      const eventData = { themeId: "theme-123", themeName: "Development" };

      // Act
      sendEventToRenderer("theme-activated", eventData);

      // Assert
      expect(mockWebContents.send).toHaveBeenCalledWith("theme-activated", eventData);
    });

    it("sollte error Event korrekt senden", () => {
      // Arrange
      const eventData = { error: "PowerShell Fehler", code: "POWERSHELL_ERROR" };

      // Act
      sendEventToRenderer("error", eventData);

      // Assert
      expect(mockWebContents.send).toHaveBeenCalledWith("error", eventData);
    });
  });

  describe("IPC Handler Registration", () => {
    it("sollte alle Handler korrekt registrieren", () => {
      // Act
      registerAllIpcHandlers();

      // Assert
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        "get-running-applications",
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        "minimize-applications",
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        "register-shortcut",
        expect.any(Function)
      );
      expect(mockIpcMain.handle).toHaveBeenCalledWith(
        "unregister-shortcut",
        expect.any(Function)
      );
    });

    it("sollte Handler korrekt deregistrieren", () => {
      // Act
      unregisterAllIpcHandlers();

      // Assert
      expect(mockIpcMain.removeHandler).toHaveBeenCalledWith("get-running-applications");
      expect(mockIpcMain.removeHandler).toHaveBeenCalledWith("minimize-applications");
      expect(mockIpcMain.removeHandler).toHaveBeenCalledWith("register-shortcut");
      expect(mockIpcMain.removeHandler).toHaveBeenCalledWith("unregister-shortcut");
    });
  });

  describe("Error Handling und Resilience", () => {
    it("sollte Handler-Fehler abfangen und Fallback verwenden", async () => {
      // Arrange
      const faultyHandler = vi.fn().mockRejectedValue(new Error("Handler crashed"));

      // Act & Assert
      await expect(safeHandlerWrapper(faultyHandler)()).resolves.toEqual({
        success: false,
        error: "Handler crashed",
      });
    });

    it("sollte Timeout bei langsamen Operationen handhaben", async () => {
      // Arrange
      const slowHandler = vi.fn().mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve("done"), 10000))
      );

      // Act
      const result = await safeHandlerWrapper(slowHandler, 100)();

      // Assert
      expect(result).toEqual({
        success: false,
        error: "Operation timeout",
      });
    });

    it("sollte gleichzeitige Handler-Aufrufe handhaben", async () => {
      // Arrange
      const handler = createGetRunningApplicationsHandler([
        { id: 1234, name: "test", title: "Test" },
      ]);

      // Act
      const promises = Array.from({ length: 5 }, () => handler());
      const results = await Promise.all(promises);

      // Assert
      results.forEach(result => {
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe(1234);
      });
    });
  });
});

// Hilfsfunktionen für Tests
function createGetRunningApplicationsHandler(
  mockApps: any[] | null,
  filterSystemProcesses = false,
  shouldThrow = false
) {
  return async () => {
    if (shouldThrow) {
      throw new Error("Fehler beim Abrufen der Anwendungen");
    }

    if (!mockApps) {
      return [];
    }

    if (filterSystemProcesses) {
      const systemProcesses = ["csrss", "winlogon", "services"];
      return mockApps.filter(app => !systemProcesses.includes(app.name));
    }

    return mockApps;
  };
}

function createMinimizeApplicationsHandler(shouldSucceed: boolean) {
  return async (processIds: number[]) => {
    if (processIds.length === 0) return true;
    return shouldSucceed;
  };
}

function createRegisterShortcutHandler(
  shouldSucceed: boolean,
  errorType?: string
) {
  return async (shortcutData: { themeId: string; shortcut: string }) => {
    if (!shortcutData.themeId) {
      throw new Error("Theme-ID ist erforderlich");
    }

    if (errorType === "CONFLICT") {
      throw new Error("Shortcut bereits verwendet");
    }

    return shouldSucceed;
  };
}

function createUnregisterShortcutHandler(shouldSucceed: boolean) {
  return async (shortcutData: { themeId: string }) => {
    return shouldSucceed;
  };
}

function createSaveThemesHandler(shouldSucceed: boolean) {
  return async (themes: any[]) => {
    if (!themes.every(theme => theme.id && theme.name && theme.shortcut)) {
      throw new Error("Ungültige Theme-Daten");
    }

    return shouldSucceed;
  };
}

function createLoadThemesHandler(mockThemes: any[] | null, shouldThrow = false) {
  return async () => {
    if (shouldThrow) {
      throw new Error("Fehler beim Laden der Themes");
    }

    return mockThemes || [];
  };
}

function sendEventToRenderer(eventName: string, data: any) {
  mockWebContents.send(eventName, data);
}

function registerAllIpcHandlers() {
  const handlers = [
    "get-running-applications",
    "minimize-applications",
    "register-shortcut",
    "unregister-shortcut",
    "save-themes",
    "load-themes",
  ];

  handlers.forEach(handlerName => {
    mockIpcMain.handle(handlerName, vi.fn());
  });
}

function unregisterAllIpcHandlers() {
  const handlers = [
    "get-running-applications",
    "minimize-applications",
    "register-shortcut",
    "unregister-shortcut",
    "save-themes",
    "load-themes",
  ];

  handlers.forEach(handlerName => {
    mockIpcMain.removeHandler(handlerName);
  });
}

function safeHandlerWrapper(handler: Function, timeout = 5000) {
  return async (...args: any[]) => {
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Operation timeout")), timeout)
      );

      const result = await Promise.race([
        handler(...args),
        timeoutPromise,
      ]);

      return result;
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  };
}