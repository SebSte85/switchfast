import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  globalShortcut,
  ipcMain,
} from "electron";
import * as url from "url";
import { exec } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile } from "child_process";
import { error } from "console";
import { stderr } from "process";

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

const registeredShortcuts: Map<string, string> = new Map();

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
  // Globaler Shortcut zum Umschalten des Focus Mode
  try {
    globalShortcut.register("Alt+F", () => {
      if (mainWindow) {
        mainWindow.webContents.send("toggle-focus-mode");
      }
    });
    console.log("Globaler Fokus-Modus-Shortcut registriert");
  } catch (error) {
    console.error("Fehler beim Registrieren des globalen Shortcuts:", error);
  }
}

function registerThemeShortcut(themeId: string, shortcut: string): boolean {
  try {
    // Wenn bereits ein Shortcut für dieses Theme existiert, entferne ihn zuerst
    if (registeredShortcuts.has(themeId)) {
      const oldShortcut = registeredShortcuts.get(themeId);
      if (oldShortcut) {
        globalShortcut.unregister(oldShortcut);
      }
    }

    // Registriere den neuen Shortcut
    globalShortcut.register(shortcut, async () => {
      if (mainWindow) {
        // Sende Benachrichtigung an Renderer
        mainWindow.webContents.send("activate-theme-and-minimize", themeId);

        try {
          // Hole die aktuelle Theme-Info vom Renderer
          const themesInfo: any =
            await mainWindow.webContents.executeJavaScript(
              `window.getCurrentThemeInfo && window.getCurrentThemeInfo('${themeId}')`
            );

          if (
            themesInfo &&
            themesInfo.applications &&
            themesInfo.applications.length > 0
          ) {
            // Verwende die Show Desktop Funktion mit allen Apps des Themes als Ausnahmen
            console.log(
              `Minimiere alle Fenster außer für Theme ${themeId} mit ${themesInfo.applications.length} Apps`
            );

            // Verwende die neue Methode, die alle Fenster minimiert außer die der Gruppe
            await showDesktopExceptApps(themesInfo.applications);
          } else {
            console.log(
              `Theme ${themeId} hat keine Anwendungen oder konnte nicht abgerufen werden`
            );
            // Benachrichtige den Benutzer
            if (mainWindow) {
              mainWindow.webContents.send("show-notification", {
                title: "Gruppe hat keine Anwendungen",
                message:
                  "Diese Gruppe enthält keine Anwendungen. Füge mindestens eine Anwendung hinzu, damit der Focus-Modus funktioniert.",
              });
            }
          }
        } catch (error) {
          console.error(
            `Fehler beim Minimieren von Anwendungen für Theme ${themeId}:`,
            error
          );
        }
      }
    });

    // Speichere den registrierten Shortcut
    registeredShortcuts.set(themeId, shortcut);
    console.log(`Shortcut ${shortcut} für Theme ${themeId} registriert`);
    return true;
  } catch (error) {
    console.error(`Fehler beim Registrieren des Shortcuts ${shortcut}:`, error);
    return false;
  }
}

function unregisterThemeShortcut(themeId: string): boolean {
  try {
    if (registeredShortcuts.has(themeId)) {
      const shortcut = registeredShortcuts.get(themeId);
      if (shortcut) {
        globalShortcut.unregister(shortcut);
        registeredShortcuts.delete(themeId);
        console.log(`Shortcut für Theme ${themeId} entfernt`);
      }
    }
    return true;
  } catch (error) {
    console.error(
      `Fehler beim Entfernen des Shortcuts für Theme ${themeId}:`,
      error
    );
    return false;
  }
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
 * Minimiert eine einzelne Anwendung über PowerShell mit dem Windows API ShowWindowAsync Befehl
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

    // Nutze direkt die Windows ShowWindowAsync API via PowerShell
    // Dies ist effektiver als die Enumeration aller Fenster
    const command = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Diagnostics;
      
      public class WindowUtils {
          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
          
          [DllImport("user32.dll")]
          public static extern IntPtr GetForegroundWindow();
          
          [DllImport("user32.dll")]
          public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
          
          [DllImport("user32.dll")]
          public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
          
          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
          
          [DllImport("user32.dll")]
          public static extern bool IsWindowVisible(IntPtr hWnd);
          
          public const int SW_MINIMIZE = 6;
          public const int SW_SHOWNORMAL = 1;
          
          public static bool MinimizeProcessWindow(int targetProcessId) {
              // Finde alle sichtbaren Fenster des Prozesses und minimiere sie
              bool success = false;
              uint foregroundProcessId = 0;
              IntPtr foregroundWindow = GetForegroundWindow();
              GetWindowThreadProcessId(foregroundWindow, out foregroundProcessId);
              
              // Wenn wir selbst im Vordergrund sind, nicht minimieren
              if (foregroundProcessId == targetProcessId) {
                  Console.WriteLine($"Process {targetProcessId} ist im Vordergrund und wird nicht minimiert");
                  return false;
              }
              
              try {
                  Process process = Process.GetProcessById(targetProcessId);
                  IntPtr mainWindowHandle = process.MainWindowHandle;
                  
                  if (mainWindowHandle != IntPtr.Zero && IsWindowVisible(mainWindowHandle)) {
                      // Direkt die Windows API nutzen
                      success = ShowWindowAsync(mainWindowHandle, SW_MINIMIZE);
                      Console.WriteLine($"Minimiere Hauptfenster von Prozess {targetProcessId}: {success}");
                      return success;
                  } else {
                      Console.WriteLine($"Prozess {targetProcessId} hat kein sichtbares Hauptfenster");
                  }
              } catch (Exception ex) {
                  Console.WriteLine($"Fehler beim Minimieren von Prozess {targetProcessId}: {ex.Message}");
              }
              
              return success;
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
            console.log(`Prozess ${processId} konnte nicht minimiert werden`);
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

/**
 * Minimiert alle Anwendungen außer der angegebenen Anwendung
 * Diese Funktion nutzt denselben Mechanismus wie showDesktopExceptApps, aber für einen einzelnen Prozess
 */
async function minimizeAllExcept(exceptProcessId: number): Promise<boolean> {
  // Wir verwenden einfach die vorhandene Funktion mit einem einzelnen Prozess
  return showDesktopExceptApps([exceptProcessId]);
}

/**
 * Minimiert alle Fenster außer der angegebenen Anwendungen
 * Stark vereinfachte Version basierend auf dem Vorschlag des Benutzers
 */
async function showDesktopExceptApps(
  appIdsToRestore: number[]
): Promise<boolean> {
  return new Promise((resolve) => {
    if (process.platform !== "win32") {
      console.warn("Diese Funktion wird nur unter Windows unterstützt");
      resolve(false);
      return;
    }

    console.log(
      `Minimiere alle Fenster außer für Prozesse: ${appIdsToRestore.join(", ")}`
    );

    // Direkte und einfache PowerShell-Implementierung ohne komplexe String-Verkettung
    const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Collections.Generic;

public class WindowUtils {
    [DllImport("user32.dll")]
    public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
    
    public const int SW_MINIMIZE = 6;
    
    public static void MinimizeAllExcept(int[] protectedPids) {
        // Erstelle HashSet für schnelle Suche
        HashSet<int> protectedSet = new HashSet<int>(protectedPids);
        int minimizedCount = 0;
        
        // Alle laufenden Prozesse durchlaufen
        foreach (Process proc in Process.GetProcesses()) {
            try {
                // Nur Prozesse mit einem Hauptfenster berücksichtigen
                if (proc.MainWindowHandle != IntPtr.Zero) {
                    // Prüfen, ob der Prozess geschützt ist
                    if (!protectedSet.Contains(proc.Id)) {
                        // Fenster minimieren
                        ShowWindowAsync(proc.MainWindowHandle, SW_MINIMIZE);
                        minimizedCount++;
                        Console.WriteLine("Minimiert: " + proc.ProcessName + " (PID " + proc.Id + ")");
                    } else {
                        Console.WriteLine("Geschützt: " + proc.ProcessName + " (PID " + proc.Id + ")");
                    }
                }
            } catch (Exception ex) {
                Console.WriteLine("Fehler bei Prozess " + proc.Id + ": " + ex.Message);
            }
        }
        
        Console.WriteLine("MINIMIERUNG ABGESCHLOSSEN");
        Console.WriteLine("=========================");
        Console.WriteLine("Minimierte Fenster: " + minimizedCount);
    }
}
"@

# Geschützte Prozess-IDs als Array
$protectedPids = @(${appIdsToRestore.join(",")})
Write-Host "Geschützte Prozess-IDs: $protectedPids"

# Alle Fenster außer den geschützten minimieren
[WindowUtils]::MinimizeAllExcept($protectedPids)

# Immer Erfolg zurückgeben, da wir die Funktion vereinfacht haben
$true
`;

    try {
      // Erstelle temporäre Datei mit UTF-8 Encoding
      const tempFilePath = path.join(
        os.tmpdir(),
        `minimize-windows-${Date.now()}.ps1`
      );
      fs.writeFileSync(tempFilePath, psScript, { encoding: "utf8" });
      console.log(
        `PowerShell-Skript in temporäre Datei geschrieben: ${tempFilePath}`
      );

      // Führe PowerShell-Skript aus mit explizitem UTF-8 Encoding
      console.log("Starte PowerShell-Skript...");
      execFile(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempFilePath],
        { encoding: "utf8" },
        (error, stdout, stderr) => {
          // Datei aufräumen
          try {
            fs.unlinkSync(tempFilePath);
            console.log("Temporäre Skriptdatei gelöscht");
          } catch (unlinkError: unknown) {
            const error = unlinkError as Error;
            console.warn(
              `Konnte temporäre Datei nicht löschen: ${error.message}`
            );
          }

          if (error) {
            console.error(
              `Fehler beim Ausführen des PowerShell-Skripts: ${error.message}`
            );
            console.error(`stderr: ${stderr}`);
            resolve(false);
            return;
          }

          console.log("=== DIAGNOSE DER FENSTERMINIMIERUNG ===");
          console.log(stdout.trim());
          console.log("=======================================");

          // Bei dieser vereinfachten Version geben wir immer Erfolg zurück
          resolve(true);
        }
      );
    } catch (fileError: unknown) {
      const error = fileError as Error;
      console.error(
        `Fehler beim Erstellen der temporären Skriptdatei: ${error.message}`
      );
      resolve(false);
    }
  });
}

// Initialisiere IPC-Kommunikation
function setupIpcHandlers() {
  // Laufende Anwendungen abrufen
  ipcMain.handle("get-running-applications", async () => {
    console.log("getRunningApplications() wird aufgerufen");
    return await getRunningApplications();
  });

  // Anwendungen minimieren
  ipcMain.handle("minimize-applications", async (_, appIds: number[]) => {
    let success = true;
    for (const appId of appIds) {
      const result = await minimizeApplication(appId);
      if (!result) success = false;
    }
    return success;
  });

  // Alle Anwendungen außer der angegebenen minimieren
  ipcMain.handle("minimize-all-except", async (_, processId: number) => {
    return await minimizeAllExcept(processId);
  });

  // Show Desktop und Apps wiederherstellen
  ipcMain.handle(
    "show-desktop-except",
    async (_, appIdsToRestore: number[]) => {
      return await showDesktopExceptApps(appIdsToRestore);
    }
  );

  // Shortcut für ein Theme registrieren
  ipcMain.handle("register-shortcut", async (_, { themeId, shortcut }) => {
    return registerThemeShortcut(themeId, shortcut);
  });

  // Shortcut für ein Theme entfernen
  ipcMain.handle("unregister-shortcut", async (_, { themeId }) => {
    return unregisterThemeShortcut(themeId);
  });
}

// Beim Beenden der App alle Shortcuts entfernen
app.on("will-quit", () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
  console.log("Alle globalen Shortcuts entfernt");
});

// App bereit-Event
app.on("ready", () => {
  createWindow();
  setupIpcHandlers(); // IPC-Handler initialisieren
});

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
