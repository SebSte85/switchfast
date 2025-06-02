// Gemeinsame Typdefinitionen für die gesamte Anwendung

// Persistente Prozessidentifikation für Wiederherstellung nach Neustart
export interface PersistentProcessIdentifier {
  executablePath?: string;
  executableName: string;
  titlePattern?: string;
}

// Information zu laufenden Prozessen
export interface WindowInfo {
  hwnd: number;
  processId: number;
  title: string;
}

export interface ProcessInfo {
  id: number;
  name: string;
  title: string;
  path?: string;
  icon?: string;
  parentId?: number; // ID des Elternprozesses
  children?: ProcessInfo[]; // Array von Kindprozessen
  windows?: WindowInfo[]; // Liste der zugehörigen Fenster
}

// Themen zur Gruppierung von Anwendungen
export interface Theme {
  id: string;
  name: string;
  applications: Array<number | string>; // Kann jetzt ProcessID oder WindowHandle sein
  shortcut: string;
  color?: string; // Farbe für die visuelle Darstellung des Themes
  persistentProcesses?: PersistentProcessIdentifier[]; // Persistente Prozessidentifikatoren für Wiederherstellung nach Neustart
  processes?: number[]; // Prozess-IDs für die Zuordnung zu Themen
}

// ApplicationListProps Interface
export interface ApplicationListProps {
  applications: ProcessInfo[];
  themes: Theme[];
  activeTheme: string | null;
  activeThemes?: string[];
  onAddToTheme?: (themeId: string, appId: number | string) => void;
  onRemoveFromTheme?: (themeId: string, appId: number | string) => void;
  onUpdateTheme?: (theme: Theme) => void;
  onToggleActiveTheme?: (themeId: string) => void;
  compactMode?: boolean; // Kompakt-Modus-Flag
  showOnlyShortcuts?: boolean; // Flag, um nur Shortcuts anzuzeigen, keine Namen
  startingApps?: boolean; // Flag, ob Anwendungen gerade gestartet werden
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
