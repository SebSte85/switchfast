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
import { DataStore } from "./main/dataStore";

// Keep a global reference of objects to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const dataStore = new DataStore();

// Types
interface WindowInfo {
  hwnd: number;
  processId: number;
  title: string;
}

interface ProcessInfo {
  id: number;
  name: string;
  title: string;
  path?: string;
  icon?: string;
  parentId?: number;
  children?: ProcessInfo[];
  windows?: WindowInfo[];
}

const registeredShortcuts: Map<string, string> = new Map();
let compactMode = false; // Zustand für den Kompaktmodus

function createWindow() {
  // Sicherstellen, dass der assets-Ordner existiert
  try {
    const fs = require("fs");
    const assetsDir = path.join(__dirname, "assets");
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
  } catch (err) {
    // Error handling
  }

  // Create the browser window
  mainWindow = new BrowserWindow({
    width: 600,
    height: 680,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
    icon: path.join(__dirname, "assets/icon.png"),
    frame: false,
    backgroundColor: "#414159",
    alwaysOnTop: compactMode,
    title: "switchfast",
  });

  // Menüleiste komplett entfernen
  mainWindow.setMenu(null);

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

    // Prüfe, ob das Icon existiert
    if (!fs.existsSync(iconPath)) {
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

    tray.setToolTip("switchfast");
    tray.setContextMenu(contextMenu);

    tray.on("click", () => {
      if (mainWindow) {
        mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show();
      }
    });
  } catch (error) {
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
  } catch (error) {
    // Error handling
  }
}

function registerThemeShortcut(themeId: string, shortcut: string): boolean {
  try {
    // Wenn bereits ein Shortcut für dieses Theme existiert, entferne ihn zuerst
    if (registeredShortcuts.has(themeId)) {
      const oldShortcut = registeredShortcuts.get(themeId);
      if (oldShortcut) {
        try {
          globalShortcut.unregister(oldShortcut);
        } catch (err) {
          // Error handling
        }
      }
    }

    // Prüfe, ob der Shortcut gültig ist
    if (!shortcut || shortcut.trim() === "") {
      return false;
    }

    const formattedShortcut = formatShortcutForElectron(shortcut);

    // Überprüfen, ob Shortcut bereits registriert ist
    if (globalShortcut.isRegistered(formattedShortcut)) {
      globalShortcut.unregister(formattedShortcut);
    }

    // Registriere den neuen Shortcut
    const success = globalShortcut.register(formattedShortcut, () => {
      if (!mainWindow) {
        return;
      }

      // Sende Benachrichtigung an Renderer
      try {
        mainWindow.webContents.send("activate-theme-and-minimize", themeId);
      } catch (err) {
        // Error handling
      }
    });

    if (!success) {
      return false;
    }

    // Speichere den registrierten Shortcut
    registeredShortcuts.set(themeId, formattedShortcut);
    return true;
  } catch (error) {
    return false;
  }
}

// Funktion zum Konvertieren des Shortcut-Formats für Electron
function formatShortcutForElectron(shortcut: string): string {
  // Electron verwendet leicht andere Formate für Tastenkombinationen
  // z.B.: "Ctrl+Alt+S" -> "CommandOrControl+Alt+S"
  let formatted = shortcut.trim();

  // Ctrl zu CommandOrControl für plattformübergreifende Kompatibilität
  if (formatted.includes("Ctrl+")) {
    formatted = formatted.replace("Ctrl+", "CommandOrControl+");
  }

  // Sicherstellen, dass Modifier-Keys korrekt formatiert sind
  formatted = formatted
    .replace(/\s+/g, "") // Leerzeichen entfernen
    .replace(/\+\+/g, "+"); // Doppelte + entfernen

  // Spezielle Tasten-Mapping für Electron
  const specialKeyMap: { [key: string]: string } = {
    Enter: "Return",
    Space: "Space",
    Escape: "Esc",
    Delete: "Delete",
    Backspace: "Backspace",
    Tab: "Tab",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Insert: "Insert",
    F1: "F1",
    F2: "F2",
    F3: "F3",
    F4: "F4",
    F5: "F5",
    F6: "F6",
    F7: "F7",
    F8: "F8",
    F9: "F9",
    F10: "F10",
    F11: "F11",
    F12: "F12",
  };

  // Zerlege den Shortcut in Teile (splittet bei +)
  const parts = formatted.split("+");
  const lastPart = parts[parts.length - 1];

  // Prüfe, ob der letzte Teil eine spezielle Taste ist und ersetze sie gegebenenfalls
  if (specialKeyMap[lastPart]) {
    parts[parts.length - 1] = specialKeyMap[lastPart];
  }
  // Bei einzelnen Buchstaben: In Kleinbuchstaben umwandeln (Electron-Konvention)
  else if (
    lastPart.length === 1 &&
    lastPart === lastPart.toUpperCase() &&
    lastPart.match(/[A-Z]/)
  ) {
    parts[parts.length - 1] = lastPart.toLowerCase();
  }

  // Füge alle Teile wieder zusammen
  formatted = parts.join("+");

  return formatted;
}

function unregisterThemeShortcut(themeId: string): boolean {
  try {
    if (registeredShortcuts.has(themeId)) {
      const shortcut = registeredShortcuts.get(themeId);
      if (shortcut) {
        globalShortcut.unregister(shortcut);
        registeredShortcuts.delete(themeId);
        return true;
      }
    }
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Ruft alle laufenden Anwendungen mit ihren Fenstertiteln ab
 */
async function getRunningApplications(): Promise<ProcessInfo[]> {
  try {
    // PowerShell-Befehl zum Abrufen der Prozesse
    const command = `
      $processes = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name;
      $results = @();
      
      foreach ($p in $processes) {
        $process = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue;
        if ($process) {
          # Prozessnamen filtern - nur Desktop-Apps und Browser
          $relevantProcess = $false;
          
          # Bekannte Desktop-Anwendungen
          $desktopApps = @(
            "brave", "chrome", "firefox", "msedge",  # Browser
            "code", "cursor",                        # Editoren
            "notepad", "wordpad",                    # Text-Editoren
            "explorer",                              # Datei-Explorer
            "powershell", "WindowsTerminal",         # Terminals
            "Teams", "slack", "discord",             # Kommunikation
            "ONENOTE", "WINWORD", "EXCEL",          # Office
            "SnippingTool",                         # Tools
            "ApplicationFrameHost",                  # Windows Store Apps
            "Taskmgr",                              # System Tools
            "electron"                              # Electron Apps
          );

          # Prüfe, ob es sich um eine relevante Anwendung handelt
          $processName = $process.Name.ToLower()
          if ($desktopApps -contains $processName -or 
              $processName -match "brave|chrome|firefox|msedge|opera" -or
              $process.MainWindowHandle -ne 0 -or 
              $process.MainWindowTitle) {
            $relevantProcess = $true;
          }

          if ($relevantProcess) {
            $title = if ($process.MainWindowTitle) { 
              $process.MainWindowTitle 
            } else { 
              $p.Name 
            }

            $results += [PSCustomObject]@{
              Id = $p.ProcessId;
              ParentId = $p.ParentProcessId;
              Name = $p.Name;
              Title = $title;
            }
          }
        }
      }
      
      # Als JSON ausgeben
      $results | ConvertTo-Json
    `;

    // PowerShell-Befehl ausführen und Ausgabe verarbeiten
    const stdout = await runPowerShellCommand(command);

    if (!stdout || stdout.trim() === "") {
      return [];
    }

    // JSON-Ausgabe parsen
    const processData = JSON.parse(stdout);

    // Prozesse mit IDs, Namen und Titeln extrahieren
    const processes: ProcessInfo[] = Array.isArray(processData)
      ? processData.map((proc: any) => ({
          id: proc.Id,
          parentId: proc.ParentId,
          name: formatAppName(proc.Name.toLowerCase().replace(".exe", "")),
          title: proc.Title || proc.Name,
        }))
      : [];

    return processes;
  } catch (error) {
    return [];
  }
}

/**
 * Erstellt eine hierarchische Prozessbaum-Struktur aus einer flachen Liste
 */
function buildProcessTree(processes: ProcessInfo[]): ProcessInfo[] {
  // Map erstellen für schnellen Zugriff auf Prozesse nach ID
  const processMap = new Map<number, ProcessInfo>();
  processes.forEach((process) => {
    processMap.set(process.id, { ...process, children: [] });
  });

  // Root-Prozesse (Prozesse ohne Eltern oder mit nicht vorhandenen Eltern in der Liste)
  const rootProcesses: ProcessInfo[] = [];

  // Für jeden Prozess
  processMap.forEach((process) => {
    // Wenn der Prozess ein Elternteil hat und dieses auch in der Liste ist
    if (process.parentId && processMap.has(process.parentId)) {
      // Prozess dem children-Array des Elternprozesses hinzufügen
      const parent = processMap.get(process.parentId);
      if (parent && parent.children) {
        parent.children.push(process);
      }
    } else {
      // Kein Elternteil oder Elternteil nicht in der Liste, als Root-Prozess betrachten
      rootProcesses.push(process);
    }
  });

  return rootProcesses;
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
  // Beispielhafte Prozesshierarchie
  return [
    {
      id: 1,
      name: "System",
      title: "System",
      children: [
        {
          id: 2,
          name: "Explorer",
          title: "Windows Explorer",
          parentId: 1,
          children: [
            {
              id: 3,
              name: "Google Chrome",
              title: "Google Chrome",
              parentId: 2,
            },
            {
              id: 4,
              name: "Microsoft Edge",
              title: "Microsoft Edge",
              parentId: 2,
            },
          ],
        },
      ],
    },
    {
      id: 5,
      name: "Visual Studio Code",
      title: "Visual Studio Code",
      children: [
        {
          id: 6,
          name: "Terminal",
          title: "Terminal",
          parentId: 5,
        },
      ],
    },
    {
      id: 7,
      name: "Microsoft Teams",
      title: "Microsoft Teams",
      children: [
        {
          id: 8,
          name: "Teams Webview",
          title: "Teams Web Content",
          parentId: 7,
          children: [
            {
              id: 9,
              name: "Teams Renderer",
              title: "Teams Renderer",
              parentId: 8,
            },
          ],
        },
      ],
    },
    { id: 10, name: "Spotify", title: "Spotify" },
    { id: 11, name: "Discord", title: "Discord" },
  ];
}

/**
 * Minimiert Anwendungen mit den angegebenen Prozess-IDs über PowerShell
 */
async function minimizeApplications(processIds: number[]): Promise<boolean> {
  if (processIds.length === 0) return true;

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
                  return false;
              }
              
              try {
                  Process process = Process.GetProcessById(targetProcessId);
                  IntPtr mainWindowHandle = process.MainWindowHandle;
                  
                  if (mainWindowHandle != IntPtr.Zero && IsWindowVisible(mainWindowHandle)) {
                      // Direkt die Windows API nutzen
                      success = ShowWindowAsync(mainWindowHandle, SW_MINIMIZE);
                      return success;
                  }
              } catch (Exception ex) {
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
            resolve(false);
            return;
          }

          const success = stdout.trim().toLowerCase() === "true";
          resolve(success);
        }
      );
    } catch (execError) {
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
 * Minimiert alle Fenster außer die angegebenen Apps und stellt diese wieder her
 */
export async function showDesktopExceptApps(
  appIdsToProtect: number[]
): Promise<boolean> {
  try {
    // Teile die IDs in PIDs und Fenster-Handles auf
    const protectedPids = appIdsToProtect.filter((id) => id < 100000);
    const protectedHandles = appIdsToProtect.filter((id) => id >= 100000);

    // Für PIDs: hole alle zugehörigen Fenster-Handles
    let allWindowsFromPids: number[] = [];
    if (protectedPids.length > 0) {
      const windowsScript = `
        Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class WindowUtils {
            [DllImport("user32.dll")]
            [return: MarshalAs(UnmanagedType.Bool)]
            public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

            [DllImport("user32.dll", SetLastError=true)]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

            public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        }
"@

        $protectedPids = @(${protectedPids.join(",")})
        $windows = New-Object System.Collections.ArrayList

        $enumWindowCallback = {
            param(
                [IntPtr]$hwnd,
                [IntPtr]$lParam
            )

            $processId = 0
            [void][WindowUtils]::GetWindowThreadProcessId($hwnd, [ref]$processId)
            
            if ($protectedPids -contains $processId) {
                [void]$windows.Add($hwnd.ToInt64())
            }
            
            return $true
        }

        [WindowUtils]::EnumWindows($enumWindowCallback, [IntPtr]::Zero)
        $windows -join ","
      `;

      const windowsResult = await runPowerShellCommand(windowsScript);
      if (windowsResult.trim()) {
        allWindowsFromPids = windowsResult
          .split(",")
          .map((h) => parseInt(h.trim()))
          .filter((id) => !isNaN(id)); // Filtere NaN-Werte heraus
      }
    }

    // Kombiniere alle zu schützenden Fenster-Handles
    const allProtectedWindows = [...protectedHandles, ...allWindowsFromPids];

    // Füge eigene Anwendung zu den geschützten Fenstern hinzu
    const ourProcessId = process.pid;

    const protectedWindowsStr =
      allProtectedWindows.length > 0 ? allProtectedWindows.join(",") : "";

    const psScript = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Text;
      public class WindowUtils {
          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool IsWindowVisible(IntPtr hWnd);

          [DllImport("user32.dll", SetLastError = true)]
          public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

          [DllImport("user32.dll", SetLastError=true)]
          public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
          
          [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
          public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
      }
"@

      $protectedWindows = @(${protectedWindowsStr})
      $ourProcessId = ${ourProcessId}
      
      # Minimiere alle Fenster, außer geschützte
      function ShowDesktop {
          # Finde spezielle Fenster, die wir nicht minimieren sollten
          $taskbarWindow = [WindowUtils]::FindWindow("Shell_TrayWnd", $null)
          $progmanWindow = [WindowUtils]::FindWindow("Progman", $null)
          
          $minimizeAll = $false
          $restoreProtected = $true
          
          # Enum Callback zum Minimieren von Fenstern
          $enumCallback = {
              param(
                  [IntPtr]$hwnd,
                  [IntPtr]$lParam
              )
              
              # Prüfen, ob es sich um ein sichtbares Fenster handelt
              if (![WindowUtils]::IsWindowVisible($hwnd)) {
                  return $true
              }
              
              # Spezielle Fenster-Klassen identifizieren (Desktop, Taskbar, etc.)
              $classNameBuilder = New-Object System.Text.StringBuilder 256
              [WindowUtils]::GetClassName($hwnd, $classNameBuilder, 256) | Out-Null
              $className = $classNameBuilder.ToString()
              
              # Liste von speziellen Windows-System-Fenstern, die wir nicht minimieren wollen
              $specialClasses = @("Progman", "WorkerW", "Shell_TrayWnd", "DV2ControlHost", "SysListView32", "FolderView")
              
              # Wenn es sich um ein System-/Desktop-Fenster handelt, überspringen
              if ($specialClasses -contains $className -or 
                  $hwnd -eq $taskbarWindow -or 
                  $hwnd -eq $progmanWindow) {
                  return $true
              }
              
              # Überprüfe, ob das Fenster zu unserem eigenen Prozess gehört
              $processId = 0
              [void][WindowUtils]::GetWindowThreadProcessId($hwnd, [ref]$processId)
              $isOurProcess = $processId -eq $ourProcessId
              
              if ($protectedWindows -contains $hwnd.ToInt64() -or $isOurProcess) {
                  # Stelle geschützte Fenster wieder her (SW_RESTORE = 9)
                  if ($restoreProtected) {
                      [void][WindowUtils]::ShowWindow($hwnd, 9)
                  }
              } else {
                  # Minimiere andere Fenster (SW_MINIMIZE = 6)
                  if ($minimizeAll) {
                      [void][WindowUtils]::ShowWindow($hwnd, 6)
                  }
              }
              
              return $true
          }
          
          # Alle Fenster minimieren außer die geschützten
          $minimizeAll = $true
          $restoreProtected = $false
          [WindowUtils]::EnumWindows($enumCallback, [IntPtr]::Zero)
          
          # Geschützte Fenster wiederherstellen
          $minimizeAll = $false
          $restoreProtected = $true
          [WindowUtils]::EnumWindows($enumCallback, [IntPtr]::Zero)
      }
      
      ShowDesktop
    `;

    const result = await runPowerShellCommand(psScript);
    return true;
  } catch (error) {
    return false;
  }
}

// Hilfsfunktion zum Ausführen von PowerShell-Befehlen
function runPowerShellCommand(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Erstelle temporäre Datei mit UTF-8 BOM Encoding für PowerShell
    const tempFilePath = path.join(os.tmpdir(), `ps-script-${Date.now()}.ps1`);
    const scriptWithErrorHandling = `
      $ErrorActionPreference = "Stop"
      try {
        ${script}
      } catch {
        Write-Error $_.Exception.Message
        exit 1
      }
    `;

    // UTF-8 BOM für PowerShell
    const bom = Buffer.from([0xef, 0xbb, 0xbf]);
    const scriptBuffer = Buffer.concat([
      bom,
      Buffer.from(scriptWithErrorHandling, "utf8"),
    ]);
    fs.writeFileSync(tempFilePath, scriptBuffer);

    // Führe PowerShell mit Debugging aus
    const process = execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempFilePath],
      { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 }, // 10MB Buffer
      (error, stdout, stderr) => {
        // Lösche temporäre Datei
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          // Warnung, wenn temporäre Datei nicht gelöscht werden konnte
        }

        if (error) {
          reject(new Error(`PowerShell error: ${error.message}\n${stderr}`));
          return;
        }

        if (stderr) {
          // Warnung, wenn stderr (nicht fatal) erhalten wird
        }

        resolve(stdout);
      }
    );
  });
}

// Funktion zum Abrufen der Prozesse mit Fenstern
async function getProcessesWithWindows(): Promise<ProcessInfo[]> {
  try {
    const processes = await getRunningApplications();
    const themes = dataStore.getThemes();

    // PowerShell command für Fensterabfrage
    const command = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        using System.Collections.Generic;

        public class WindowUtils {
            [DllImport("user32.dll")]
            public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

            [DllImport("user32.dll")]
            public static extern bool IsWindowVisible(IntPtr hWnd);

            [DllImport("user32.dll")]
            public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

            public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

            public static List<string> GetVisibleWindows() {
                var windows = new List<string>();

                EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {
                    if (IsWindowVisible(hWnd)) {
                        var builder = new StringBuilder(256);
                        uint processId = 0;

                        if (GetWindowThreadProcessId(hWnd, out processId) != 0 && 
                            GetWindowText(hWnd, builder, 256) > 0) {
                            
                            string title = builder.ToString().Trim();
                            if (!string.IsNullOrEmpty(title)) {
                                windows.Add(string.Format("{0}|{1}|{2}", hWnd, processId, title));
                            }
                        }
                    }
                    return true;
                }, IntPtr.Zero);

                return windows;
            }
        }
"@

      try {
          $windows = [WindowUtils]::GetVisibleWindows()
          return $windows
      } catch {
          throw
      }
    `;

    // Hole die Fenster
    const windowsOutput = await runPowerShellCommand(command);
    if (!windowsOutput || windowsOutput.trim() === "") {
      return [];
    }

    // Parse die Fenster-Ausgabe mit Typen
    const windows = windowsOutput
      .split("\n")
      .map((line: string) => line.trim())
      .filter((line: string) => line && line.includes("|"))
      .map((line: string) => {
        const [hwndStr, processIdStr, ...titleParts] = line.split("|");
        const hwnd = parseInt(hwndStr);
        const processId = parseInt(processIdStr);
        const title = titleParts.join("|").trim();

        if (isNaN(hwnd) || isNaN(processId) || !title) {
          return null;
        }

        return { hwnd, processId, title };
      })
      .filter(
        (window: WindowInfo | null): window is WindowInfo => window !== null
      );

    // Erstelle eine Map von Prozess-IDs zu ihren Fenstern
    const windowsByProcessId = new Map<number, WindowInfo[]>();
    windows.forEach((window: WindowInfo) => {
      if (!windowsByProcessId.has(window.processId)) {
        windowsByProcessId.set(window.processId, []);
      }
      windowsByProcessId.get(window.processId)!.push(window);
    });

    // Filtere die Fenster basierend darauf, ob sie einer Gruppe zugeordnet sind
    const processesWithWindows = processes.map((process) => {
      const processWindows = windowsByProcessId.get(process.id) || [];

      return {
        ...process,
        windows: processWindows,
      };
    });

    // Filtere Prozesse ohne Fenster heraus
    return processesWithWindows.filter(
      (p) => p.windows && p.windows.length > 0
    );
  } catch (error) {
    return [];
  }
}

// Zentrale Funktion zum Einrichten der IPC-Handler
function setupIpcHandlers() {
  // Entferne alle existierenden Handler
  ipcMain.removeHandler("get-running-applications");
  ipcMain.removeHandler("get-themes");
  ipcMain.removeHandler("save-themes");
  ipcMain.removeHandler("add-theme");
  ipcMain.removeHandler("update-theme");
  ipcMain.removeHandler("delete-theme");
  ipcMain.removeHandler("minimize-applications");
  ipcMain.removeHandler("minimize-all-except");
  ipcMain.removeHandler("show-desktop-except");
  ipcMain.removeHandler("register-shortcut");
  ipcMain.removeHandler("unregister-shortcut");
  ipcMain.removeHandler("add-windows-to-theme");
  ipcMain.removeHandler("remove-windows-from-theme");

  // Registriere die Handler neu
  ipcMain.handle("get-running-applications", async () => {
    return getProcessesWithWindows();
  });

  ipcMain.handle("get-themes", () => {
    return dataStore.getThemes();
  });

  ipcMain.handle("save-themes", (_, themes) => {
    dataStore.setThemes(themes);
    return true;
  });

  ipcMain.handle("add-theme", (_, theme) => {
    dataStore.addTheme(theme);
    return true;
  });

  ipcMain.handle("update-theme", (_, themeId, updatedTheme) => {
    dataStore.updateTheme(themeId, updatedTheme);
    return true;
  });

  ipcMain.handle("delete-theme", (_, themeId) => {
    dataStore.deleteTheme(themeId);
    return true;
  });

  // Neue Handler für Fenster-Management
  ipcMain.handle(
    "add-windows-to-theme",
    (_, themeId: string, windows: WindowInfo[]) => {
      dataStore.addWindowsToTheme(themeId, windows);
      return true;
    }
  );

  ipcMain.handle(
    "remove-windows-from-theme",
    (_, themeId: string, windowIds: number[]) => {
      dataStore.removeWindowsFromTheme(themeId, windowIds);
      return true;
    }
  );

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
    const success = registerThemeShortcut(themeId, shortcut);
    return success;
  });

  // Shortcut für ein Theme entfernen
  ipcMain.handle("unregister-shortcut", async (_, { themeId }) => {
    const success = unregisterThemeShortcut(themeId);
    return success;
  });

  // Window control handlers
  ipcMain.on("minimize-window", () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on("close-window", () => {
    if (mainWindow) mainWindow.close();
  });

  // Compact mode handler
  ipcMain.on(
    "toggle-compact-mode",
    (_, isCompact: boolean, groupCount: number) => {
      // Berechne dynamische Breite basierend auf Gruppenanzahl
      let width = 300; // Mindestbreite
      if (isCompact && groupCount > 0) {
        // Pro Gruppe etwa 120px, aber maximal 4 Gruppen pro Zeile
        const groupsPerRow = Math.min(groupCount, 4);
        width = Math.max(300, groupsPerRow * 120 + 80); // 80px für Padding/Margins
      }

      // Neue Fenstergröße für Kompaktmodus
      const newSize = isCompact
        ? { width, height: 120, alwaysOnTop: true }
        : { width: 600, height: 680, alwaysOnTop: false };

      // Fenstereigenschaften anpassen und Übergang berücksichtigen
      if (mainWindow) {
        // Aktiviere/deaktiviere "immer im Vordergrund" sofort
        mainWindow.setAlwaysOnTop(newSize.alwaysOnTop);

        // Verzögere die Größenänderung leicht, damit die CSS-Transition sichtbar ist
        setTimeout(() => {
          if (mainWindow) {
            mainWindow.setSize(newSize.width, newSize.height, true);

            // Wenn Kompaktmodus aktiviert wird, positioniere das Fenster in der unteren rechten Ecke
            if (isCompact) {
              const { width: screenWidth, height: screenHeight } =
                require("electron").screen.getPrimaryDisplay().workAreaSize;
              const xPosition = screenWidth - newSize.width - 20; // 20px Abstand vom Rand
              const yPosition = screenHeight - newSize.height - 20; // 20px Abstand vom Rand

              mainWindow.setPosition(xPosition, yPosition);
            }
          }
        }, 50); // Kleine Verzögerung für bessere Animation
      }
    }
  );
}

// Beim Beenden der App alle Shortcuts entfernen
app.on("will-quit", () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();
});

// Funktion zum Registrieren aller gespeicherten Shortcuts
async function registerSavedShortcuts() {
  try {
    const themes = dataStore.getThemes();

    themes.forEach((theme) => {
      if (theme.shortcut && theme.shortcut.trim() !== "") {
        registerThemeShortcut(theme.id, theme.shortcut);
      }
    });
  } catch (error) {
    // Error handling
  }
}

// App bereit-Event
app.on("ready", () => {
  createWindow();
  setupIpcHandlers();
  registerSavedShortcuts();
});

// Quit when all windows are closed, except on macOS
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

/**
 * Ruft alle sichtbaren Fenster mit ihren Titeln und Process IDs ab
 */
async function getWindows(): Promise<WindowInfo[]> {
  try {
    const command = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        using System.Collections.Generic;
        using System.Diagnostics;

        public class WindowUtils {
            [DllImport("user32.dll")]
            public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

            [DllImport("user32.dll")]
            public static extern bool IsWindowVisible(IntPtr hWnd);

            [DllImport("user32.dll")]
            public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

            [DllImport("user32.dll")]
            public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

            [DllImport("user32.dll")]
            [return: MarshalAs(UnmanagedType.Bool)]
            public static extern bool IsIconic(IntPtr hWnd);

            [DllImport("user32.dll")]
            public static extern IntPtr GetParent(IntPtr hWnd);

            [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
            public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

            public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

            public static List<string> GetVisibleWindows() {
                var windows = new List<string>();
                var processCache = new Dictionary<uint, Process>();

                try {
                    EnumWindows(delegate (IntPtr hWnd, IntPtr lParam) {
                        try {
                            // Überprüfe, ob das Fenster sichtbar ist und kein Kind-Fenster
                            if (IsWindowVisible(hWnd) && GetParent(hWnd) == IntPtr.Zero) {
                                var builder = new StringBuilder(256);
                                uint processId = 0;

                                if (GetWindowThreadProcessId(hWnd, out processId) != 0) {
                                    // Hole den Prozess aus dem Cache oder erstelle einen neuen
                                    Process process;
                                    if (!processCache.TryGetValue(processId, out process)) {
                                        try {
                                            process = Process.GetProcessById((int)processId);
                                            processCache[processId] = process;
                                        } catch {
                                            return true; // Prozess nicht mehr verfügbar, überspringen
                                        }
                                    }

                                    // Hole den Fenstertitel
                                    if (GetWindowText(hWnd, builder, 256) > 0) {
                                        string title = builder.ToString().Trim();
                                        
                                        // Ignoriere leere Titel und Hilfsprozesse
                                        if (!string.IsNullOrEmpty(title) && 
                                            !title.EndsWith(".exe") &&
                                            !title.Contains("Program Manager") &&
                                            !title.Contains("Windows Input Experience") &&
                                            !title.Contains("Microsoft Text Input Application") &&
                                            !title.Contains("Settings") &&
                                            !title.Contains("Windows Shell Experience Host")) {
                                            
                                            windows.Add(string.Format("{0}|{1}|{2}", hWnd, processId, title));
                                        }
                                    }
                                }
                            }
                        } catch (Exception ex) {
                        }
                        return true;
                    }, IntPtr.Zero);
                } catch (Exception ex) {
                    throw;
                }

                return windows;
            }
        }
"@

      try {
          $windows = [WindowUtils]::GetVisibleWindows()
          return $windows
      } catch {
          throw
      }
    `;

    const stdout = await runPowerShellCommand(command);

    if (!stdout || stdout.trim() === "") {
      return [];
    }

    const windowsData = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.includes("|"))
      .map((line) => {
        const [hwndStr, processIdStr, ...titleParts] = line.split("|");
        return {
          hwnd: parseInt(hwndStr),
          processId: parseInt(processIdStr),
          title: titleParts.join("|").trim(),
        };
      })
      .filter((window) => {
        // Zusätzliche Filterung auf JavaScript-Seite
        return (
          window.title &&
          !window.title.endsWith(".exe") &&
          !window.title.includes("--type=") &&
          !window.title.includes("crashpad-handler") &&
          !window.title.includes("gpu-process") &&
          !window.title.includes("utility") &&
          !window.title.includes("renderer")
        );
      });

    return windowsData;
  } catch (error) {
    return [];
  }
}

// Native Windows API Funktionen
// declare function getWindows(): Promise<WindowInfo[]>;
