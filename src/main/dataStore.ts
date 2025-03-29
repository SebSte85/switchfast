import { app } from "electron";
import * as fs from "fs";
import * as path from "path";

const THEMES_FILE = "themes.json";

interface Theme {
  id: string;
  name: string;
  applications: number[];
  shortcut: string;
  color?: string;
}

export class DataStore {
  private themes: Theme[] = [];
  private filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath("userData"), THEMES_FILE);
    this.loadThemes();
  }

  private loadThemes(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, "utf8");
        this.themes = JSON.parse(data);
      }
    } catch (error) {
      console.error("Fehler beim Laden der Themes:", error);
    }
  }

  private saveThemes(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.themes, null, 2));
    } catch (error) {
      console.error("Fehler beim Speichern der Themes:", error);
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
      this.themes[index] = updatedTheme;
      this.saveThemes();
    }
  }

  deleteTheme(themeId: string): void {
    this.themes = this.themes.filter((t) => t.id !== themeId);
    this.saveThemes();
  }
}
