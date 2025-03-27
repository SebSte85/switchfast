export interface ProcessInfo {
  id: number;
  name: string;
  title: string;
  path: string;
}

export interface Theme {
  id: string;
  name: string;
  applications: ProcessInfo[];
}

export interface IpcMainHandlers {
  "get-running-applications": () => Promise<ProcessInfo[]>;
  "minimize-applications": (appIds: number[]) => Promise<boolean>;
}

export interface IpcRendererEvents {
  "toggle-focus-mode": () => void;
}
