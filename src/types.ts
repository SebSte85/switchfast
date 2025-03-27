// Gemeinsame Typdefinitionen für die gesamte Anwendung

// Information zu laufenden Prozessen
export interface ProcessInfo {
  id: number;
  name: string;
  title: string;
  path?: string;
  icon?: string;
}

// Themen zur Gruppierung von Anwendungen
export interface Theme {
  id: string;
  name: string;
  applications: number[]; // Array von Prozess-IDs
}

// IPC-Kommunikation zwischen Main und Renderer
export interface IpcMainHandlers {
  "get-running-applications": () => Promise<ProcessInfo[]>;
  "minimize-applications": (appIds: number[]) => Promise<boolean>;
}

export interface IpcRendererEvents {
  "toggle-focus-mode": () => void;
  "activate-theme": (themeIndex: number) => void;
}
