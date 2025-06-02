import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { PersistentProcessIdentifier } from "../types";

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
    try {
      const data = fs.readFileSync(this.dataPath, "utf8");
      const loadedThemes = JSON.parse(data);
      
      // Stelle sicher, dass alle Themen die erforderlichen Felder haben
      this.themes = loadedThemes.map((theme: any) => ({
        ...theme,
        processes: theme.processes || [],
        persistentProcesses: theme.persistentProcesses || []
      }));
      
      console.log(`[DataStore] ${this.themes.length} Themen geladen.`);
    } catch (error) {
      console.error(`[DataStore] Fehler beim Laden der Themen:`, error);
      this.themes = [];
    }
  }

  private saveThemes(): void {
    try {
      // Erstelle den Ordner, falls er nicht existiert
      const dir = path.dirname(this.dataPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Bereite die Themes für die Speicherung vor und stelle sicher, dass alle wichtigen Felder enthalten sind
      const themesToSave = this.themes.map(theme => {
        // Stelle sicher, dass alle Arrays initialisiert sind
        const processes = theme.processes || [];
        const persistentProcesses = theme.persistentProcesses || [];
        const applications = theme.applications || [];
        
        console.log(`[DataStore] Speichere Thema ${theme.id} mit ${persistentProcesses.length} persistenten Prozessen und ${processes.length} Prozessen`);
        
        // Erstelle ein vollständiges Objekt mit allen erforderlichen Feldern
        // Wichtig: Wir erstellen ein neues Objekt, um sicherzustellen, dass keine Referenzen bestehen bleiben
        const themeToSave = {
          id: theme.id,
          name: theme.name,
          applications: applications,
          shortcut: theme.shortcut,
          color: theme.color || '',
          processes: processes,
          persistentProcesses: persistentProcesses
        };
        
        return themeToSave;
      });

      // Speichere die Themes mit expliziter Formatierung
      const jsonContent = JSON.stringify(themesToSave, null, 2);
      fs.writeFileSync(this.dataPath, jsonContent);
      
      // Logge den Inhalt der gespeicherten Datei zur Überprüfung
      console.log(`[DataStore] Themes erfolgreich in ${this.dataPath} gespeichert:`);
      console.log(jsonContent);
    } catch (error) {
      console.error(`[DataStore] Fehler beim Speichern der Themes:`, error);
      throw error; // Werfe den Fehler weiter, damit wir ihn debuggen können
    }
  }

  getThemes(): Theme[] {
    return this.themes;
  }
  
  getTheme(themeId: string): Theme | undefined {
    return this.themes.find(theme => theme.id === themeId);
  }

  setThemes(themes: Theme[]): void {
    this.themes = themes;
    this.saveThemes();
  }

  addTheme(theme: Theme): void {
    // Stelle sicher, dass alle erforderlichen Arrays initialisiert sind
    const newTheme = {
      ...theme,
      processes: theme.processes || [],
      persistentProcesses: theme.persistentProcesses || []
    };
    
    this.themes.push(newTheme);
    console.log(`[DataStore] Neues Thema hinzugefügt: ${newTheme.name} (${newTheme.id})`);
    this.saveThemes();
  }

  updateTheme(themeId: string, updatedTheme: Theme): void {
    console.log(`[DataStore] Updating theme ${themeId}:`, updatedTheme);

    const index = this.themes.findIndex((t) => t.id === themeId);
    if (index !== -1) {
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
      
      // Persistente Prozessidentifikatoren beibehalten
      const persistentProcesses = updatedTheme.persistentProcesses || existingTheme.persistentProcesses || [];
      console.log(`[DataStore] Persistent processes:`, persistentProcesses);
      
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
      this.saveThemes();
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
  removePersistentProcessFromTheme(themeId: string, executableName: string): void {
    const theme = this.themes.find((t) => t.id === themeId);
    
    if (theme && theme.persistentProcesses) {
      theme.persistentProcesses = theme.persistentProcesses.filter(
        p => p.executableName !== executableName
      );
      this.saveThemes();
    }
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
