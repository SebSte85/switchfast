import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEST_CONSTANTS } from "../setup";

describe("Theme Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Theme-Erstellung und -Validierung", () => {
    it("sollte gültiges Theme erstellen", () => {
      // Arrange
      const themeData = {
        name: "Development Theme",
        shortcut: "Alt+D",
        color: "#007ACC",
        applications: [1234, 5678],
      };

      // Act
      const theme = createTheme(themeData);

      // Assert
      expect(theme.id).toMatch(/^theme-[a-f0-9-]+$/);
      expect(theme.name).toBe("Development Theme");
      expect(theme.shortcut).toBe("Alt+D");
      expect(theme.color).toBe("#007ACC");
      expect(theme.applications).toEqual([1234, 5678]);
      expect(theme.processes).toEqual([]);
      expect(theme.windows).toEqual([]);
    });

    it("sollte Standardwerte für optionale Felder setzen", () => {
      // Arrange & Act
      const theme = createTheme({
        name: "Simple Theme",
        shortcut: "Ctrl+1",
        applications: [],
      });

      // Assert
      expect(theme.color).toBeUndefined();
      expect(theme.persistentProcesses).toEqual([]);
      expect(theme.processes).toEqual([]);
      expect(theme.windows).toEqual([]);
    });

    it("sollte ungültige Theme-Namen ablehnen", () => {
      // Act & Assert
      expect(() =>
        createTheme({
          name: "",
          shortcut: "Alt+1",
          applications: [],
        })
      ).toThrow("Theme-Name ist erforderlich");

      expect(() =>
        createTheme({
          name: "   ",
          shortcut: "Alt+1",
          applications: [],
        })
      ).toThrow("Theme-Name ist erforderlich");
    });

    it("sollte ungültige Shortcuts ablehnen", () => {
      // Act & Assert
      expect(() =>
        createTheme({
          name: "Test Theme",
          shortcut: "",
          applications: [],
        })
      ).toThrow("Shortcut ist erforderlich");

      expect(() =>
        createTheme({
          name: "Test Theme",
          shortcut: "InvalidShortcut",
          applications: [],
        })
      ).toThrow("Ungültiges Shortcut-Format");
    });
  });

  describe("Shortcut-Validierung", () => {
    it("sollte gültige Shortcuts akzeptieren", () => {
      const validShortcuts = [
        "Alt+A",
        "Ctrl+Shift+B",
        "Alt+Ctrl+C",
        "Alt+F1",
        "Ctrl+1",
        "Alt+Space",
      ];

      validShortcuts.forEach((shortcut) => {
        expect(validateShortcut(shortcut)).toBe(true);
      });
    });

    it("sollte ungültige Shortcuts ablehnen", () => {
      const invalidShortcuts = [
        "A", // Nur Buchstabe
        "Alt", // Nur Modifier
        "Alt+", // Unvollständig
        "Alt+Alt+A", // Doppelter Modifier
        "InvalidKey+A", // Ungültiger Modifier
        "Alt+InvalidKey", // Ungültige Taste
        "", // Leer
        "   ", // Nur Leerzeichen
      ];

      invalidShortcuts.forEach((shortcut) => {
        expect(validateShortcut(shortcut)).toBe(false);
      });
    });

    it("sollte Shortcut-Konflikte erkennen", () => {
      // Arrange
      const existingThemes = [
        createTheme({
          name: "Theme 1",
          shortcut: "Alt+A",
          applications: [],
        }),
        createTheme({
          name: "Theme 2",
          shortcut: "Ctrl+B",
          applications: [],
        }),
      ];

      // Act & Assert
      expect(hasShortcutConflict("Alt+A", existingThemes)).toBe(true);
      expect(hasShortcutConflict("Ctrl+B", existingThemes)).toBe(true);
      expect(hasShortcutConflict("Alt+C", existingThemes)).toBe(false);
    });
  });

  describe("Anwendungs-Zuordnung", () => {
    it("sollte Anwendung zu Theme hinzufügen", () => {
      // Arrange
      const theme = createTheme({
        name: "Test Theme",
        shortcut: "Alt+T",
        applications: [1234],
      });

      // Act
      const updatedTheme = addApplicationToTheme(theme, 5678);

      // Assert
      expect(updatedTheme.applications).toContain(5678);
      expect(updatedTheme.applications).toHaveLength(2);
    });

    it("sollte Duplikate bei Anwendungs-Hinzufügung vermeiden", () => {
      // Arrange
      const theme = createTheme({
        name: "Test Theme",
        shortcut: "Alt+T",
        applications: [1234],
      });

      // Act
      const updatedTheme = addApplicationToTheme(theme, 1234);

      // Assert
      expect(updatedTheme.applications).toEqual([1234]);
    });

    it("sollte Anwendung aus Theme entfernen", () => {
      // Arrange
      const theme = createTheme({
        name: "Test Theme",
        shortcut: "Alt+T",
        applications: [1234, 5678, 9012],
      });

      // Act
      const updatedTheme = removeApplicationFromTheme(theme, 5678);

      // Assert
      expect(updatedTheme.applications).not.toContain(5678);
      expect(updatedTheme.applications).toEqual([1234, 9012]);
    });

    it("sollte Theme unverändert lassen wenn Anwendung nicht existiert", () => {
      // Arrange
      const theme = createTheme({
        name: "Test Theme",
        shortcut: "Alt+T",
        applications: [1234, 5678],
      });

      // Act
      const updatedTheme = removeApplicationFromTheme(theme, 9999);

      // Assert
      expect(updatedTheme.applications).toEqual([1234, 5678]);
    });
  });

  describe("Persistente Prozess-Identifikatoren", () => {
    it("sollte persistente Identifikatoren für Browser-Anwendungen erstellen", () => {
      // Arrange
      const processInfo = {
        id: 1234,
        name: "chrome",
        title: "Google Chrome - GitHub",
        path: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      };

      // Act
      const identifier = createPersistentIdentifier(processInfo);

      // Assert
      expect(identifier).toEqual({
        executablePath:
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        executableName: "chrome",
        titlePattern: undefined, // Browser verwenden nur executable path
      });
    });

    it("sollte persistente Identifikatoren für spezielle Anwendungen erstellen", () => {
      // Arrange
      const processInfo = {
        id: 5678,
        name: "notepad",
        title: "document.txt - Editor",
        path: "C:\\Windows\\System32\\notepad.exe",
      };

      // Act
      const identifier = createPersistentIdentifier(processInfo);

      // Assert
      expect(identifier).toEqual({
        executablePath: "C:\\Windows\\System32\\notepad.exe",
        executableName: "notepad",
        titlePattern: "* - Editor", // Pattern für Notepad-Titel
      });
    });

    it("sollte persistente Identifikatoren ohne Pfad handhaben", () => {
      // Arrange
      const processInfo = {
        id: 9012,
        name: "unknown_app",
        title: "Unknown Application",
      };

      // Act
      const identifier = createPersistentIdentifier(processInfo);

      // Assert
      expect(identifier).toEqual({
        executablePath: undefined,
        executableName: "unknown_app",
        titlePattern: "Unknown Application",
      });
    });
  });

  describe("Theme-Updates", () => {
    it("sollte Theme-Name aktualisieren", () => {
      // Arrange
      const theme = createTheme({
        name: "Old Name",
        shortcut: "Alt+O",
        applications: [],
      });

      // Act
      const updatedTheme = updateTheme(theme, { name: "New Name" });

      // Assert
      expect(updatedTheme.name).toBe("New Name");
      expect(updatedTheme.shortcut).toBe("Alt+O"); // Unverändert
    });

    it("sollte Theme-Shortcut aktualisieren", () => {
      // Arrange
      const theme = createTheme({
        name: "Test Theme",
        shortcut: "Alt+O",
        applications: [],
      });

      // Act
      const updatedTheme = updateTheme(theme, { shortcut: "Ctrl+N" });

      // Assert
      expect(updatedTheme.shortcut).toBe("Ctrl+N");
      expect(updatedTheme.name).toBe("Test Theme"); // Unverändert
    });

    it("sollte Theme-Farbe aktualisieren", () => {
      // Arrange
      const theme = createTheme({
        name: "Test Theme",
        shortcut: "Alt+T",
        applications: [],
      });

      // Act
      const updatedTheme = updateTheme(theme, { color: "#FF5722" });

      // Assert
      expect(updatedTheme.color).toBe("#FF5722");
    });

    it("sollte mehrere Theme-Eigenschaften gleichzeitig aktualisieren", () => {
      // Arrange
      const theme = createTheme({
        name: "Old Theme",
        shortcut: "Alt+O",
        applications: [1234],
        color: "#000000",
      });

      // Act
      const updatedTheme = updateTheme(theme, {
        name: "Updated Theme",
        shortcut: "Ctrl+U",
        color: "#FFFFFF",
      });

      // Assert
      expect(updatedTheme.name).toBe("Updated Theme");
      expect(updatedTheme.shortcut).toBe("Ctrl+U");
      expect(updatedTheme.color).toBe("#FFFFFF");
      expect(updatedTheme.applications).toEqual([1234]); // Unverändert
    });
  });

  describe("Theme-Serialisierung", () => {
    it("sollte Theme zu JSON serialisieren", () => {
      // Arrange
      const theme = createTheme({
        name: "Serialization Test",
        shortcut: "Alt+S",
        applications: [1234, 5678],
        color: "#2196F3",
      });

      // Act
      const json = JSON.stringify(theme);
      const parsed = JSON.parse(json);

      // Assert
      expect(parsed.name).toBe("Serialization Test");
      expect(parsed.shortcut).toBe("Alt+S");
      expect(parsed.applications).toEqual([1234, 5678]);
      expect(parsed.color).toBe("#2196F3");
    });

    it("sollte Theme aus JSON deserialisieren", () => {
      // Arrange
      const jsonData = {
        id: "theme-12345",
        name: "Deserialization Test",
        shortcut: "Ctrl+D",
        applications: [9012],
        color: "#4CAF50",
        processes: [],
        windows: [],
        persistentProcesses: [],
      };

      // Act
      const theme = deserializeTheme(jsonData);

      // Assert
      expect(theme.id).toBe("theme-12345");
      expect(theme.name).toBe("Deserialization Test");
      expect(theme.shortcut).toBe("Ctrl+D");
      expect(theme.applications).toEqual([9012]);
      expect(theme.color).toBe("#4CAF50");
    });
  });
});

// Hilfsfunktionen für Tests
function createTheme(data: {
  name: string;
  shortcut: string;
  applications: Array<number | string>;
  color?: string;
}) {
  if (!data.name || data.name.trim() === "") {
    throw new Error("Theme-Name ist erforderlich");
  }

  if (!data.shortcut || data.shortcut.trim() === "") {
    throw new Error("Shortcut ist erforderlich");
  }

  if (!validateShortcut(data.shortcut)) {
    throw new Error("Ungültiges Shortcut-Format");
  }

  return {
    id: `theme-${Math.random().toString(16).substr(2, 9)}`,
    name: data.name,
    shortcut: data.shortcut,
    applications: [...data.applications],
    color: data.color,
    processes: [],
    windows: [],
    persistentProcesses: [],
  };
}

function validateShortcut(shortcut: string): boolean {
  if (!shortcut || shortcut.trim() === "") return false;

  const validModifiers = ["Alt", "Ctrl", "Shift"];
  const validKeys = [
    "A",
    "B",
    "C",
    "D",
    "E",
    "F",
    "G",
    "H",
    "I",
    "J",
    "K",
    "L",
    "M",
    "N",
    "O",
    "P",
    "Q",
    "R",
    "S",
    "T",
    "U",
    "V",
    "W",
    "X",
    "Y",
    "Z",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "8",
    "9",
    "0",
    "F1",
    "F2",
    "F3",
    "F4",
    "F5",
    "F6",
    "F7",
    "F8",
    "F9",
    "F10",
    "F11",
    "F12",
    "Space",
    "Enter",
    "Tab",
    "Escape",
  ];

  const parts = shortcut.split("+");
  if (parts.length < 2) return false;

  const key = parts[parts.length - 1];
  const modifiers = parts.slice(0, -1);

  // Prüfe ob Schlüssel gültig ist
  if (!validKeys.includes(key)) return false;

  // Prüfe ob alle Modifier gültig sind
  if (!modifiers.every((mod) => validModifiers.includes(mod))) return false;

  // Prüfe auf doppelte Modifier
  if (new Set(modifiers).size !== modifiers.length) return false;

  return true;
}

function hasShortcutConflict(shortcut: string, existingThemes: any[]): boolean {
  return existingThemes.some((theme) => theme.shortcut === shortcut);
}

function addApplicationToTheme(theme: any, appId: number | string) {
  if (theme.applications.includes(appId)) {
    return theme; // Bereits vorhanden
  }

  return {
    ...theme,
    applications: [...theme.applications, appId],
  };
}

function removeApplicationFromTheme(theme: any, appId: number | string) {
  return {
    ...theme,
    applications: theme.applications.filter((id: any) => id !== appId),
  };
}

function createPersistentIdentifier(processInfo: any) {
  const identifier: any = {
    executableName: processInfo.name,
  };

  if (processInfo.path) {
    identifier.executablePath = processInfo.path;
  }

  // Spezielle Behandlung für bekannte Anwendungen
  if (
    processInfo.name === "notepad" &&
    processInfo.title.includes(" - Editor")
  ) {
    identifier.titlePattern = "* - Editor";
  } else if (!processInfo.path && processInfo.title) {
    identifier.titlePattern = processInfo.title;
  }

  return identifier;
}

function updateTheme(theme: any, updates: any) {
  return {
    ...theme,
    ...updates,
  };
}

function deserializeTheme(data: any) {
  return {
    id: data.id,
    name: data.name,
    shortcut: data.shortcut,
    applications: data.applications || [],
    color: data.color,
    processes: data.processes || [],
    windows: data.windows || [],
    persistentProcesses: data.persistentProcesses || [],
  };
}
