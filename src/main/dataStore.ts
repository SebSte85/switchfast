import { app, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import * as os from "os";
import { PersistentProcessIdentifier } from "../types";
import { createPersistentIdentifier } from "../utils/processUtils";
import { trackEvent } from "./analytics";

// Deklariere globale Variable für TypeScript
declare global {
  var mainWindow: BrowserWindow | null;
}

const THEMES_FILE = "themes.json";

interface Theme {
  id: string;
  name: string;
  applications: number[];
  shortcut: string;
  processes: number[];
  windows?: WindowInfo[];
  color?: string;
  persistentProcesses: PersistentProcessIdentifier[];
}

interface WindowInfo {
  hwnd: number;
  processId: number;
  title: string;
}

export class DataStore {
  private themes: Theme[] = [];
  private dataPath: string;

  constructor() {
    this.dataPath = path.join(os.homedir(), ".workfocusmanager", THEMES_FILE);
    this.ensureDataFileExists();
    this.loadThemes();
  }

  private ensureDataFileExists() {
    const dir = path.dirname(this.dataPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    if (!fs.existsSync(this.dataPath)) {
      fs.writeFileSync(this.dataPath, JSON.stringify([], null, 2));
    }
  }

  private loadThemes(): void {
    const backupPath = this.dataPath + ".bak";

    const _parseThemes = (data: string, filePath: string): Theme[] | null => {
      try {
        if (!data || data.trim() === "") {
          console.warn(`[DataStore] Themedatei ist leer: ${filePath}`);
          return null;
        }
        const loaded = JSON.parse(data);
        // Stelle sicher, dass alle Themen die erforderlichen Felder haben
        return loaded.map((theme: any) => ({
          id: theme.id,
          name: theme.name,
          applications: theme.applications || [],
          shortcut: theme.shortcut || "",
          color: theme.color || "",
          processes: theme.processes || [],
          persistentProcesses: theme.persistentProcesses || [],
          windows: theme.windows || [],
        }));
      } catch (parseError) {
        console.error(
          `[DataStore] Fehler beim Parsen der Themedatei ${filePath}:`,
          parseError
        );
        return null;
      }
    };

    let loadedSuccessfully = false;

    // 1. Versuche, die Hauptdatei zu laden
    if (fs.existsSync(this.dataPath)) {
      try {
        const data = fs.readFileSync(this.dataPath, "utf8");
        const themes = _parseThemes(data, this.dataPath);
        if (themes) {
          this.themes = themes;

          loadedSuccessfully = true;
        }
      } catch (readError) {
        console.error(
          `[DataStore] Fehler beim Lesen von ${this.dataPath}:`,
          readError
        );
      }
    } else {
      console.warn(
        `[DataStore] Haupt-Themedatei ${this.dataPath} nicht gefunden.`
      );
    }

    // 2. Wenn Hauptdatei nicht geladen werden konnte, versuche Backup
    if (!loadedSuccessfully && fs.existsSync(backupPath)) {
      console.warn(
        `[DataStore] Versuche, aus Backup-Datei ${backupPath} zu laden.`
      );
      try {
        const backupData = fs.readFileSync(backupPath, "utf8");
        const backupThemes = _parseThemes(backupData, backupPath);
        if (backupThemes) {
          this.themes = backupThemes;

          loadedSuccessfully = true;
          // Versuche, die Hauptdatei mit den Backup-Daten zu reparieren
          try {
            this.saveThemes(); // Nutzt die neue, robuste saveThemes Methode
          } catch (repairSaveError) {
            console.error(
              `[DataStore] Fehler beim Reparieren von ${this.dataPath} mit Backup-Daten:`,
              repairSaveError
            );
          }
        }
      } catch (backupReadError) {
        console.error(
          `[DataStore] Fehler beim Lesen der Backup-Datei ${backupPath}:`,
          backupReadError
        );
      }
    }

    // 3. Wenn immer noch nicht geladen, initialisiere als leer
    if (!loadedSuccessfully) {
      this.themes = [];
    }
  }

  // Öffentliche Methode zum expliziten Speichern der Themes
  saveThemesToDisk(): void {
    this.saveThemes();
  }

  private saveThemes(): void {
    try {
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const themesToSave = this.themes.map((theme) => ({
        ...theme,
        processes: Array.isArray(theme.processes) ? theme.processes : [],
        persistentProcesses: Array.isArray(theme.persistentProcesses)
          ? theme.persistentProcesses
          : [],
      }));

      const jsonContent = JSON.stringify(themesToSave, null, 2);
      fs.writeFileSync(this.dataPath, jsonContent);

      // Event an den Renderer senden, dass die Themes gespeichert wurden
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send("themes-saved");
      }
    } catch (error) {
      console.error("[DataStore] Fehler beim Speichern der Themes:", error);
    }
  }

  getThemes(): Theme[] {
    return this.themes;
  }

  getTheme(themeId: string): Theme | undefined {
    return this.themes.find((theme) => theme.id === themeId);
  }

  setThemes(themes: Theme[]): void {
    const existingThemes = JSON.parse(JSON.stringify(this.themes));

    const mergedThemes = themes.map((newTheme) => {
      const existingTheme = existingThemes.find(
        (existing: Theme) => existing.id === newTheme.id
      );

      if (existingTheme) {
        return {
          ...newTheme,
          shortcut: existingTheme.shortcut || newTheme.shortcut || "",
          processes: Array.isArray(existingTheme.processes)
            ? existingTheme.processes
            : Array.isArray(newTheme.processes)
            ? newTheme.processes
            : [],
          persistentProcesses: Array.isArray(existingTheme.persistentProcesses)
            ? existingTheme.persistentProcesses
            : Array.isArray(newTheme.persistentProcesses)
            ? newTheme.persistentProcesses
            : [],
          windows: Array.isArray(existingTheme.windows)
            ? existingTheme.windows
            : Array.isArray(newTheme.windows)
            ? newTheme.windows
            : [],
        };
      }

      return {
        ...newTheme,
        shortcut: newTheme.shortcut || "",
        processes: Array.isArray(newTheme.processes) ? newTheme.processes : [],
        persistentProcesses: Array.isArray(newTheme.persistentProcesses)
          ? newTheme.persistentProcesses
          : [],
        windows: Array.isArray(newTheme.windows) ? newTheme.windows : [],
      };
    });

    this.themes = mergedThemes;
    this.saveThemes();
  }

  addTheme(theme: Theme): void {
    // Stelle sicher, dass alle erforderlichen Arrays initialisiert sind
    const newTheme = {
      ...theme,
      processes: theme.processes || [],
      persistentProcesses: theme.persistentProcesses || [],
    };

    // Sichere die aktuellen Themes, bevor wir das neue hinzufügen
    // Dies ist wichtig, um die persistenten Prozesse der bestehenden Themes zu sichern
    const currentThemes = JSON.parse(JSON.stringify(this.themes)); // Tiefe Kopie erstellen

    // Vor dem Hinzufügen des neuen Themes, stelle sicher, dass alle bestehenden Themes
    // ihre Arrays korrekt initialisiert haben
    this.themes = this.themes.map((existingTheme) => ({
      ...existingTheme,
      processes: Array.isArray(existingTheme.processes)
        ? existingTheme.processes
        : [],
      persistentProcesses: Array.isArray(existingTheme.persistentProcesses)
        ? existingTheme.persistentProcesses
        : [],
      windows: Array.isArray(existingTheme.windows)
        ? existingTheme.windows
        : [],
    }));

    // Füge das neue Theme hinzu
    this.themes.push(newTheme);

    // Analytics: Theme erstellt
    trackEvent("theme_created", {
      theme_name: newTheme.name,
      total_themes: this.themes.length,
      has_color: !!newTheme.color,
      has_shortcut: !!newTheme.shortcut,
    });

    this.saveThemes();
  }

  updateTheme(themeId: string, updatedTheme: Theme): void {
    console.log(
      `[DEBUG-DATASTORE] ===== updateTheme START für ${themeId} =====`
    );
    console.log(
      `[DEBUG-DATASTORE] Input Theme:`,
      JSON.stringify(
        {
          id: updatedTheme.id,
          name: updatedTheme.name,
          shortcut: updatedTheme.shortcut,
          processes: (updatedTheme as any).processes,
          persistentProcesses: (updatedTheme as any).persistentProcesses?.map(
            (p: any) => p.executableName
          ),
        },
        null,
        2
      )
    );

    const index = this.themes.findIndex((theme) => theme.id === themeId);
    if (index === -1) {
      console.error(`[DataStore] Theme mit ID ${themeId} nicht gefunden`);
      return;
    }

    // Sichere die aktuellen Themes, bevor wir Änderungen vornehmen
    const currentThemes = JSON.parse(JSON.stringify(this.themes)); // Tiefe Kopie erstellen
    const oldTheme = this.themes[index];

    console.log(
      `[DEBUG-DATASTORE] Altes Theme:`,
      JSON.stringify(
        {
          id: oldTheme.id,
          name: oldTheme.name,
          shortcut: oldTheme.shortcut,
          processes: (oldTheme as any).processes,
          persistentProcesses: (oldTheme as any).persistentProcesses?.map(
            (p: any) => p.executableName
          ),
        },
        null,
        2
      )
    );

    // WICHTIG: Behalte Shortcut bei, falls nicht explizit überschrieben
    const shortcut =
      updatedTheme.shortcut !== undefined
        ? updatedTheme.shortcut
        : oldTheme.shortcut || "";

    // Wenn es persistentProcesses im Original gibt, behalte sie bei
    const persistentProcesses = Array.isArray(
      (oldTheme as any).persistentProcesses
    )
      ? (oldTheme as any).persistentProcesses
      : [];

    // Wenn es processes im Original gibt, behalte sie bei
    const processes = Array.isArray((oldTheme as any).processes)
      ? (oldTheme as any).processes
      : [];

    console.log(
      `[DEBUG-DATASTORE] Behalte bei - shortcut: "${shortcut}", processes: [${processes.join(
        ", "
      )}], persistentProcesses: [${persistentProcesses
        .map((p: any) => p.executableName)
        .join(", ")}]`
    );

    // Kombiniere die vorhandenen applications mit den neuen
    const combinedApplications = [
      ...new Set([
        ...((oldTheme as any).applications
          ? (oldTheme as any).applications
          : []),
        ...(Array.isArray(updatedTheme.applications)
          ? updatedTheme.applications
          : []),
      ]),
    ];

    // Analytics: App zu Theme hinzugefügt
    const oldAppCount = (oldTheme as any).applications?.length || 0;
    const newAppCount = combinedApplications.length;

    if (newAppCount > oldAppCount) {
      // Berechne die tatsächliche Theme-Größe wie im UI
      const totalAppsInTheme =
        processes.length > 0 ? processes.length : combinedApplications.length;

      trackEvent("app_added_to_theme", {
        theme_name: updatedTheme.name,
        apps_in_theme: totalAppsInTheme,
        apps_added: newAppCount - oldAppCount,
      });
    }

    // Aktualisiertes Thema mit allen wichtigen Daten
    this.themes[index] = {
      ...updatedTheme,
      shortcut: shortcut, // WICHTIG: Verwende den erhaltenen Shortcut
      applications: combinedApplications,
      persistentProcesses: persistentProcesses,
      processes: processes,
    } as Theme;

    console.log(
      `[DEBUG-DATASTORE] Neues Theme:`,
      JSON.stringify(
        {
          id: this.themes[index].id,
          name: this.themes[index].name,
          shortcut: this.themes[index].shortcut,
          processes: (this.themes[index] as any).processes,
          persistentProcesses: (
            this.themes[index] as any
          ).persistentProcesses?.map((p: any) => p.executableName),
        },
        null,
        2
      )
    );

    // Speichern
    this.saveThemes();
    console.log(
      `[DEBUG-DATASTORE] ===== updateTheme ENDE für ${themeId} =====`
    );
  }

  // Methode zum Löschen eines Themes anhand seiner ID
  deleteTheme(themeId: string): boolean {
    // Theme-Info für Analytics vor dem Löschen sammeln
    const themeToDelete = this.themes.find((theme) => theme.id === themeId);

    // Anzahl der Themes vor dem Löschen
    const originalLength = this.themes.length;

    // Filtere das zu löschende Theme heraus
    this.themes = this.themes.filter((theme) => theme.id !== themeId);

    // Prüfe, ob ein Theme entfernt wurde
    const newLength = this.themes.length;
    const themeRemoved = originalLength > newLength;

    if (themeRemoved) {
      // Analytics: Theme gelöscht
      trackEvent("theme_deleted", {
        theme_name: themeToDelete?.name || "unknown",
        app_count: themeToDelete?.applications?.length || 0,
        had_shortcut: !!themeToDelete?.shortcut,
        remaining_themes: newLength,
      });

      // Speichere die Änderungen
      this.saveThemes();
      return true;
    }
    return false;
  }

  addWindowsToTheme(
    themeId: string,
    newWindows: WindowInfo[],
    processes?: any[]
  ) {
    const themes = this.getThemes();
    const theme = themes.find((t) => t.id === themeId);

    if (!theme) {
      return;
    }

    // Initialize arrays if they don't exist
    if (!theme.windows) theme.windows = [];
    if (!theme.processes) theme.processes = [];
    if (!theme.applications) theme.applications = [];
    if (!theme.persistentProcesses) theme.persistentProcesses = [];

    // Add each window
    let windowWasAdded = false;
    newWindows.forEach((window) => {
      // Check if window already exists
      const exists = theme.windows!.some((w) => w.hwnd === window.hwnd);

      if (!exists) {
        // Add window to windows array
        theme.windows!.push({
          hwnd: window.hwnd,
          processId: window.processId,
          title: window.title,
        });

        // Add window handle to applications array
        if (!theme.applications.includes(window.hwnd)) {
          theme.applications.push(window.hwnd);

          // Flag für Analytics - Window wurde hinzugefügt
          windowWasAdded = true;
        }

        // WICHTIG: Erstelle auch persistente Identifikatoren für Window-Handles
        // damit sie nach einem Neustart wiederhergestellt werden können
        if (processes) {
          const process = processes.find((p) => p.id === window.processId);
          if (process) {
            // Verwende die gemeinsame createPersistentIdentifier Funktion
            // Diese normalisiert executableName und escaped Steuerzeichen im Titel
            const processWithTitle = {
              ...process,
              title: window.title, // Verwende den Fenstertitel als Pattern
            };
            const persistentId = createPersistentIdentifier(processWithTitle);

            // Prüfen, ob der persistente Identifikator bereits existiert
            const exists = theme.persistentProcesses.some(
              (p) =>
                p.executableName === persistentId.executableName &&
                p.titlePattern === persistentId.titlePattern
            );

            if (!exists) {
              theme.persistentProcesses.push(persistentId);
            }
          }
        }
      }
    });

    // Save changes
    this.saveThemes();

    // Analytics: App zu Theme hinzugefügt (Window-Handle)
    if (windowWasAdded) {
      // Lade das finale gespeicherte Theme, um korrekte Werte zu erhalten
      const finalTheme = this.getTheme(themeId);
      if (finalTheme) {
        // Für Window-Handles verwenden wir die Länge der persistentProcesses oder windows
        // da diese die tatsächlichen hinzugefügten Subprozesse repräsentieren
        const totalAppsInTheme = Math.max(
          finalTheme.processes?.length || 0,
          finalTheme.applications?.length || 0,
          finalTheme.persistentProcesses?.length || 0,
          finalTheme.windows?.length || 0
        );

        trackEvent("app_added_to_theme", {
          theme_name: finalTheme.name,
          apps_in_theme: totalAppsInTheme,
          apps_added: 1,
        });
      }
    }
  }

  removeWindowsFromTheme(themeId: string, windowIds: number[]): void {
    const theme = this.themes.find((t) => t.id === themeId);
    if (!theme || !theme.windows) {
      return;
    }

    // Sammle die Titel der zu entfernenden Fenster für die Bereinigung persistenter Identifikatoren
    const windowTitlesToRemove = theme.windows
      .filter((w) => windowIds.includes(w.hwnd))
      .map((w) => w.title);

    console.log(
      `[DataStore] Entferne ${windowIds.length} Fenster aus Thema ${themeId}`
    );

    // Entferne Fenster aus dem windows Array
    theme.windows = theme.windows.filter((w) => !windowIds.includes(w.hwnd));

    // Entferne auch aus dem applications Array für Konsistenz
    theme.applications = theme.applications.filter((id) => {
      // If id is a window handle and it's in the windowIds to remove, filter it out
      return typeof id === "number" && !windowIds.includes(id);
    });

    // WICHTIG: Entferne auch die entsprechenden persistenten Identifikatoren
    if (theme.persistentProcesses && windowTitlesToRemove.length > 0) {
      const originalPersistentCount = theme.persistentProcesses.length;

      theme.persistentProcesses = theme.persistentProcesses.filter(
        (persistentProcess) => {
          // Entferne persistente Identifikatoren, deren titlePattern mit einem der entfernten Fenster übereinstimmt
          const shouldRemove = windowTitlesToRemove.some((title) => {
            // WICHTIG: Intelligenter Vergleich der Titel
            // Problem: title enthält echte Steuerzeichen (\x07 = Byte 7)
            // titlePattern enthält literal "\x07" String (4 Bytes: \, x, 0, 7)
            // Lösung: Konvertiere literal hex-escapes zu echten Steuerzeichen vor Vergleich

            const titleWithRealControlChars = title; // Bereits echte Steuerzeichen
            const patternWithRealControlChars = (
              persistentProcess.titlePattern || ""
            ).replace(/\\x([0-9A-Fa-f]{2})/g, (match, hex) => {
              return String.fromCharCode(parseInt(hex, 16));
            });

            return patternWithRealControlChars === titleWithRealControlChars;
          });

          if (shouldRemove) {
            console.log(
              `[DataStore] Entferne persistenten Identifikator für "${persistentProcess.titlePattern}"`
            );
          }

          return !shouldRemove;
        }
      );

      const removedPersistentCount =
        originalPersistentCount - theme.persistentProcesses.length;
      if (removedPersistentCount > 0) {
        console.log(
          `[DataStore] ${removedPersistentCount} persistente Identifikatoren entfernt`
        );
      }
    }

    this.saveThemes();
  }

  // Methode zum Hinzufügen eines persistenten Prozesses zu einem Thema
  addPersistentProcessToTheme(
    themeId: string,
    persistentProcess: PersistentProcessIdentifier
  ): void {
    const theme = this.themes.find((t) => t.id === themeId);

    if (theme) {
      // Sicherstellen, dass persistentProcesses existiert
      if (!theme.persistentProcesses) {
        theme.persistentProcesses = [];
      }

      // Prüfen, ob der persistente Prozess bereits existiert
      const exists = theme.persistentProcesses.some(
        (p) => p.executableName === persistentProcess.executableName
      );

      if (!exists) {
        theme.persistentProcesses.push(persistentProcess);
        this.saveThemes();
      }
    }
  }

  // Methode zum Entfernen eines persistenten Prozesses aus einem Thema
  removePersistentProcessFromTheme(
    themeId: string,
    executableName: string
  ): boolean {
    const theme = this.getTheme(themeId);
    if (!theme || !theme.persistentProcesses) {
      return false;
    }

    // Speichere die ursprüngliche Länge, um zu prüfen, ob ein Element entfernt wurde
    const originalLength = theme.persistentProcesses.length;

    // Entferne den persistenten Prozess mit case-insensitive Vergleich
    theme.persistentProcesses = theme.persistentProcesses.filter(
      (process) =>
        process.executableName.toLowerCase() !== executableName.toLowerCase()
    );

    // Prüfe, ob ein Element entfernt wurde
    const removed = theme.persistentProcesses.length < originalLength;

    if (removed) {
      console.log(
        `[DataStore] Persistenter Prozess '${executableName}' aus Thema ${themeId} entfernt.`
      );
      this.saveThemes(); // Speichere die Änderungen sofort
    }

    return removed;
  }

  /**
   * Entfernt einen Prozess und seinen persistenten Identifikator aus einem Thema in einem atomaren Schritt.
   * @param themeId Die ID des Themas
   * @param processId Die ID des zu entfernenden Prozesses
   * @param executableName Optional: Der Name der ausführbaren Datei des persistenten Prozesses
   * @returns Ein Objekt mit Informationen über die entfernten Elemente
   */
  removeProcessAndPersistentFromTheme(
    themeId: string,
    processId: number,
    executableName?: string
  ): { processRemoved: boolean; persistentRemoved: boolean } {
    console.log(
      `[DataStore] Entferne Prozess ${processId} und persistenten Prozess ${
        executableName || "N/A"
      } aus Thema ${themeId}`
    );

    // Standardwerte für die Rückgabe
    const result = {
      processRemoved: false,
      persistentRemoved: false,
    };

    // Thema finden
    const theme = this.getTheme(themeId);
    if (!theme) {
      console.error(`[DataStore] Thema mit ID ${themeId} nicht gefunden.`);
      return result;
    }

    // Prozess-ID entfernen, falls vorhanden und nicht -1
    if (processId !== -1) {
      // -1 bedeutet, dass wir nur den persistenten Prozess entfernen wollen
      if (!theme.processes) {
        theme.processes = [];
      }

      const processIndex = theme.processes.indexOf(processId);
      if (processIndex !== -1) {
        // Prozess aus dem Array entfernen
        theme.processes.splice(processIndex, 1);
        result.processRemoved = true;
        console.log(
          `[DataStore] Prozess ${processId} erfolgreich aus Thema ${themeId} entfernt.`
        );
      } else {
        console.log(
          `[DataStore] Prozess ${processId} nicht im Thema ${themeId} gefunden.`
        );
      }
    }

    // Persistenten Prozess entfernen, falls ein Name angegeben wurde
    if (executableName) {
      if (!theme.persistentProcesses) {
        theme.persistentProcesses = [];
      }

      // Normalisiere den executableName für den Vergleich
      const normalizedName = executableName.toLowerCase();
      console.log(
        `[DataStore] Suche nach persistentem Prozess mit normalisiertem Namen: ${normalizedName}`
      );

      // Anzahl der persistenten Prozesse vor der Filterung
      const originalLength = theme.persistentProcesses.length;

      // Logge alle persistenten Prozesse vor der Filterung
      console.log(
        `[DataStore] Persistente Prozesse vor der Filterung:`,
        theme.persistentProcesses
      );

      // Filtere alle persistenten Prozesse heraus, deren executableName mit dem gesuchten übereinstimmt
      // Wichtig: Case-insensitive Vergleich, um Probleme mit Groß-/Kleinschreibung zu vermeiden
      theme.persistentProcesses = theme.persistentProcesses.filter(
        (process) => {
          // Normalisiere auch den Namen des persistenten Prozesses
          const normalizedProcessName = process.executableName.toLowerCase();
          // Behalte den Prozess nur, wenn sein Name NICHT mit dem zu entfernenden übereinstimmt
          const shouldKeep = normalizedProcessName !== normalizedName;
          console.log(
            `[DataStore] Vergleiche '${normalizedProcessName}' mit '${normalizedName}': ${
              shouldKeep ? "behalten" : "entfernen"
            }`
          );
          return shouldKeep;
        }
      );

      // Prüfe, ob Prozesse entfernt wurden
      const newLength = theme.persistentProcesses.length;
      if (originalLength > newLength) {
        result.persistentRemoved = true;
        console.log(
          `[DataStore] Persistenter Prozess ${executableName} erfolgreich aus Thema ${themeId} entfernt.`
        );
      } else {
        console.log(
          `[DataStore] Kein persistenter Prozess mit Namen ${executableName} im Thema ${themeId} gefunden.`
        );
        console.log(
          `[DataStore] Persistente Prozesse nach der Filterung:`,
          theme.persistentProcesses
        );
      }
    }

    // Nur speichern, wenn tatsächlich Änderungen vorgenommen wurden
    if (result.processRemoved || result.persistentRemoved) {
      console.log(
        `[DataStore] Speichere Thema ${themeId} mit ${
          theme.persistentProcesses?.length || 0
        } persistenten Prozessen und ${theme.processes?.length || 0} Prozessen`
      );
      this.saveThemes();
    }

    return result;
  }

  // Methode zum Abrufen aller persistenten Prozesse für ein Thema
  getPersistentProcessesForTheme(
    themeId: string
  ): PersistentProcessIdentifier[] {
    const theme = this.themes.find((t) => t.id === themeId);
    return theme?.persistentProcesses || [];
  }

  getAllAssignedWindows(): Set<number> {
    const assignedWindows = new Set<number>();
    this.themes.forEach((theme) => {
      if (theme.windows) {
        theme.windows.forEach((window) => {
          assignedWindows.add(window.hwnd);
        });
      }
    });
    return assignedWindows;
  }

  /**
   * Bereinigt konflikthafte Prozess-IDs
   * Entfernt Prozess-IDs aus Themes, die bereits Window-Handles haben
   */
  cleanupConflictingProcessIds(): void {
    console.log(
      `[DEBUG-CLEANUP] ===== cleanupConflictingProcessIds START =====`
    );
    let hasChanges = false;

    // Erste Durchgang: Sammle alle Prozess-IDs und ihre Theme-Zugehörigkeiten
    const processIdToThemeIds = new Map<number, string[]>();

    this.themes.forEach((theme) => {
      console.log(
        `[DEBUG-CLEANUP] Theme ${theme.name}: processes = [${
          (theme as any).processes?.join(", ") || "keine"
        }]`
      );
      if ((theme as any).processes) {
        (theme as any).processes.forEach((processId: number) => {
          if (!processIdToThemeIds.has(processId)) {
            processIdToThemeIds.set(processId, []);
          }
          processIdToThemeIds.get(processId)!.push(theme.id);
        });
      }
    });

    console.log(
      `[DEBUG-CLEANUP] Prozess-zu-Theme Mapping:`,
      Array.from(processIdToThemeIds.entries())
    );

    // VERBESSERTE LOGIK: Finde Prozess-IDs die in mehreren Themes vorkommen
    const conflictingProcessIds = new Map<number, string[]>();
    processIdToThemeIds.forEach((themeIds, processId) => {
      if (themeIds.length > 1) {
        conflictingProcessIds.set(processId, themeIds);
      }
    });

    console.log(
      `[DEBUG-CLEANUP] Konflikthafte Prozess-IDs:`,
      Array.from(conflictingProcessIds.entries())
    );

    if (conflictingProcessIds.size > 0) {
      console.log(
        `[DataStore] Gefunden ${conflictingProcessIds.size} konflikthafte Prozess-IDs:`,
        conflictingProcessIds
      );

      // Für jede konflikthafte Prozess-ID, entferne sie aus Themes die Window-Handles haben
      conflictingProcessIds.forEach((themeIds, processId) => {
        console.log(
          `[DEBUG-CLEANUP] Verarbeite konflikthafte Prozess-ID ${processId} in Themes: [${themeIds.join(
            ", "
          )}]`
        );

        // Sammle Themes mit und ohne Window-Handles
        const themesWithWindows: string[] = [];
        const themesWithoutWindows: string[] = [];

        themeIds.forEach((themeId) => {
          const theme = this.themes.find((t) => t.id === themeId);
          if (
            theme &&
            (theme as any).windows &&
            (theme as any).windows.length > 0
          ) {
            themesWithWindows.push(themeId);
          } else {
            themesWithoutWindows.push(themeId);
          }
        });

        console.log(
          `[DEBUG-CLEANUP] Prozess ${processId}: Themes mit Windows [${themesWithWindows.join(
            ", "
          )}], ohne Windows [${themesWithoutWindows.join(", ")}]`
        );

        // Wenn mindestens ein Theme Window-Handles hat, entferne die Prozess-ID aus ALLEN anderen Themes
        if (themesWithWindows.length > 0) {
          themeIds.forEach((themeId) => {
            const theme = this.themes.find((t) => t.id === themeId);
            if (theme) {
              // Entferne die Prozess-ID aus diesem Theme (egal ob es Windows hat oder nicht)
              // Browser-Prozesse sollen nur über Window-Handles verwaltet werden
              const index = (theme as any).processes.indexOf(processId);
              if (index > -1) {
                (theme as any).processes.splice(index, 1);
                hasChanges = true;
                console.log(
                  `[DataStore] Entfernt Prozess-ID ${processId} aus Theme "${theme.name}" da Browser-Prozesse über Window-Handles verwaltet werden`
                );
              }
            }
          });
        }
      });
    }

    if (hasChanges) {
      console.log("[DataStore] Speichere bereinigte Theme-Daten...");
      this.saveThemes();
      console.log(`[DEBUG-CLEANUP] Themes nach Bereinigung gespeichert`);
    } else {
      console.log(
        "[DataStore] Keine konflikthafte Prozess-IDs gefunden, keine Bereinigung nötig"
      );
    }
    console.log(
      `[DEBUG-CLEANUP] ===== cleanupConflictingProcessIds ENDE =====`
    );
  }

  /**
   * Löscht alle lokalen Theme-Daten (für Account-Löschung)
   */
  clearAllData(): void {
    console.log("[DataStore] Clearing all theme data...");
    this.themes = [];
    this.saveThemes();
    console.log("[DataStore] All theme data cleared");
  }
}
