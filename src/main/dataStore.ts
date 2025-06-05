import { app, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import * as os from "os";
import { PersistentProcessIdentifier } from "../types";

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
          windows: theme.windows || []
        }));
      } catch (parseError) {
        console.error(`[DataStore] Fehler beim Parsen der Themedatei ${filePath}:`, parseError);
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
          console.log(`[DataStore] ${this.themes.length} Themen erfolgreich aus ${this.dataPath} geladen.`);
          loadedSuccessfully = true;
        }
      } catch (readError) {
        console.error(`[DataStore] Fehler beim Lesen von ${this.dataPath}:`, readError);
      }
    } else {
      console.warn(`[DataStore] Haupt-Themedatei ${this.dataPath} nicht gefunden.`);
    }

    // 2. Wenn Hauptdatei nicht geladen werden konnte, versuche Backup
    if (!loadedSuccessfully && fs.existsSync(backupPath)) {
      console.warn(`[DataStore] Versuche, aus Backup-Datei ${backupPath} zu laden.`);
      try {
        const backupData = fs.readFileSync(backupPath, "utf8");
        const backupThemes = _parseThemes(backupData, backupPath);
        if (backupThemes) {
          this.themes = backupThemes;
          console.log(`[DataStore] ${this.themes.length} Themen erfolgreich aus Backup ${backupPath} geladen.`);
          loadedSuccessfully = true;
          // Versuche, die Hauptdatei mit den Backup-Daten zu reparieren
          try {
            console.log(`[DataStore] Versuche, ${this.dataPath} mit Daten aus Backup zu reparieren.`);
            this.saveThemes(); // Nutzt die neue, robuste saveThemes Methode
          } catch (repairSaveError) {
            console.error(`[DataStore] Fehler beim Reparieren von ${this.dataPath} mit Backup-Daten:`, repairSaveError);
          }
        }
      } catch (backupReadError) {
        console.error(`[DataStore] Fehler beim Lesen der Backup-Datei ${backupPath}:`, backupReadError);
      }
    }

    // 3. Wenn immer noch nicht geladen, initialisiere als leer
    if (!loadedSuccessfully) {
      console.warn("[DataStore] Weder Haupt- noch Backup-Themedatei konnte geladen werden. Initialisiere mit leeren Themes.");
      this.themes = [];
    }
  }

  // Öffentliche Methode zum expliziten Speichern der Themes
  saveThemesToDisk(): void {
    this.saveThemes();
  }

  private saveThemes(): void {
    const backupPath = this.dataPath + ".bak";

    try {
      // 1. Backup der aktuellen themes.json erstellen, falls sie existiert
      if (fs.existsSync(this.dataPath)) {
        // Alte .bak-Datei löschen, falls vorhanden
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
        fs.renameSync(this.dataPath, backupPath);
        console.log(`[DataStore] Backup erstellt: ${this.dataPath} -> ${backupPath}`);
      }

      // 2. Sicherstellen, dass der Ordner existiert
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 3. Aktuellen In-Memory-Zustand (this.themes) in themes.json schreiben
      //    Sicherstellen, dass alle Themes die notwendigen Felder haben und bestehende Daten beibehalten werden
      const themesToSave = this.themes.map(theme => {
        // Stelle sicher, dass wir alle vorhandenen Felder des Themes beibehalten
        // und nur fehlende Felder mit Standardwerten initialisieren
        return {
          ...theme, // Behalte alle vorhandenen Eigenschaften bei
          id: theme.id,
          name: theme.name,
          // Verwende die vorhandenen Arrays, wenn sie existieren, sonst leere Arrays
          applications: Array.isArray(theme.applications) ? theme.applications : [],
          shortcut: theme.shortcut || "",
          color: theme.color || "",
          // WICHTIG: Stelle sicher, dass processes und persistentProcesses korrekt beibehalten werden
          processes: Array.isArray(theme.processes) ? theme.processes : [],
          persistentProcesses: Array.isArray(theme.persistentProcesses) ? theme.persistentProcesses : [],
          windows: Array.isArray(theme.windows) ? theme.windows : []
        };
      });

      // Für Debugging: Zeige die zu speichernden Themes an
      console.log(`[DataStore] Speichere ${themesToSave.length} Themes. Erstes Theme:`, 
                 themesToSave.length > 0 ? JSON.stringify(themesToSave[0], null, 2) : 'Keine Themes');

      const jsonContent = JSON.stringify(themesToSave, null, 2);
      fs.writeFileSync(this.dataPath, jsonContent);

      console.log(`[DataStore] Themes erfolgreich in ${this.dataPath} gespeichert.`);
      
      // Event an den Renderer senden, dass die Themes gespeichert wurden
      if (global.mainWindow && !global.mainWindow.isDestroyed()) {
        global.mainWindow.webContents.send('themes-saved');
        console.log(`[DataStore] Event 'themes-saved' an Renderer gesendet`);
      } else {
        console.log(`[DataStore] Konnte Event 'themes-saved' nicht senden, mainWindow nicht verfügbar`);
      }

    } catch (error) {
      console.error(`[DataStore] Fehler beim Speichern der Themes:`, error);

      // 4. Bei Fehler versuchen, aus dem Backup wiederherzustellen
      try {
        if (fs.existsSync(backupPath)) {
          // Geschriebene, potenziell korrupte Datei löschen
          if (fs.existsSync(this.dataPath)) {
            fs.unlinkSync(this.dataPath);
          }
          fs.renameSync(backupPath, this.dataPath);
          console.log(`[DataStore] Wiederherstellung aus Backup erfolgreich: ${backupPath} -> ${this.dataPath}`);
        } else {
          console.warn(`[DataStore] Kein Backup (${backupPath}) für Wiederherstellung gefunden.`);
        }
      } catch (restoreError) {
        console.error(`[DataStore] Kritischer Fehler beim Wiederherstellen aus Backup:`, restoreError);
        // An dieser Stelle könnte die themes.json fehlen oder korrupt sein, und das Backup auch.
      }
      // Den ursprünglichen Speicherfehler weiterwerfen, damit er behandelt werden kann
      throw error;
    }
  }

  getThemes(): Theme[] {
    return this.themes;
  }

  
  getTheme(themeId: string): Theme | undefined {
    return this.themes.find(theme => theme.id === themeId);
  }

  setThemes(themes: Theme[]): void {
    // Sichere die aktuellen Themes, um Daten zu erhalten
    const currentThemes = [...this.themes];
    
    // Erstelle eine Map der aktuellen Themes nach ID für schnellen Zugriff
    const currentThemesMap = new Map<string, Theme>();
    currentThemes.forEach(theme => {
      currentThemesMap.set(theme.id, theme);
    });
    
    // Für jedes neue Theme, behalte die persistentProcesses und processes aus dem aktuellen Theme bei,
    // wenn sie nicht im neuen Theme definiert sind
    const mergedThemes = themes.map(newTheme => {
      const currentTheme = currentThemesMap.get(newTheme.id);
      
      // Wenn es kein entsprechendes aktuelles Theme gibt, verwende das neue Theme unverändert
      if (!currentTheme) {
        return {
          ...newTheme,
          processes: Array.isArray(newTheme.processes) ? newTheme.processes : [],
          persistentProcesses: Array.isArray(newTheme.persistentProcesses) ? newTheme.persistentProcesses : [],
          windows: Array.isArray(newTheme.windows) ? newTheme.windows : []
        };
      }
      
      // Behalte die persistentProcesses und processes bei, wenn sie im neuen Theme nicht definiert sind
      return {
        ...newTheme,
        processes: Array.isArray(newTheme.processes) && newTheme.processes.length > 0 
          ? newTheme.processes 
          : (Array.isArray(currentTheme.processes) ? currentTheme.processes : []),
        persistentProcesses: Array.isArray(newTheme.persistentProcesses) && newTheme.persistentProcesses.length > 0 
          ? newTheme.persistentProcesses 
          : (Array.isArray(currentTheme.persistentProcesses) ? currentTheme.persistentProcesses : []),
        windows: Array.isArray(newTheme.windows) && newTheme.windows.length > 0 
          ? newTheme.windows 
          : (Array.isArray(currentTheme.windows) ? currentTheme.windows : [])
      };
    });
    
    // Debug-Ausgabe
    if (mergedThemes.length > 0) {
      const firstTheme = mergedThemes[0];
      console.log(`[DataStore] setThemes - Erstes Theme nach Zusammenführung: ${firstTheme.name}, ` +
                  `processes: ${firstTheme.processes?.length || 0}, ` +
                  `persistentProcesses: ${firstTheme.persistentProcesses?.length || 0}`);
    }
    
    this.themes = mergedThemes;
    this.saveThemes();
  }

  addTheme(theme: Theme): void {
    // Stelle sicher, dass alle erforderlichen Arrays initialisiert sind
    const newTheme = {
      ...theme,
      processes: theme.processes || [],
      persistentProcesses: theme.persistentProcesses || []
    };
    
    // Sichere die aktuellen Themes, bevor wir das neue hinzufügen
    // Dies ist wichtig, um die persistenten Prozesse der bestehenden Themes zu sichern
    const currentThemes = JSON.parse(JSON.stringify(this.themes)); // Tiefe Kopie erstellen
    
    // Vor dem Hinzufügen des neuen Themes, stelle sicher, dass alle bestehenden Themes
    // ihre Arrays korrekt initialisiert haben
    this.themes = this.themes.map(existingTheme => ({
      ...existingTheme,
      processes: Array.isArray(existingTheme.processes) ? existingTheme.processes : [],
      persistentProcesses: Array.isArray(existingTheme.persistentProcesses) ? existingTheme.persistentProcesses : [],
      windows: Array.isArray(existingTheme.windows) ? existingTheme.windows : []
    }));
    
    // Füge das neue Theme hinzu
    this.themes.push(newTheme);
    console.log(`[DataStore] Neues Thema hinzugefügt: ${newTheme.name} (${newTheme.id})`);
    
    // Für Debugging: Zeige den Zustand der Themes vor dem Speichern
    if (this.themes.length > 1) {
      const firstTheme = this.themes[0];
      console.log(`[DataStore] Vor dem Speichern - Erstes Theme: ${firstTheme.name}, ` +
                  `processes: ${firstTheme.processes?.length || 0}, ` +
                  `persistentProcesses: ${firstTheme.persistentProcesses?.length || 0}`);
    }
    
    // Speichere die Themes
    try {
      this.saveThemes();
    } catch (error) {
      // Bei einem Fehler stellen wir den vorherigen Zustand wieder her
      console.error(`[DataStore] Fehler beim Speichern nach Hinzufügen des Themes:`, error);
      this.themes = currentThemes;
      throw error;
    }
  }
  
  updateTheme(themeId: string, updatedTheme: Theme): void {
    console.log(`[DataStore] Updating theme ${themeId}:`, updatedTheme);

    const index = this.themes.findIndex((t) => t.id === themeId);
    if (index !== -1) {
      // Sichere den aktuellen Zustand aller Themes, bevor wir Änderungen vornehmen
      const currentThemes = [...this.themes];
      
      const existingTheme = this.themes[index];
      console.log(`[DataStore] Existing theme:`, existingTheme);

      // Behalte existierende Fenster-Handles
      const existingWindowHandles = (existingTheme.applications || []).filter(
        (id) => id >= 100000
      );
      console.log(
        `[DataStore] Existing window handles:`,
        existingWindowHandles
      );

      // Neue Anwendungs-IDs (keine Fenster-Handles)
      const newApplications = (updatedTheme.applications || []).filter(
        (id) => id < 100000
      );
      console.log(`[DataStore] New applications:`, newApplications);

      // Kombiniere existierende Fenster mit neuen Anwendungen
      const combinedApplications = [
        ...newApplications,
        ...existingWindowHandles,
      ];
      console.log(`[DataStore] Combined applications:`, combinedApplications);
      
      // WICHTIG: Stelle sicher, dass persistente Prozesse korrekt beibehalten werden
      // Wenn updatedTheme persistentProcesses enthält, verwende diese
      // Andernfalls behalte die existierenden persistentProcesses bei
      const persistentProcesses = updatedTheme.persistentProcesses && updatedTheme.persistentProcesses.length > 0 
        ? updatedTheme.persistentProcesses 
        : existingTheme.persistentProcesses || [];
      
      console.log(`[DataStore] Persistent processes (${persistentProcesses.length}):`, persistentProcesses);
      
      // Prozess-IDs beibehalten
      const processes = updatedTheme.processes || existingTheme.processes || [];
      console.log(`[DataStore] Processes:`, processes);

      // Aktualisiertes Thema mit allen wichtigen Daten
      this.themes[index] = {
        ...updatedTheme,
        applications: combinedApplications,
        persistentProcesses: persistentProcesses,
        processes: processes
      };

      console.log(`[DataStore] Final updated theme:`, this.themes[index]);
      
      try {
        this.saveThemes();
      } catch (error) {
        // Bei einem Fehler stellen wir den vorherigen Zustand wieder her
        console.error(`[DataStore] Fehler beim Speichern nach Aktualisieren des Themes:`, error);
        this.themes = currentThemes;
        throw error;
      }
    }
  }

  deleteTheme(themeId: string): void {
    this.themes = this.themes.filter((t) => t.id !== themeId);
    this.saveThemes();
  }

  addWindowsToTheme(themeId: string, newWindows: WindowInfo[]) {
    console.log(`[DataStore] Adding windows to theme ${themeId}:`, newWindows);

    const themes = this.getThemes();
    const theme = themes.find((t) => t.id === themeId);

    if (!theme) {
      console.log(`[DataStore] Theme ${themeId} not found`);
      return;
    }

    console.log(`[DataStore] Current theme state:`, theme);

    // Initialize arrays if they don't exist
    if (!theme.windows) theme.windows = [];
    if (!theme.processes) theme.processes = [];
    if (!theme.applications) theme.applications = [];

    // Add each window
    newWindows.forEach((window) => {
      // Check if window already exists
      const exists = theme.windows!.some((w) => w.hwnd === window.hwnd);
      console.log(`[DataStore] Window ${window.hwnd} exists? ${exists}`);

      if (!exists) {
        // Add window to windows array
        theme.windows!.push({
          hwnd: window.hwnd,
          processId: window.processId,
          title: window.title,
        });

        // Add process ID to processes array if not already there
        if (!theme.processes.includes(window.processId)) {
          theme.processes.push(window.processId);
          console.log(`[DataStore] Added process ID ${window.processId}`);
        }

        // Add window handle to applications array
        if (!theme.applications.includes(window.hwnd)) {
          theme.applications.push(window.hwnd);
          console.log(
            `[DataStore] Added window handle ${window.hwnd} to applications`
          );
        }
      }
    });

    console.log(`[DataStore] Final theme state:`, theme);

    // Save changes
    this.saveThemes();
  }

  removeWindowsFromTheme(themeId: string, windowIds: number[]): void {
    const theme = this.themes.find((t) => t.id === themeId);
    if (!theme || !theme.windows) {
      return;
    }

    theme.windows = theme.windows.filter((w) => !windowIds.includes(w.hwnd));

    // Also remove from applications array to ensure consistency
    theme.applications = theme.applications.filter((id) => {
      // If id is a window handle and it's in the windowIds to remove, filter it out
      return typeof id === "number" && !windowIds.includes(id);
    });

    this.saveThemes();
  }

  // Methode zum Hinzufügen eines persistenten Prozesses zu einem Thema
  addPersistentProcessToTheme(themeId: string, persistentProcess: PersistentProcessIdentifier): void {
    const theme = this.themes.find((t) => t.id === themeId);
    
    if (theme) {
      // Sicherstellen, dass persistentProcesses existiert
      if (!theme.persistentProcesses) {
        theme.persistentProcesses = [];
      }
      
      // Prüfen, ob der persistente Prozess bereits existiert
      const exists = theme.persistentProcesses.some(
        p => p.executableName === persistentProcess.executableName
      );
      
      if (!exists) {
        theme.persistentProcesses.push(persistentProcess);
        this.saveThemes();
      }
    }
  }
  
  // Methode zum Entfernen eines persistenten Prozesses aus einem Thema
  removePersistentProcessFromTheme(themeId: string, executableName: string): boolean {
    const theme = this.getTheme(themeId);
    if (!theme || !theme.persistentProcesses) {
      return false;
    }

    // Speichere die ursprüngliche Länge, um zu prüfen, ob ein Element entfernt wurde
    const originalLength = theme.persistentProcesses.length;

    // Entferne den persistenten Prozess mit case-insensitive Vergleich
    theme.persistentProcesses = theme.persistentProcesses.filter(
      (process) => process.executableName.toLowerCase() !== executableName.toLowerCase()
    );

    // Prüfe, ob ein Element entfernt wurde
    const removed = theme.persistentProcesses.length < originalLength;

    if (removed) {
      console.log(`[DataStore] Persistenter Prozess '${executableName}' aus Thema ${themeId} entfernt.`);
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
  removeProcessAndPersistentFromTheme(themeId: string, processId: number, executableName?: string): { processRemoved: boolean, persistentRemoved: boolean } {
    console.log(`[DataStore] Entferne Prozess ${processId} und persistenten Prozess ${executableName || 'N/A'} aus Thema ${themeId}`);
    
    // Standardwerte für die Rückgabe
    const result = {
      processRemoved: false,
      persistentRemoved: false
    };
    
    // Thema finden
    const theme = this.getTheme(themeId);
    if (!theme) {
      console.error(`[DataStore] Thema mit ID ${themeId} nicht gefunden.`);
      return result;
    }
    
    // Prozess-ID entfernen, falls vorhanden und nicht -1
    if (processId !== -1) { // -1 bedeutet, dass wir nur den persistenten Prozess entfernen wollen
      if (!theme.processes) {
        theme.processes = [];
      }
      
      const processIndex = theme.processes.indexOf(processId);
      if (processIndex !== -1) {
        // Prozess aus dem Array entfernen
        theme.processes.splice(processIndex, 1);
        result.processRemoved = true;
        console.log(`[DataStore] Prozess ${processId} erfolgreich aus Thema ${themeId} entfernt.`);
      } else {
        console.log(`[DataStore] Prozess ${processId} nicht im Thema ${themeId} gefunden.`);
      }
    }
    
    // Persistenten Prozess entfernen, falls ein Name angegeben wurde
    if (executableName) {
      if (!theme.persistentProcesses) {
        theme.persistentProcesses = [];
      }
      
      // Normalisiere den executableName für den Vergleich
      const normalizedName = executableName.toLowerCase();
      console.log(`[DataStore] Suche nach persistentem Prozess mit normalisiertem Namen: ${normalizedName}`);
      
      // Anzahl der persistenten Prozesse vor der Filterung
      const originalLength = theme.persistentProcesses.length;
      
      // Logge alle persistenten Prozesse vor der Filterung
      console.log(`[DataStore] Persistente Prozesse vor der Filterung:`, theme.persistentProcesses);
      
      // Filtere alle persistenten Prozesse heraus, deren executableName mit dem gesuchten übereinstimmt
      // Wichtig: Case-insensitive Vergleich, um Probleme mit Groß-/Kleinschreibung zu vermeiden
      theme.persistentProcesses = theme.persistentProcesses.filter(process => {
        // Normalisiere auch den Namen des persistenten Prozesses
        const normalizedProcessName = process.executableName.toLowerCase();
        // Behalte den Prozess nur, wenn sein Name NICHT mit dem zu entfernenden übereinstimmt
        const shouldKeep = normalizedProcessName !== normalizedName;
        console.log(`[DataStore] Vergleiche '${normalizedProcessName}' mit '${normalizedName}': ${shouldKeep ? 'behalten' : 'entfernen'}`);
        return shouldKeep;
      });
      
      // Prüfe, ob Prozesse entfernt wurden
      const newLength = theme.persistentProcesses.length;
      if (originalLength > newLength) {
        result.persistentRemoved = true;
        console.log(`[DataStore] Persistenter Prozess ${executableName} erfolgreich aus Thema ${themeId} entfernt.`);
      } else {
        console.log(`[DataStore] Kein persistenter Prozess mit Namen ${executableName} im Thema ${themeId} gefunden.`);
        console.log(`[DataStore] Persistente Prozesse nach der Filterung:`, theme.persistentProcesses);
      }
    }
    
    // Nur speichern, wenn tatsächlich Änderungen vorgenommen wurden
    if (result.processRemoved || result.persistentRemoved) {
      console.log(`[DataStore] Speichere Thema ${themeId} mit ${theme.persistentProcesses?.length || 0} persistenten Prozessen und ${theme.processes?.length || 0} Prozessen`);
      this.saveThemes();
    }
    
    return result;
  }

  
  // Methode zum Abrufen aller persistenten Prozesse für ein Thema
  getPersistentProcessesForTheme(themeId: string): PersistentProcessIdentifier[] {
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
}
