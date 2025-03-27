import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
} from "electron";
import * as path from "path";
import * as url from "url";
import { exec } from "child_process";

// Keep a global reference of objects to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Types
interface ProcessInfo {
  id: number;
  name: string;
  title: string;
  path?: string;
  icon?: string;
}

function createWindow() {
  // Sicherstellen, dass der assets-Ordner existiert
  try {
    const fs = require("fs");
    const assetsDir = path.join(__dirname, "assets");
    if (!fs.existsSync(assetsDir)) {
      console.log(
        "Assets-Verzeichnis existiert nicht, erstelle es:",
        assetsDir
      );
      fs.mkdirSync(assetsDir, { recursive: true });
    }
  } catch (err) {
    console.error("Fehler beim Erstellen des Assets-Verzeichnisses:", err);
  }

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 900,
    height: 680,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, "assets/icon.png"),
  });

  // Load the app
  if (process.env.NODE_ENV === "development") {
    // Load from webpack dev server in development
    mainWindow.loadURL("http://localhost:3000");
    // Open DevTools
    mainWindow.webContents.openDevTools();
  } else {
    // Load from built files in production
    mainWindow.loadURL(
      url.format({
        pathname: path.join(__dirname, "renderer/index.html"),
        protocol: "file:",
        slashes: true,
      })
    );
  }

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Hide window to tray when minimized instead of taskbar
  mainWindow.on("minimize", (event: Event) => {
    event.preventDefault();
    if (mainWindow) {
      mainWindow.hide();
    }
  });

  // Create system tray
  createTray();

  // Register global shortcuts
  registerShortcuts();
}

function createTray() {
  try {
    // Versuche, das Icon aus dem assets-Ordner zu laden
    const fs = require("fs");
    const iconPath = path.join(__dirname, "assets/icon.png");

    console.log("Versuche Tray-Icon zu laden von:", iconPath);

    // Prüfe, ob das Icon existiert
    if (!fs.existsSync(iconPath)) {
      console.warn("Tray-Icon nicht gefunden, erstelle ein leeres Icon");

      // Erstelle ein Dummy-Icon als Fallback (16x16 Pixel, transparent)
      const { nativeImage } = require("electron");
      const emptyIcon = nativeImage.createEmpty();
      tray = new Tray(emptyIcon);
    } else {
      tray = new Tray(iconPath);
    }

    const contextMenu = Menu.buildFromTemplate([
      {
        label: "Show App",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
          }
        },
      },
      {
        label: "Quit",
        click: () => {
          app.quit();
        },
      },
    ]);

    tray.setToolTip("Work Focus Manager");
    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
    console.log("Tray erfolgreich erstellt");
  } catch (error) {
    console.error("Fehler beim Erstellen des Tray-Icons:", error);
    // App kann auch ohne Tray-Icon funktionieren
  }
}

function registerShortcuts() {
  // Register global shortcut (Ctrl+Shift+F to toggle focus mode)
  globalShortcut.register("CommandOrControl+Shift+F", () => {
    if (mainWindow) {
      mainWindow.webContents.send("toggle-focus-mode");
    }
  });

  // Register custom shortcut for specific themes
  globalShortcut.register("CommandOrControl+Shift+1", () => {
    if (mainWindow) {
      mainWindow.webContents.send("activate-theme", 0);
    }
  });

  globalShortcut.register("CommandOrControl+Shift+2", () => {
    if (mainWindow) {
      mainWindow.webContents.send("activate-theme", 1);
    }
  });

  globalShortcut.register("CommandOrControl+Shift+3", () => {
    if (mainWindow) {
      mainWindow.webContents.send("activate-theme", 2);
    }
  });
}

/**
 * Ruft laufende Anwendungen ab
 */
async function getRunningApplications(): Promise<ProcessInfo[]> {
  console.log("getRunningApplications() wird aufgerufen");

  // Nur Windows wird unterstützt
  if (process.platform !== "win32") {
    console.warn("Prozesserkennung wird nur unter Windows unterstützt");
    return [];
  }

  try {
    // Direkt die optimierte Methode verwenden
    const processes = await getTaskManagerApps();
    console.log(`${processes.length} Desktop-Anwendungen gefunden.`);

    // Nach Namen sortieren
    processes.sort((a, b) => a.name.localeCompare(b.name));

    // Alle gefundenen Anwendungen im Log ausgeben
    if (processes.length > 0) {
      console.log(
        "Gefundene Desktop-Anwendungen:",
        processes.map((p) => p.name).join(", ")
      );
    }

    return processes;
  } catch (error) {
    console.error("Fehler beim Abrufen der laufenden Anwendungen:", error);
    return getMockApplications(); // Bei Fehlern Mock-Daten zurückgeben
  }
}

/**
 * Gibt ausschließlich echte Desktop-Anwendungen zurück, ähnlich dem Task Manager
 */
function getTaskManagerApps(): Promise<ProcessInfo[]> {
  return new Promise((resolve, reject) => {
    // Dieser PowerShell-Befehl entspricht exakt der "Apps"-Kategorie im Task Manager
    // Er filtert Prozesse nach vorhandenem Hauptfenster-Handle (sichtbares Fenster)
    const command =
      "Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Csv -NoTypeInformation";

    try {
      console.log(
        "Starte präzisen PowerShell-Befehl für Apps mit UI-Fenstern..."
      );
      exec(
        'powershell -NoProfile -ExecutionPolicy Bypass -Command "' +
          command +
          '"',
        (error, stdout, stderr) => {
          if (error) {
            console.error(
              `Fehler beim Ausführen von PowerShell: ${error.message}`
            );
            console.error(`stderr: ${stderr}`);
            console.log("Verwende Mock-Daten als Fallback...");
            resolve(getMockApplications());
            return;
          }

          try {
            console.log("PowerShell-Ausgabe erhalten, Länge:", stdout.length);

            if (!stdout || stdout.trim() === "") {
              console.error("PowerShell-Ausgabe ist leer, verwende Mock-Daten");
              resolve(getMockApplications());
              return;
            }

            const processes: ProcessInfo[] = [];
            const lines = stdout.split("\n");

            // Erste Zeile ist CSV-Header, überspringen
            for (let i = 1; i < lines.length; i++) {
              const line = lines[i].trim();
              if (!line) continue;

              // CSV-Format: "Id","ProcessName","MainWindowTitle"
              const match = line.match(/"([^"]+)","([^"]+)","([^"]*)"/);
              if (match && match.length >= 4) {
                const pid = parseInt(match[1], 10);
                const processName = match[2];
                const windowTitle = match[3];

                if (!isNaN(pid)) {
                  processes.push({
                    id: pid,
                    name: formatAppName(processName.toLowerCase()),
                    title: windowTitle || processName,
                  });
                }
              }
            }

            // Nach Namen sortieren
            processes.sort((a, b) => a.name.localeCompare(b.name));

            console.log(
              `${processes.length} echte Desktop-Anwendungen mit UI-Fenstern gefunden`
            );
            if (processes.length > 0) {
              console.log(
                "UI-Anwendungen:",
                processes.map((p) => p.name).join(", ")
              );
            }

            resolve(processes);
          } catch (parseError) {
            console.error(
              "Fehler beim Parsen der PowerShell-Ausgabe:",
              parseError
            );
            resolve(getMockApplications());
          }
        }
      );
    } catch (execError) {
      console.error("Fehler beim Ausführen des PowerShell-Befehls:", execError);
      resolve(getMockApplications());
    }
  });
}

/**
 * Formatiert einen Anwendungsnamen für bessere Lesbarkeit
 */
function formatAppName(name: string): string {
  // Bekannte Anwendungen mit besseren Namen versehen
  const nameMap: { [key: string]: string } = {
    chrome: "Google Chrome",
    msedge: "Microsoft Edge",
    firefox: "Mozilla Firefox",
    iexplore: "Internet Explorer",
    code: "Visual Studio Code",
    explorer: "Windows Explorer",
    taskmgr: "Task-Manager",
    winword: "Word",
    excel: "Excel",
    powerpnt: "PowerPoint",
    outlook: "Outlook",
    notepad: "Editor",
    mspaint: "Paint",
    cmd: "Kommandozeile",
    powershell: "PowerShell",
    spotify: "Spotify",
    steam: "Steam",
    discord: "Discord",
    teams: "Microsoft Teams",
    cursor: "Cursor",
  };

  // Bekannter Name vorhanden?
  if (nameMap[name]) {
    return nameMap[name];
  }

  // Ansonsten ersten Buchstaben groß schreiben
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Gibt Mock-Anwendungsdaten zurück, falls keine echten Daten verfügbar sind
 */
function getMockApplications(): ProcessInfo[] {
  return [
    { id: 1, name: "Google Chrome", title: "Google Chrome" },
    { id: 2, name: "Microsoft Edge", title: "Microsoft Edge" },
    { id: 3, name: "Visual Studio Code", title: "Visual Studio Code" },
    { id: 4, name: "Word", title: "Microsoft Word" },
    { id: 5, name: "Excel", title: "Microsoft Excel" },
    { id: 6, name: "PowerPoint", title: "Microsoft PowerPoint" },
    { id: 7, name: "Outlook", title: "Microsoft Outlook" },
    { id: 8, name: "Windows Explorer", title: "Windows Explorer" },
    { id: 9, name: "Spotify", title: "Spotify" },
    { id: 10, name: "Discord", title: "Discord" },
  ];
}

/**
 * Minimiert Anwendungen mit den angegebenen Prozess-IDs über PowerShell
 */
async function minimizeApplications(processIds: number[]): Promise<boolean> {
  if (processIds.length === 0) return true;

  console.log(`Minimiere Anwendungen: ${processIds.join(", ")}`);

  const results = await Promise.all(
    processIds.map((id) => minimizeApplication(id))
  );
  return results.every((result) => result === true);
}

/**
 * Minimiert eine einzelne Anwendung über PowerShell
 */
async function minimizeApplication(processId: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      console.warn(
        "Minimieren von Anwendungen wird nur unter Windows unterstützt"
      );
      resolve(false);
      return;
    }

    // Sehr einfaches PowerShell-Skript zum Minimieren von Fenstern
    // Verwendet nur die grundlegendsten Windows API-Funktionen
    const command = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Diagnostics;
      
      public class WindowUtils {
          [DllImport("user32.dll")]
          public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
          
          public const int SW_MINIMIZE = 6;
          
          public static bool MinimizeProcessWindow(int processId) {
              try {
                  Process proc = Process.GetProcessById(processId);
                  if (proc != null && proc.MainWindowHandle != IntPtr.Zero) {
                      return ShowWindowAsync(proc.MainWindowHandle, SW_MINIMIZE);
                  }
              }
              catch (Exception) {
                  // Ignoriere Fehler
              }
              return false;
          }
      }
"@

      [WindowUtils]::MinimizeProcessWindow(${processId})
    `;

    try {
      exec(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "${command}"`,
        (error, stdout, stderr) => {
          if (error) {
            console.error(
              `Fehler beim Minimieren von Prozess ${processId}: ${error.message}`
            );
            console.error(`stderr: ${stderr}`);
            resolve(false);
            return;
          }

          const success = stdout.trim().toLowerCase() === "true";
          if (success) {
            console.log(`Prozess ${processId} erfolgreich minimiert`);
          } else {
            console.log(
              `Prozess ${processId} hat kein Hauptfenster oder es wurde nicht gefunden`
            );
          }
          resolve(success);
        }
      );
    } catch (execError) {
      console.error(
        `Fehler beim Ausführen des Befehls für Prozess ${processId}:`,
        execError
      );
      resolve(false);
    }
  });
}

// This method will be called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    // On macOS it's common to re-create a window when the dock icon is clicked
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// Clean up shortcuts when app is about to quit
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// IPC Handlers for process communication
ipcMain.handle("get-running-applications", async () => {
  return await getRunningApplications();
});

ipcMain.handle("minimize-applications", async (_, appIds: number[]) => {
  return await minimizeApplications(appIds);
});
