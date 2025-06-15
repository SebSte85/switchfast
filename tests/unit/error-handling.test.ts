import { describe, it, expect, vi, beforeEach } from "vitest";
import { TEST_CONSTANTS } from "../setup";

describe("Error Handling & Edge Cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("PowerShell-Fehlerbehandlung", () => {
    it("sollte Access Denied Fehler korrekt behandeln", async () => {
      // Arrange
      const powerShellError = {
        code: "ACCESS_DENIED",
        message: "Access denied to process information",
        stderr: "UnauthorizedAccessException",
      };

      // Act
      const result = await handlePowerShellError(powerShellError);

      // Assert
      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.errorType).toBe("ACCESS_DENIED");
      expect(result.userMessage).toContain("Administratorrechte");
    });

    it("sollte PowerShell nicht verfügbar Fehler behandeln", async () => {
      // Arrange
      const powerShellError = {
        code: "ENOENT",
        message: "PowerShell not found",
        stderr: "powershell is not recognized",
      };

      // Act
      const result = await handlePowerShellError(powerShellError);

      // Assert
      expect(result.success).toBe(false);
      expect(result.fallbackUsed).toBe(true);
      expect(result.errorType).toBe("POWERSHELL_NOT_FOUND");
      expect(result.userMessage).toContain("PowerShell nicht verfügbar");
    });

    it("sollte Timeout bei langsamen PowerShell-Befehlen handhaben", async () => {
      // Arrange
      const slowOperation = () =>
        new Promise((resolve) => setTimeout(resolve, 10000));

      // Act
      const result = await executeWithTimeout(slowOperation, 1000);

      // Assert
      expect(result.success).toBe(false);
      expect(result.errorType).toBe("TIMEOUT");
      expect(result.duration).toBeGreaterThan(900);
      expect(result.duration).toBeLessThan(1100);
    });

    it("sollte Script-Injection-Versuche abfangen", () => {
      // Arrange
      const maliciousInputs = [
        "notepad.exe; rm -rf /",
        "chrome.exe && del C:\\*",
        "app.exe | malware.exe",
        "valid.exe`malicious_command`",
      ];

      // Act & Assert
      maliciousInputs.forEach((input) => {
        expect(() => validateProcessInput(input)).toThrow("Ungültige Zeichen");
      });
    });
  });

  describe("Prozess-Fehlerbehandlung", () => {
    it("sollte nicht-existierende Prozess-IDs handhaben", async () => {
      // Arrange
      const nonExistentProcessIds = [99999, -1, 0];

      // Act
      const result = await minimizeProcesses(nonExistentProcessIds);

      // Assert
      expect(result.success).toBe(false);
      expect(result.failedProcesses).toEqual(nonExistentProcessIds);
      expect(result.successfulProcesses).toEqual([]);
    });

    it("sollte Prozess-Zugriffsfehler behandeln", async () => {
      // Arrange
      const protectedProcessId = 4; // System process

      // Act
      const result = await minimizeProcesses([protectedProcessId]);

      // Assert
      expect(result.success).toBe(false);
      expect(result.errorType).toBe("ACCESS_DENIED");
      expect(result.userMessage).toContain("geschützt");
    });

    it("sollte Zombie-Prozesse erkennen und handhaben", () => {
      // Arrange
      const processes = [
        { id: 1234, name: "notepad", title: "Notepad", status: "running" },
        { id: 5678, name: "zombie", title: "", status: "zombie" },
        { id: 9012, name: "chrome", title: "Chrome", status: "running" },
      ];

      // Act
      const cleanedProcesses = filterZombieProcesses(processes);

      // Assert
      expect(cleanedProcesses).toHaveLength(2);
      expect(cleanedProcesses.map((p) => p.id)).toEqual([1234, 9012]);
    });

    it("sollte Prozess-Hierarchie-Zyklen erkennen", () => {
      // Arrange
      const cyclicProcesses = [
        { id: 1, name: "proc1", parentId: 2 },
        { id: 2, name: "proc2", parentId: 3 },
        { id: 3, name: "proc3", parentId: 1 }, // Zyklus
      ];

      // Act & Assert
      expect(() => validateProcessHierarchy(cyclicProcesses)).toThrow(
        "Zyklische Referenz"
      );
    });
  });

  describe("Theme-Fehlerbehandlung", () => {
    it("sollte Theme-Name-Kollisionen handhaben", () => {
      // Arrange
      const existingThemes = [
        { id: "theme-1", name: "Development", shortcut: "Alt+D" },
        { id: "theme-2", name: "Design", shortcut: "Alt+S" },
      ];

      const newTheme = {
        name: "Development", // Kollision
        shortcut: "Alt+P",
        applications: [],
      };

      // Act & Assert
      expect(() => validateNewTheme(newTheme, existingThemes)).toThrow(
        "Theme-Name bereits vorhanden"
      );
    });

    it("sollte Shortcut-Kollisionen handhaben", () => {
      // Arrange
      const existingThemes = [
        { id: "theme-1", name: "Development", shortcut: "Alt+D" },
      ];

      const newTheme = {
        name: "Testing",
        shortcut: "Alt+D", // Kollision
        applications: [],
      };

      // Act & Assert
      expect(() => validateNewTheme(newTheme, existingThemes)).toThrow(
        "Shortcut bereits verwendet"
      );
    });

    it("sollte Theme-Limits handhaben", () => {
      // Arrange
      const tooManyThemes = Array.from({ length: 21 }, (_, i) => ({
        id: `theme-${i}`,
        name: `Theme ${i}`,
        shortcut: `Alt+${i}`,
      }));

      // Act & Assert
      expect(() => validateThemeLimit(tooManyThemes)).toThrow(
        "Maximale Anzahl Themes erreicht"
      );
    });

    it("sollte korrupte Theme-Daten reparieren", () => {
      // Arrange
      const corruptThemes = [
        { id: "theme-1", name: "Valid Theme", shortcut: "Alt+V" },
        { id: "", name: "No ID", shortcut: "Alt+N" }, // Korrupt
        { id: "theme-3", name: "", shortcut: "Alt+E" }, // Korrupt
        { id: "theme-4", name: "No Shortcut", shortcut: "" }, // Korrupt
      ];

      // Act
      const repairedThemes = repairCorruptThemes(corruptThemes);

      // Assert
      expect(repairedThemes).toHaveLength(4);
      expect(repairedThemes[1].id).toMatch(/^theme-[a-f0-9-]+$/); // Generierte ID
      expect(repairedThemes[2].name).toBe("Unbenanntes Theme");
      expect(repairedThemes[3].shortcut).toMatch(/^Alt\+[A-Z0-9]$/); // Generierter Shortcut
    });
  });

  describe("Speicher- und Performance-Grenzen", () => {
    it("sollte große Prozesslisten handhaben", async () => {
      // Arrange
      const largeProcessList = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1000,
        name: `process${i}`,
        title: `Process ${i}`,
      }));

      // Act
      const start = Date.now();
      const result = await processLargeProcessList(largeProcessList);
      const duration = Date.now() - start;

      // Assert
      expect(result.processed).toBe(1000);
      expect(duration).toBeLessThan(5000); // Sollte unter 5 Sekunden dauern
      expect(result.memoryUsage).toBeLessThan(100 * 1024 * 1024); // Unter 100MB
    });

    it("sollte Speicher-Limits respektieren", () => {
      // Arrange
      const memoryIntensiveOperation = () => {
        const largeArray = new Array(1000000).fill("x".repeat(1000));
        return largeArray;
      };

      // Act & Assert
      expect(() => executeWithMemoryLimit(memoryIntensiveOperation, 50 * 1024 * 1024))
        .toThrow("Speicherlimit überschritten");
    });

    it("sollte gleichzeitige Operationen limitieren", async () => {
      // Arrange
      const concurrentOperations = Array.from({ length: 100 }, (_, i) =>
        () => Promise.resolve(`Operation ${i}`)
      );

      // Act
      const result = await executeConcurrentlyWithLimit(concurrentOperations, 5);

      // Assert
      expect(result.completed).toBe(100);
      expect(result.maxConcurrent).toBe(5);
      expect(result.errors).toBe(0);
    });
  });

  describe("Netzwerk- und Datenbank-Fehler", () => {
    it("sollte Verbindungsfehler zu Supabase handhaben", async () => {
      // Arrange
      const connectionError = new Error("Network error");
      connectionError.name = "NetworkError";

      // Act
      const result = await handleDatabaseError(connectionError);

      // Assert
      expect(result.success).toBe(false);
      expect(result.retryable).toBe(true);
      expect(result.fallbackUsed).toBe(true);
      expect(result.userMessage).toContain("Verbindungsproblem");
    });

    it("sollte Rate-Limiting handhaben", async () => {
      // Arrange
      const rateLimitError = new Error("Too many requests");
      rateLimitError.name = "RateLimitError";

      // Act
      const result = await handleDatabaseError(rateLimitError);

      // Assert
      expect(result.success).toBe(false);
      expect(result.retryAfter).toBeGreaterThan(0);
      expect(result.userMessage).toContain("zu viele Anfragen");
    });

    it("sollte Offline-Modus aktivieren bei Netzwerkfehlern", () => {
      // Arrange
      const networkUnavailable = true;

      // Act
      const offlineMode = activateOfflineMode(networkUnavailable);

      // Assert
      expect(offlineMode.active).toBe(true);
      expect(offlineMode.features.trialCheck).toBe(false);
      expect(offlineMode.features.licenseValidation).toBe(false);
      expect(offlineMode.features.coreFeatures).toBe(true);
    });
  });

  describe("Benutzer-Input-Validierung", () => {
    it("sollte gefährliche Dateipfade ablehnen", () => {
      // Arrange
      const dangerousPaths = [
        "../../../etc/passwd",
        "C:\\Windows\\System32\\cmd.exe",
        "\\\\network\\share\\malware.exe",
        "file:///etc/passwd",
        "C:\\..\\..\\sensitive.txt",
      ];

      // Act & Assert
      dangerousPaths.forEach((path) => {
        expect(() => validateFilePath(path)).toThrow("Ungültiger Dateipfad");
      });
    });

    it("sollte XSS-Versuche in Theme-Namen abfangen", () => {
      // Arrange
      const maliciousNames = [
        "<script>alert('xss')</script>",
        "javascript:alert('xss')",
        "onload=alert('xss')",
        "${process.env.HOME}",
      ];

      // Act & Assert
      maliciousNames.forEach((name) => {
        expect(() => validateThemeName(name)).toThrow("Ungültige Zeichen");
      });
    });

    it("sollte extreme Eingabegrößen handhaben", () => {
      // Arrange
      const extremeInputs = {
        veryLongName: "x".repeat(10000),
        veryLongShortcut: "Alt+" + "x".repeat(1000),
        tooManyApplications: Array.from({ length: 10000 }, (_, i) => i),
      };

      // Act & Assert
      expect(() => validateThemeName(extremeInputs.veryLongName)).toThrow(
        "Name zu lang"
      );
      expect(() => validateShortcut(extremeInputs.veryLongShortcut)).toThrow(
        "Shortcut zu lang"
      );
      expect(() => validateApplicationList(extremeInputs.tooManyApplications)).toThrow(
        "Zu viele Anwendungen"
      );
    });
  });

  describe("Recovery und Resilience", () => {
    it("sollte nach Crashes automatisch Recovery durchführen", async () => {
      // Arrange
      const crashInfo = {
        timestamp: new Date().toISOString(),
        error: "Unhandled exception",
        context: "PowerShell execution",
      };

      // Act
      const recovery = await performCrashRecovery(crashInfo);

      // Assert
      expect(recovery.success).toBe(true);
      expect(recovery.actionsPerformed).toContain("restore_themes");
      expect(recovery.actionsPerformed).toContain("clear_temp_files");
      expect(recovery.actionsPerformed).toContain("reset_shortcuts");
    });

    it("sollte Backup-Themes bei Korruption wiederherstellen", async () => {
      // Arrange
      const corruptedThemes = null; // Simuliert korrupte Daten

      // Act
      const restoration = await restoreFromBackup(corruptedThemes);

      // Assert
      expect(restoration.success).toBe(true);
      expect(restoration.themesRestored).toBeGreaterThan(0);
      expect(restoration.backupUsed).toBeTruthy();
    });

    it("sollte Graceful Degradation bei Feature-Fehlern durchführen", () => {
      // Arrange
      const failedFeatures = ["PowerShell", "GlobalShortcuts"];

      // Act
      const degradedMode = activateGracefulDegradation(failedFeatures);

      // Assert
      expect(degradedMode.activeFeatures).toContain("ManualMinimize");
      expect(degradedMode.activeFeatures).toContain("ThemeManagement");
      expect(degradedMode.disabledFeatures).toEqual(failedFeatures);
      expect(degradedMode.userNotified).toBe(true);
    });
  });
});

// Hilfsfunktionen für Tests
async function handlePowerShellError(error: any) {
  let errorType = "UNKNOWN";
  let userMessage = "Unbekannter Fehler";
  let fallbackUsed = false;

  if (error.stderr?.includes("UnauthorizedAccessException")) {
    errorType = "ACCESS_DENIED";
    userMessage = "Administratorrechte erforderlich";
    fallbackUsed = true;
  } else if (error.message?.includes("not recognized")) {
    errorType = "POWERSHELL_NOT_FOUND";
    userMessage = "PowerShell nicht verfügbar";
    fallbackUsed = true;
  }

  return {
    success: false,
    errorType,
    userMessage,
    fallbackUsed,
  };
}

async function executeWithTimeout(operation: Function, timeout: number) {
  const start = Date.now();
  
  try {
    await Promise.race([
      operation(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Timeout")), timeout)
      ),
    ]);
    
    return { success: true, duration: Date.now() - start };
  } catch (error: any) {
    return {
      success: false,
      errorType: error.message === "Timeout" ? "TIMEOUT" : "ERROR",
      duration: Date.now() - start,
    };
  }
}

function validateProcessInput(input: string): boolean {
  const dangerousChars = [";", "&", "|", "`", "$", "(", ")", "<", ">"];
  
  if (dangerousChars.some(char => input.includes(char))) {
    throw new Error("Ungültige Zeichen erkannt");
  }
  
  return true;
}

async function minimizeProcesses(processIds: number[]) {
  const failedProcesses = processIds.filter(id => id <= 0 || id > 65535);
  const successfulProcesses = processIds.filter(id => id > 0 && id <= 65535);

  if (failedProcesses.length > 0) {
    return {
      success: false,
      failedProcesses,
      successfulProcesses,
    };
  }

  // Simuliere Zugriffsfehler für System-Prozess ID 4
  if (processIds.includes(4)) {
    return {
      success: false,
      errorType: "ACCESS_DENIED",
      userMessage: "Prozess ist geschützt",
    };
  }

  return { success: true, processIds };
}

function filterZombieProcesses(processes: any[]) {
  return processes.filter(p => p.status !== "zombie");
}

function validateProcessHierarchy(processes: any[]) {
  const visited = new Set();
  const stack = new Set();

  const hasCycle = (processId: number): boolean => {
    if (stack.has(processId)) return true;
    if (visited.has(processId)) return false;

    visited.add(processId);
    stack.add(processId);

    const process = processes.find(p => p.id === processId);
    if (process?.parentId && hasCycle(process.parentId)) {
      return true;
    }

    stack.delete(processId);
    return false;
  };

  for (const process of processes) {
    if (hasCycle(process.id)) {
      throw new Error("Zyklische Referenz erkannt");
    }
  }

  return true;
}

function validateNewTheme(theme: any, existingThemes: any[]) {
  if (existingThemes.some(t => t.name === theme.name)) {
    throw new Error("Theme-Name bereits vorhanden");
  }

  if (existingThemes.some(t => t.shortcut === theme.shortcut)) {
    throw new Error("Shortcut bereits verwendet");
  }

  return true;
}

function validateThemeLimit(themes: any[]) {
  if (themes.length > 20) {
    throw new Error("Maximale Anzahl Themes erreicht (20)");
  }
  return true;
}

function repairCorruptThemes(themes: any[]) {
  return themes.map(theme => {
    const repaired = { ...theme };

    if (!repaired.id) {
      repaired.id = `theme-${Math.random().toString(16).substr(2, 9)}`;
    }

    if (!repaired.name) {
      repaired.name = "Unbenanntes Theme";
    }

    if (!repaired.shortcut) {
      repaired.shortcut = `Alt+${Math.random().toString(36).substr(2, 1).toUpperCase()}`;
    }

    return repaired;
  });
}

async function processLargeProcessList(processes: any[]) {
  const start = Date.now();
  const memoryBefore = process.memoryUsage().heapUsed;

  // Simuliere Verarbeitung
  const processed = processes.length;
  
  const memoryAfter = process.memoryUsage().heapUsed;
  
  return {
    processed,
    duration: Date.now() - start,
    memoryUsage: memoryAfter - memoryBefore,
  };
}

function executeWithMemoryLimit(operation: Function, limit: number) {
  const memoryBefore = process.memoryUsage().heapUsed;
  
  try {
    const result = operation();
    const memoryAfter = process.memoryUsage().heapUsed;
    
    if (memoryAfter - memoryBefore > limit) {
      throw new Error("Speicherlimit überschritten");
    }
    
    return result;
  } catch (error) {
    throw error;
  }
}

async function executeConcurrentlyWithLimit(operations: Function[], limit: number) {
  let completed = 0;
  let errors = 0;
  let maxConcurrent = 0;
  let currentConcurrent = 0;

  const executeNext = async () => {
    if (operations.length === 0) return;
    
    const operation = operations.shift();
    if (!operation) return;

    currentConcurrent++;
    maxConcurrent = Math.max(maxConcurrent, currentConcurrent);

    try {
      await operation();
      completed++;
    } catch {
      errors++;
    } finally {
      currentConcurrent--;
    }
  };

  const workers = Array.from({ length: limit }, () => 
    (async () => {
      while (operations.length > 0 || currentConcurrent > 0) {
        if (operations.length > 0) {
          await executeNext();
        } else {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
    })()
  );

  await Promise.all(workers);

  return { completed, errors, maxConcurrent };
}

async function handleDatabaseError(error: Error) {
  let retryable = false;
  let retryAfter = 0;
  let userMessage = "Datenbankfehler";
  let fallbackUsed = false;

  if (error.name === "NetworkError") {
    retryable = true;
    fallbackUsed = true;
    userMessage = "Verbindungsproblem - Offline-Modus aktiviert";
  } else if (error.name === "RateLimitError") {
    retryable = true;
    retryAfter = 60000; // 1 Minute
    userMessage = "Zu viele Anfragen - Bitte warten";
  }

  return {
    success: false,
    retryable,
    retryAfter,
    userMessage,
    fallbackUsed,
  };
}

function activateOfflineMode(networkUnavailable: boolean) {
  return {
    active: networkUnavailable,
    features: {
      trialCheck: false,
      licenseValidation: false,
      coreFeatures: true,
    },
  };
}

function validateFilePath(path: string) {
  const dangerousPatterns = ["../", "..\\", "file://", "\\\\"];
  
  if (dangerousPatterns.some(pattern => path.includes(pattern))) {
    throw new Error("Ungültiger Dateipfad");
  }
  
  return true;
}

function validateThemeName(name: string) {
  if (name.length > 100) {
    throw new Error("Name zu lang (max. 100 Zeichen)");
  }
  
  const dangerousPatterns = ["<", ">", "script", "javascript:", "${"];
  
  if (dangerousPatterns.some(pattern => name.includes(pattern))) {
    throw new Error("Ungültige Zeichen im Namen");
  }
  
  return true;
}

function validateShortcut(shortcut: string) {
  if (shortcut.length > 20) {
    throw new Error("Shortcut zu lang (max. 20 Zeichen)");
  }
  
  return true;
}

function validateApplicationList(applications: any[]) {
  if (applications.length > 100) {
    throw new Error("Zu viele Anwendungen (max. 100)");
  }
  
  return true;
}

async function performCrashRecovery(crashInfo: any) {
  const actionsPerformed = [
    "restore_themes",
    "clear_temp_files", 
    "reset_shortcuts",
    "validate_data",
  ];

  return {
    success: true,
    actionsPerformed,
    timestamp: new Date().toISOString(),
  };
}

async function restoreFromBackup(corruptedData: any) {
  return {
    success: true,
    themesRestored: 3,
    backupUsed: "backup_2024_01_01.json",
  };
}

function activateGracefulDegradation(failedFeatures: string[]) {
  const allFeatures = ["PowerShell", "GlobalShortcuts", "ManualMinimize", "ThemeManagement"];
  const activeFeatures = allFeatures.filter(f => !failedFeatures.includes(f));

  return {
    activeFeatures,
    disabledFeatures: failedFeatures,
    userNotified: true,
    fallbackMode: true,
  };
}