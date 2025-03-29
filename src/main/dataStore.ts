import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const THEMES_FILE = "themes.json";

interface Theme {
  id: string;
  name: string;
  applications: number[];
  shortcut: string;
  processes: number[];
  windows?: WindowInfo[];
  color?: string;
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
      this.themes = JSON.parse(data);
    } catch (error) {
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

      // Speichere die Themes
      fs.writeFileSync(this.dataPath, JSON.stringify(this.themes, null, 2));
    } catch (error) {
      throw error; // Werfe den Fehler weiter, damit wir ihn debuggen können
    }
  }

  getThemes(): Theme[] {
    return this.themes;
  }

  setThemes(themes: Theme[]): void {
    this.themes = themes;
    this.saveThemes();
  }

  addTheme(theme: Theme): void {
    this.themes.push(theme);
    this.saveThemes();
  }

  updateTheme(themeId: string, updatedTheme: Theme): void {
    const index = this.themes.findIndex((t) => t.id === themeId);
    if (index !== -1) {
      const existingWindows = this.themes[index].windows || [];
      this.themes[index] = {
        ...updatedTheme,
        windows: existingWindows,
      };
      this.saveThemes();
    }
  }

  deleteTheme(themeId: string): void {
    this.themes = this.themes.filter((t) => t.id !== themeId);
    this.saveThemes();
  }

  addWindowsToTheme(themeId: string, newWindows: WindowInfo[]) {
    const themes = this.getThemes();
    const theme = themes.find((t) => t.id === themeId);

    if (!theme) {
      return;
    }

    // Initialize arrays if they don't exist
    if (!theme.windows) theme.windows = [];
    if (!theme.processes) theme.processes = [];
    if (!theme.applications) theme.applications = [];

    // Add each window
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

        // Add process ID to processes array if not already there
        if (!theme.processes.includes(window.processId)) {
          theme.processes.push(window.processId);
        }

        // CRITICAL FIX: Also add window handle to applications array to prevent its removal during refresh
        // For subprocess windows we need to add the window handle to applications for proper tracking
        if (!theme.applications.includes(window.hwnd)) {
          theme.applications.push(window.hwnd);
        }
      }
    });

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
