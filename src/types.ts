// Gemeinsame Typdefinitionen für die gesamte Anwendung

// Information zu laufenden Prozessen
export interface ProcessInfo {
  id: number;
  name: string;
  title: string;
  path?: string;
  icon?: string;
  parentId?: number; // ID des Elternprozesses
  children?: ProcessInfo[]; // Array von Kindprozessen
}

// Themen zur Gruppierung von Anwendungen
export interface Theme {
  id: string;
  name: string;
  applications: number[]; // Array von Prozess-IDs
  shortcut?: string; // Tastaturkombination zum Aktivieren des Themes
  color?: string; // Farbe für die visuelle Darstellung des Themes
}

// ApplicationListProps Interface
export interface ApplicationListProps {
  applications: ProcessInfo[];
  themes: Theme[];
  activeTheme: string | null;
  activeThemes?: string[];
  onAddToTheme: (themeId: string, applicationId: number) => void;
  onRemoveFromTheme: (themeId: string, applicationId: number) => void;
  onUpdateTheme?: (themeId: string, updatedTheme: Partial<Theme>) => void;
  onToggleActiveTheme?: (themeId: string) => void;
  compactMode?: boolean; // Kompakt-Modus-Flag
  showOnlyShortcuts?: boolean; // Flag, um nur Shortcuts anzuzeigen, keine Namen
}

// IPC-Kommunikation zwischen Main und Renderer
export interface IpcMainHandlers {
  "get-running-applications": () => Promise<ProcessInfo[]>;
  "minimize-applications": (appIds: number[]) => Promise<boolean>;
  "register-shortcut": (shortcutData: {
    themeId: string;
    shortcut: string;
  }) => Promise<boolean>;
  "unregister-shortcut": (shortcutData: {
    themeId: string;
  }) => Promise<boolean>;
}

export interface IpcRendererEvents {
  "toggle-focus-mode": () => void;
  "activate-theme": (themeIndex: number) => void;
}
