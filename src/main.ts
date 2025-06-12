// Lade Umgebungsvariablen aus .env.local als erstes
import * as dotenv from "dotenv";
import * as path from "path";

// Bestimme den Pfad zur .env.local-Datei
const envPath = path.join(process.cwd(), ".env.local");
dotenv.config({ path: envPath });
console.log(`[Main] Umgebungsvariablen aus ${envPath} geladen`);

import {
  app,
  BrowserWindow,
  Tray,
  Menu,
  MenuItem,
  nativeImage,
  ipcMain,
  globalShortcut,
  dialog,
  shell,
  MessageBoxOptions,
} from "electron";
import { spawn, exec, execFile } from "child_process";
import { DataStore } from "./main/dataStore";
import { PersistentProcessIdentifier, Theme } from "./types";
import { createPersistentIdentifier } from "./utils/processUtils";
import * as url from "url";
import * as fs from "fs";
import * as os from "os";
import { stderr } from "process";
import Store from "electron-store";
import { autoUpdater } from "electron-updater";
import * as electronLog from "electron-log";
import {
  initAnalytics,
  trackEvent,
  shutdownAnalytics,
  setupGlobalErrorHandlers,
  captureException,
} from "./main/analytics";
import {
  initEnhancedAnalytics,
  captureEnhancedException,
  trackUserAction,
  trackPerformanceMetric,
} from "./main/enhancedAnalytics";
import { initializeLicenseSystem } from "./main/licenseIntegration";
import { getLicenseManager } from "./main/licensing";
import AutoLaunch from "auto-launch";

// Keep a global reference of objects to prevent garbage collection
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const dataStore = new DataStore();

// AutoLaunch für Windows Autostart
const autoLauncher = new AutoLaunch({
  name: "SwitchFast",
  path: process.execPath,
  isHidden: false,
});

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
  const windowCreateStart = Date.now();

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
    icon: path.join(__dirname, "assets/logo 256.png"),
    frame: false,
    backgroundColor: "#414159",
    alwaysOnTop: compactMode,
    title: "switchfast",
    show: false, // Verhindert leeren Rahmen beim Start
  });

  // Mache mainWindow als globale Variable verfügbar für DataStore
  (global as any).mainWindow = mainWindow;

  // Menüleiste komplett entfernen
  mainWindow.setMenu(null);

  // Load the app
  // Wir verwenden immer die gebauten Dateien, da wir keinen Webpack Dev Server laufen haben
  // Lade Anwendung aus lokalen Dateien

  mainWindow.loadURL(
    url.format({
      pathname: path.join(__dirname, "renderer/index.html"),
      protocol: "file:",
      slashes: true,
    })
  );

  // Fenster anzeigen, sobald es bereit ist (Fallback)
  mainWindow.once("ready-to-show", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Track when UI window is created (but don't track event here anymore)
  mainWindow.webContents.once("did-finish-load", () => {
    const windowLoadDuration = Date.now() - windowCreateStart;
    // Fenster geladen
    // Fenster anzeigen, wenn der Inhalt vollständig geladen ist
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
    }
  });

  // Öffne Developer Tools nur in der Entwicklung
  if (process.env.NODE_ENV === "development") {
    mainWindow.webContents.openDevTools();
  }

  // Handle window closed
  mainWindow.on("closed", () => {
    mainWindow = null;
    (global as any).mainWindow = null;
  });

  // Hide window to tray when minimized instead of taskbar
  mainWindow.on("minimize", (event: Event) => {
    event.preventDefault();
    mainWindow?.hide();
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
    const iconPath = path.join(__dirname, "assets/logo 256.png");

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

    // Registriere alle gespeicherten Theme-Shortcuts
    // Wir führen dies asynchron aus, um die App-Initialisierung nicht zu blockieren
    setTimeout(async () => {
      try {
        await registerSavedShortcuts();
        // Alle Theme-Shortcuts wurden registriert
      } catch (error) {
        console.error(
          "[Shortcut] Fehler bei der Registrierung der Theme-Shortcuts:",
          error
        );
        captureException(error as Error, {
          function: "registerShortcuts",
          context: "Failed to register theme shortcuts",
          step: "registerSavedShortcuts",
        });
      }
    }, 2000); // Kurze Verzögerung, um sicherzustellen, dass die App vollständig geladen ist
  } catch (error) {
    console.error(
      "[Shortcut] Fehler bei der Registrierung des globalen Shortcuts:",
      error
    );
    captureException(error as Error, {
      function: "registerShortcuts",
      context: "Failed to register global shortcut",
      step: "global_shortcut_registration",
    });
  }
}

// Globale Variable, um die Shortcut-Handler zu speichern
const shortcutHandlers: Map<string, () => void> = new Map();

// Globale Variable, um den Zustand der Shortcut-Registrierung zu verfolgen
let shortcutsRegistered = false;

function registerThemeShortcut(themeId: string, shortcut: string): boolean {
  try {
    const existingShortcut = registeredShortcuts.get(themeId);
    if (existingShortcut && existingShortcut !== shortcut) {
      try {
        globalShortcut.unregister(existingShortcut);
      } catch (error) {
        console.error(
          `[Shortcut] Fehler beim Entfernen des alten Shortcuts für Theme ${themeId}:`,
          error
        );
      }
    }

    if (!shortcut || shortcut.trim() === "") {
      return false;
    }

    const formattedShortcut = formatShortcutForElectron(shortcut);

    if (globalShortcut.isRegistered(formattedShortcut)) {
      globalShortcut.unregister(formattedShortcut);
    }

    const handler = () => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }

      const theme = dataStore.getTheme(themeId);
      if (!theme) {
        console.error(`[Shortcut] Theme ${themeId} nicht gefunden`);
        return;
      }

      trackEvent("shortcut_used", {
        themeId: themeId,
        theme_name: theme.name || "unknown",
        shortcut: formattedShortcut,
        action_type: "activate",
      });

      // Track user action for enhanced analytics
      trackUserAction(`shortcut_used:${theme.name}`, {
        themeId: themeId,
        shortcut: formattedShortcut,
      });

      if (mainWindow)
        mainWindow.webContents.send(
          "activate-theme-and-minimize",
          themeId,
          theme
        );

      setTimeout(() => {
        updateThemeProcessIds(theme)
          .then(() => {
            console.log(
              `[Shortcut] PIDs für Theme ${themeId} im Hintergrund aktualisiert`
            );
          })
          .catch((err) => {
            console.error(
              `[Shortcut] Fehler beim Aktualisieren der PIDs für Theme ${themeId} im Hintergrund:`,
              err
            );
          });
      }, 0);
    };

    shortcutHandlers.set(themeId, handler);

    const success = globalShortcut.register(formattedShortcut, handler);

    if (success) {
      registeredShortcuts.set(themeId, formattedShortcut);

      if (globalShortcut.isRegistered(formattedShortcut)) {
        return true;
      } else {
        registeredShortcuts.delete(themeId);
        return false;
      }
    } else {
      return false;
    }
  } catch (error) {
    console.error(
      `[Shortcut] Unerwarteter Fehler bei der Registrierung des Shortcuts für Theme ${themeId}:`,
      error
    );
    captureException(error as Error, {
      function: "registerThemeShortcut",
      context: "Failed to register theme shortcut",
      themeId: themeId,
      shortcut: shortcut,
    });
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

function unregisterThemeShortcut(themeId: string): void {
  try {
    // Entfernt: [Shortcut] unregisterThemeShortcut called
    const shortcut = registeredShortcuts.get(themeId);

    if (shortcut) {
      // Entfernt: [Shortcut] Attempting to unregister shortcut
      try {
        globalShortcut.unregister(shortcut);
        registeredShortcuts.delete(themeId);
        // Entfernt: [Shortcut] Successfully unregistered and removed shortcut
      } catch (error) {
        console.error(
          `[Shortcut] Error during globalShortcut.unregister("${shortcut}") for themeId ${themeId}:`,
          error
        );
        registeredShortcuts.delete(themeId);
        // Entfernt: [Shortcut] Removed shortcut from internal map despite unregistration error
      }
    } else if (registeredShortcuts.has(themeId)) {
      registeredShortcuts.delete(themeId);
      // Entfernt: [Shortcut] ThemeId found in registeredShortcuts, but shortcut string was empty/invalid
    } else {
      // Entfernt: [Shortcut] No shortcut found in internal map
    }

    shortcutHandlers.delete(themeId);
  } catch (error) {
    console.error(
      `[Shortcut] Unexpected error in unregisterThemeShortcut for themeId ${themeId}:`,
      error
    );
  }
}
/**
 * Ruft alle laufenden Anwendungen mit ihren Fenstertiteln ab
 */
async function getRunningApplications(): Promise<ProcessInfo[]> {
  try {
    // Starting process query

    // PowerShell-Befehl zum Abrufen der Prozesse
    const command = `
      $processes = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath;
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
          
          # Vereinfachte Logik: Alle Prozesse mit MainWindowTitle oder bekannte Apps
          if ($process.MainWindowTitle -and $process.MainWindowTitle.Trim() -ne "" -and 
              $process.MainWindowTitle -ne $process.Name) {
            $relevantProcess = $true;
          } elseif ($desktopApps -contains $processName -or 
              $processName -match "brave|chrome|firefox|msedge|opera") {
            $relevantProcess = $true;
          }

          if ($relevantProcess) {
            $title = if ($process.MainWindowTitle) { 
              $process.MainWindowTitle 
            } else { 
              $p.Name 
            }

            # Output as semicolon-separated values to avoid JSON issues
            $safeName = $p.Name -replace ';', ','
            $safeTitle = $title -replace ';', ','
            $safePath = if ($p.ExecutablePath) { $p.ExecutablePath -replace ';', ',' } else { "" }
            
            "$($p.ProcessId);$($p.ParentProcessId);$safeName;$safeTitle;$safePath"
          }
        }
      }
    `;

    // PowerShell-Befehl ausführen und Ausgabe verarbeiten
    const stdout = await runPowerShellCommand(command);

    if (!stdout || stdout.trim() === "") {
      return [];
    }

    // Parse semicolon-separated values
    const lines = stdout.split("\n").filter((line) => line.trim() !== "");
    // Parsed process lines

    const processes: ProcessInfo[] = lines
      .map((line) => {
        const parts = line.trim().split(";");
        if (parts.length !== 5) {
          // Skipping invalid line
          return null;
        }

        const [idStr, parentIdStr, name, title, path] = parts;
        const id = parseInt(idStr);
        const parentId = parseInt(parentIdStr);

        if (isNaN(id)) {
          return null;
        }

        return {
          id,
          parentId: isNaN(parentId) ? undefined : parentId,
          name: formatAppName(name.toLowerCase().replace(".exe", "")),
          title: title || name,
          path: path || "",
        } as ProcessInfo;
      })
      .filter((proc): proc is ProcessInfo => proc !== null);

    return processes;
  } catch (error) {
    console.error("[getRunningApplications] Error:", error);
    captureEnhancedException(error as Error, {
      function: "getRunningApplications",
      error_category: "system",
      error_severity: "medium",
      user_action: "app_initialization",
    });
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
async function showDesktopExceptApps(
  appIdsToProtect: number[]
): Promise<boolean> {
  try {
    console.log(
      "[showDesktopExceptApps] Starting with protected IDs:",
      appIdsToProtect
    );

    // Hole zuerst alle Fenster, um die korrekten PIDs zu den Handles zu bekommen
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
          
          [DllImport("user32.dll")]
          public static extern bool IsWindowVisible(IntPtr hWnd);
          
          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
      }
"@

      $windows = New-Object System.Collections.ArrayList

      $enumWindowCallback = {
          param(
              [IntPtr]$hwnd,
              [IntPtr]$lParam
          )

          $processId = 0
          [void][WindowUtils]::GetWindowThreadProcessId($hwnd, [ref]$processId)
          
          [void]$windows.Add("$($hwnd.ToInt64())|$processId")
          
          return $true
      }

      [WindowUtils]::EnumWindows($enumWindowCallback, [IntPtr]::Zero)
      $windows -join ","
    `;

    const windowsResult = await runPowerShellCommand(windowsScript);
    console.log(
      "[showDesktopExceptApps] Window mapping result:",
      windowsResult
    );

    // Parse die Window-zu-PID Mappings
    const windowToPidMap = new Map<number, number>();
    const pidToWindowsMap = new Map<number, number[]>();

    if (windowsResult.trim()) {
      windowsResult.split(",").forEach((mapping) => {
        const [hwnd, pid] = mapping.split("|").map((n) => parseInt(n.trim()));
        if (!isNaN(hwnd) && !isNaN(pid)) {
          windowToPidMap.set(hwnd, pid);
          if (!pidToWindowsMap.has(pid)) {
            pidToWindowsMap.set(pid, []);
          }
          pidToWindowsMap.get(pid)!.push(hwnd);
        }
      });
    }

    // Sammle alle zu schützenden Fenster und Prozess-IDs getrennt
    const protectedWindowHandles = new Set<number>();
    const protectedProcessIds = new Set<number>();

    console.log(
      "[showDesktopExceptApps] Analyzing protected IDs:",
      appIdsToProtect
    );

    appIdsToProtect.forEach((id) => {
      // VERBESSERTE LOGIK: Window-Handles sind typischerweise viel größer als Prozess-IDs
      // Window-Handles sind oft 6-7 stellige Zahlen, Prozess-IDs sind meist 4-5 stellig
      const isLikelyWindowHandle = id > 65536; // 0x10000 - typischer Schwellwert

      if (isLikelyWindowHandle && windowToPidMap.has(id)) {
        // Es ist definitiv ein Window-Handle und in der Map
        protectedWindowHandles.add(id);
        console.log(
          `[showDesktopExceptApps] ID ${id} ist Window-Handle (in Map)`
        );
      } else if (isLikelyWindowHandle) {
        // Es ist wahrscheinlich ein Window-Handle, aber nicht in der aktuellen Map
        // (Fenster könnte minimiert oder versteckt sein)
        protectedWindowHandles.add(id);
        console.log(
          `[showDesktopExceptApps] ID ${id} ist Window-Handle (nicht in Map, wahrscheinlich minimiert)`
        );
      } else {
        // Es ist eine Prozess-ID
        protectedProcessIds.add(id);
        console.log(`[showDesktopExceptApps] ID ${id} ist Prozess-ID`);
        // Füge alle Fenster dieser Prozess-ID hinzu
        if (pidToWindowsMap.has(id)) {
          const windowsForProcess = pidToWindowsMap.get(id)!;
          windowsForProcess.forEach((hwnd) => protectedWindowHandles.add(hwnd));
          console.log(
            `[showDesktopExceptApps] Hinzugefügt ${windowsForProcess.length} Fenster für Prozess ${id}:`,
            windowsForProcess
          );
        }
      }
    });

    // Füge eigene Anwendung zu den geschützten Fenstern hinzu
    const ourProcessId = process.pid;
    // Show desktop except protected apps
    if (pidToWindowsMap.has(ourProcessId)) {
      pidToWindowsMap
        .get(ourProcessId)!
        .forEach((hwnd) => protectedWindowHandles.add(hwnd));
    }

    const protectedWindowsArray = Array.from(protectedWindowHandles);
    console.log(
      "[showDesktopExceptApps] All protected windows:",
      protectedWindowsArray
    );

    const protectedWindowsStr = protectedWindowsArray.join(",");
    console.log(
      "[showDesktopExceptApps] Running PowerShell script with protected windows:",
      protectedWindowsStr
    );

    const psScript = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Text;
      using System.Collections.Generic;

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

          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool IsIconic(IntPtr hWnd);

          [DllImport("user32.dll", SetLastError = true)]
          public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);

          [DllImport("user32.dll", SetLastError=true)]
          public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
          
          [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
          public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);

          public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

          public const int SW_MINIMIZE = 6;
          public const int SW_RESTORE = 9;
      }
"@

      # PERFORMANCE-OPTIMIERUNG: Konvertiere Arrays in HashSets für schnellere Lookups
      $protectedWindowsStr = "${protectedWindowsStr}"
      $protectedWindowsArray = $protectedWindowsStr -split "," | ForEach-Object { [int]$_ }
      $protectedWindowsSet = New-Object System.Collections.Generic.HashSet[int]
      foreach ($id in $protectedWindowsArray) { [void]$protectedWindowsSet.Add($id) }
      $ourProcessId = ${ourProcessId}
      
      # PERFORMANCE-OPTIMIERUNG: Reduzierte Logging-Ausgaben
      
      # Spezielle Fenster-Klassen identifizieren (Desktop, Taskbar, etc.)
      $specialClasses = @("Progman", "WorkerW", "Shell_TrayWnd", "DV2ControlHost", "SysListView32", "FolderView")
      $specialClassesSet = New-Object System.Collections.Generic.HashSet[string]
      foreach ($class in $specialClasses) { [void]$specialClassesSet.Add($class) }
      
      # Finde spezielle Fenster, die wir nicht minimieren sollten
      $taskbarWindow = [WindowUtils]::FindWindow("Shell_TrayWnd", $null)
      $progmanWindow = [WindowUtils]::FindWindow("Progman", $null)
      
      # PERFORMANCE-OPTIMIERUNG: Nur ein Durchlauf durch alle Fenster
      # Sammle zuerst alle zu minimierenden und zu schützenden Fenster
      $windowsToMinimize = New-Object System.Collections.ArrayList
      $windowsToRestore = New-Object System.Collections.ArrayList
      
      $enumCallback = {
          param(
              [IntPtr]$hwnd,
              [IntPtr]$lParam
          )
          
          # Prüfen, ob es sich um ein sichtbares Fenster handelt
          if (![WindowUtils]::IsWindowVisible($hwnd)) {
              return $true
          }
          
          # Spezielle Fenster-Klassen identifizieren
          $classNameBuilder = New-Object System.Text.StringBuilder 256
          [WindowUtils]::GetClassName($hwnd, $classNameBuilder, 256) | Out-Null
          $className = $classNameBuilder.ToString()
          
          # Wenn es sich um ein System-/Desktop-Fenster handelt, überspringen
          if ($specialClassesSet.Contains($className) -or $hwnd -eq $progmanWindow) {
              return $true
          }
          
          # Überprüfe, ob das Fenster zu unserem eigenen Prozess gehört
          $processId = 0
          [void][WindowUtils]::GetWindowThreadProcessId($hwnd, [ref]$processId)
          
          # Wenn es sich um unsere eigene App oder ein spezifisch geschütztes Fenster handelt
          $hwndInt = $hwnd.ToInt32()
          if ($processId -eq $ourProcessId -or $protectedWindowsSet.Contains($hwndInt)) {
              if ([WindowUtils]::IsIconic($hwnd)) {
                  [void]$windowsToRestore.Add($hwnd)
              }
              return $true
          }
          
          # Alle anderen Fenster zum Minimieren vormerken
          [void]$windowsToMinimize.Add($hwnd)
          return $true
      }
      
      # Sammle alle Fenster
      [WindowUtils]::EnumWindows($enumCallback, [IntPtr]::Zero)
      
      # PERFORMANCE-OPTIMIERUNG: Batch-Operationen für Minimieren und Wiederherstellen
      # Minimiere alle vorgemerkten Fenster
      foreach ($hwnd in $windowsToMinimize) {
          [WindowUtils]::ShowWindow($hwnd, [WindowUtils]::SW_MINIMIZE)
      }
      
      # Stelle alle geschützten Fenster wieder her
      foreach ($hwnd in $windowsToRestore) {
          [WindowUtils]::ShowWindow($hwnd, [WindowUtils]::SW_RESTORE)
      }
      
      # Gib Erfolg zurück
      $true
    `;

    const result = await runPowerShellCommand(psScript);
    console.log(
      "[showDesktopExceptApps] PowerShell script completed with result:",
      result
    );
    return true;
  } catch (error) {
    console.error("[showDesktopExceptApps] Error:", error);
    captureEnhancedException(error as Error, {
      function: "showDesktopExceptApps",
      error_category: "system",
      error_severity: "high",
      process_ids: appIdsToProtect,
      user_action: "desktop_management",
    });
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
    // Starting process query with windows
    const processes = await getRunningApplications();
    // DEBUG: Zeige alle Browser-Prozesse
    const braveProcesses = processes.filter((p) =>
      p.name.toLowerCase().includes("brave")
    );

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

    // DEBUG: Zeige alle Brave-Fenster
    const braveWindows = windows.filter((w) => {
      const braveProcess = processes.find((p) => p.id === w.processId);
      return braveProcess && braveProcess.name.toLowerCase().includes("brave");
    });

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
    const result = processesWithWindows.filter(
      (p) => p.windows && p.windows.length > 0
    );

    // DEBUG: Zeige gefilterte Brave-Prozesse
    const finalBraveProcesses = result.filter((p) =>
      p.name.toLowerCase().includes("brave")
    );

    return result;
  } catch (error) {
    console.error("[getProcessesWithWindows] Error:", error);
    captureException(error as Error, {
      function: "getProcessesWithWindows",
      context: "Failed to retrieve processes with windows",
    });
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
    console.log(
      "[IPC] get-running-applications wird aufgerufen - verwende getProcessesWithWindows()"
    );
    return getProcessesWithWindows();
  });

  ipcMain.handle("get-themes", () => {
    return dataStore.getThemes();
  });

  ipcMain.handle("get-theme", (_, themeId) => {
    const theme = dataStore.getTheme(themeId);
    return theme;
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

  ipcMain.handle("delete-theme", async (event, themeId: string) => {
    // Delete theme request received
    try {
      const themeToDelete = dataStore.getThemes().find((t) => t.id === themeId);
      let shortcutInfo = "N/A";
      if (themeToDelete && themeToDelete.shortcut) {
        shortcutInfo = themeToDelete.shortcut;
      }
      console.log(
        `[IPC] Attempting to delete theme: ID=${themeId}, Name=${
          themeToDelete?.name || "N/A"
        }, Shortcut=${shortcutInfo}`
      );

      // Attempt to unregister the shortcut FIRST.
      unregisterThemeShortcut(themeId);

      // Delete the theme data from the store
      dataStore.deleteTheme(themeId);
      console.log(
        `[IPC] Theme data for themeId ${themeId} deleted from DataStore.`
      );
      return { success: true };
    } catch (error) {
      console.error(
        `[IPC] Critical error in delete-theme handler for themeId ${themeId}:`,
        error
      );
      return { success: false, error: (error as Error).message };
    }
  });

  // Neue Handler für Fenster-Management
  ipcMain.handle(
    "add-windows-to-theme",
    async (_, themeId: string, windows: WindowInfo[]) => {
      try {
        // Thema abrufen
        const theme = dataStore.getTheme(themeId);
        if (!theme) {
          console.error(`[IPC] Thema mit ID ${themeId} nicht gefunden.`);
          return false;
        }

        // OPTIMIERT: Nur die benötigten Prozesse abrufen statt aller
        // Sammle alle einzigartigen Prozess-IDs aus den Fenstern
        const uniqueProcessIds = [...new Set(windows.map((w) => w.processId))];
        const processes: ProcessInfo[] = [];

        // Für jede einzigartige Prozess-ID, rufe nur diese spezifische Information ab
        for (const processId of uniqueProcessIds) {
          try {
            const script = `
              $process = Get-Process -Id ${processId} -ErrorAction SilentlyContinue
              if ($process) {
                $name = $process.ProcessName
                $path = $null
                try { $path = $process.MainModule.FileName } catch {}
                
                # Log original title for debugging
                $originalTitle = $process.MainWindowTitle
                Write-Host "[PS DEBUG] Original title: '$originalTitle'"
                Write-Host "[PS DEBUG] Original title bytes: $([System.Text.Encoding]::UTF8.GetBytes($originalTitle) -join ' ')"
                
                # Escape control characters in window title for safe JSON parsing
                $title = $process.MainWindowTitle
                if ($title) {
                  $title = $title -replace [char]0x00, '\\x00' -replace [char]0x01, '\\x01' -replace [char]0x02, '\\x02' -replace [char]0x03, '\\x03' -replace [char]0x04, '\\x04' -replace [char]0x05, '\\x05' -replace [char]0x06, '\\x06' -replace [char]0x07, '\\x07' -replace [char]0x08, '\\x08' -replace [char]0x0B, '\\x0B' -replace [char]0x0C, '\\x0C' -replace [char]0x0E, '\\x0E' -replace [char]0x0F, '\\x0F' -replace [char]0x10, '\\x10' -replace [char]0x11, '\\x11' -replace [char]0x12, '\\x12' -replace [char]0x13, '\\x13' -replace [char]0x14, '\\x14' -replace [char]0x15, '\\x15' -replace [char]0x16, '\\x16' -replace [char]0x17, '\\x17' -replace [char]0x18, '\\x18' -replace [char]0x19, '\\x19' -replace [char]0x1A, '\\x1A' -replace [char]0x1B, '\\x1B' -replace [char]0x1C, '\\x1C' -replace [char]0x1D, '\\x1D' -replace [char]0x1E, '\\x1E' -replace [char]0x1F, '\\x1F' -replace [char]0x7F, '\\x7F'
                  Write-Host "[PS DEBUG] Escaped title: '$title'"
                }
                
                $jsonObj = [PSCustomObject]@{
                  id = $process.Id
                  name = $name
                  path = $path
                  title = $title
                }
                
                Write-Host "[PS DEBUG] About to convert to JSON:"
                $jsonString = $jsonObj | ConvertTo-Json
                Write-Host "[PS DEBUG] JSON result: $jsonString"
                $jsonString
              }
            `;

            const result = await runPowerShellCommand(script);

            if (result && result.trim()) {
              // Extrahiere das vollständige mehrzeilige JSON (alles nach dem letzten Debug-Log)
              const lines = result.split("\n");
              let jsonStartIndex = -1;

              // Finde den Index wo das echte JSON beginnt (nach allen Debug-Logs)
              for (let i = lines.length - 1; i >= 0; i--) {
                const line = lines[i].trim();
                if (line.startsWith("{")) {
                  jsonStartIndex = i;
                  break;
                }
              }

              let jsonString = "";
              if (jsonStartIndex >= 0) {
                // Sammle alle Zeilen vom JSON-Start bis zum Ende
                const jsonLines = [];
                for (let i = jsonStartIndex; i < lines.length; i++) {
                  const line = lines[i].trim();
                  if (line) {
                    // Ignoriere leere Zeilen
                    jsonLines.push(line);
                  }
                }
                jsonString = jsonLines.join("");
              }

              if (jsonString) {
                try {
                  // WICHTIG: Entferne Steuerzeichen KOMPLETT!
                  // \\x07 (BEL) und andere sind NICHT gültiges JSON - sie sind JSON5!
                  // JSON unterstützt nur: \", \\, \/, \b, \f, \n, \r, \t und \uXXXX
                  const cleanJsonString = jsonString.replace(
                    /[\x00-\x1F\x7F]/g,
                    ""
                  );

                  const process = JSON.parse(cleanJsonString);
                  processes.push({
                    id: process.id,
                    name: formatAppName(
                      process.name.toLowerCase().replace(".exe", "")
                    ),
                    title: process.title || process.name,
                    path: process.path || "",
                  });
                } catch (parseError) {
                  console.error(
                    `[IPC] JSON-Parse-Fehler für Prozess ${processId}:`,
                    parseError
                  );
                }
              }
            }
          } catch (error) {
            console.error(
              `[IPC] Fehler beim Abrufen des Prozesses ${processId} für Fenster:`,
              error
            );
            // Weiter mit den anderen Prozessen, auch wenn einer fehlschlägt
          }
        }

        // Fenster zum Thema hinzufügen (inklusive automatischer Erstellung von persistenten Identifikatoren)
        dataStore.addWindowsToTheme(themeId, windows, processes);

        return true;
      } catch (error) {
        console.error(
          "[IPC] Fehler beim Hinzufügen von Fenstern zum Thema:",
          error
        );
        return false;
      }
    }
  );

  // Handler für das Entfernen von Fenstern aus einem Thema
  ipcMain.handle(
    "remove-windows-from-theme",
    async (_, themeId: string, windowIds: number[]) => {
      try {
        // Theme vor Änderung anzeigen
        const themeBefore = dataStore.getTheme(themeId);

        // Thema abrufen
        const theme = dataStore.getTheme(themeId);
        if (!theme) {
          console.error(`[IPC] Thema mit ID ${themeId} nicht gefunden.`);
          return false;
        }

        // Fenster aus dem Thema entfernen
        dataStore.removeWindowsFromTheme(themeId, windowIds);

        // Theme nach Änderung anzeigen
        const themeAfter = dataStore.getTheme(themeId);
        return true;
      } catch (error) {
        console.error(
          "[IPC] Fehler beim Entfernen von Fenstern aus Thema:",
          error
        );
        return false;
      }
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

  // App quit handler
  ipcMain.handle("app:quit", () => {
    app.quit();
  });

  // Autostart-Handler
  ipcMain.handle("autostart:enable", async () => {
    try {
      await autoLauncher.enable();
      return true;
    } catch (error) {
      console.error("Fehler beim Aktivieren des Autostarts:", error);
      return false;
    }
  });

  ipcMain.handle("autostart:disable", async () => {
    try {
      await autoLauncher.disable();
      return true;
    } catch (error) {
      console.error("Fehler beim Deaktivieren des Autostarts:", error);
      return false;
    }
  });

  ipcMain.handle("autostart:is-enabled", async () => {
    try {
      return await autoLauncher.isEnabled();
    } catch (error) {
      console.error("Fehler beim Prüfen des Autostart-Status:", error);
      return false;
    }
  });

  // Device ID Handler
  ipcMain.handle("get-device-id", async () => {
    try {
      // Verwende dieselbe Logik wie im LicenseManager
      const licenseManager = getLicenseManager();
      if (licenseManager) {
        return licenseManager.getDeviceId();
      } else {
        // Fallback wenn LicenseManager noch nicht initialisiert ist
        const { machineId } = require("node-machine-id");
        return await machineId();
      }
    } catch (error) {
      console.error("Fehler beim Abrufen der Device-ID:", error);
      return "Unknown";
    }
  });

  // Lokale Device-Daten löschen (für Account-Löschung)
  ipcMain.handle("device:clear-local-data", async () => {
    try {
      console.log("[IPC] Clearing local device data for account deletion...");

      // Alle Electron Stores löschen
      const Store = require("electron-store");

      // Lizenz Store löschen
      const licenseStore = new Store({
        name: "workfocus-license",
        encryptionKey:
          process.env.LICENSE_ENCRYPTION_KEY ||
          "6d24f9b2d334e2095f93b7de9b63df751650956b9e74378d727d163216b673fd",
      });
      licenseStore.clear();

      // Config Store löschen
      const configStore = new Store({ name: "workfocus-config" });
      configStore.clear();

      // Theme Store löschen (DataStore)
      dataStore.clearAllData();

      console.log("✅ [IPC] Local device data cleared successfully");
      return true;
    } catch (error) {
      console.error("❌ [IPC] Error clearing local device data:", error);
      return false;
    }
  });

  // Compact mode handler
  // Handler für das direkte Hinzufügen eines Prozesses zu einem Thema
  ipcMain.handle(
    "add-process-to-theme",
    async (_, themeId: string, processId: number) => {
      try {
        console.log(
          `[IPC] Füge Prozess ${processId} zum Thema ${themeId} hinzu`
        );

        // Thema abrufen
        const theme = dataStore.getTheme(themeId);
        if (!theme) {
          console.error(`[IPC] Thema mit ID ${themeId} nicht gefunden.`);
          return false;
        }

        // Initialisiere Arrays, falls nicht vorhanden
        if (!theme.processes) theme.processes = [];
        if (!theme.persistentProcesses) theme.persistentProcesses = [];

        // Prozessinformationen abrufen - OPTIMIERT: Nur den einen Prozess abrufen statt aller
        // Dies beschleunigt die Verarbeitung erheblich
        let process: ProcessInfo | undefined;

        try {
          // PowerShell-Befehl zum Abrufen eines einzelnen Prozesses (viel schneller)
          const script = `
            $process = Get-Process -Id ${processId} -ErrorAction SilentlyContinue
            if ($process) {
              $name = $process.ProcessName
              $path = $null
              try { $path = $process.MainModule.FileName } catch {}
              
              [PSCustomObject]@{
                id = $process.Id
                name = $name
                path = $path
                title = $process.MainWindowTitle
              } | ConvertTo-Json
            }
          `;

          const result = await runPowerShellCommand(script);
          if (result && result.trim()) {
            // Bereinige Steuerzeichen die JSON.parse() zum Absturz bringen
            const cleanedResult = result.replace(/[\x00-\x1F\x7F]/g, "");
            process = JSON.parse(cleanedResult);
          }
        } catch (error) {
          console.error(
            `[IPC] Fehler beim Abrufen des Prozesses ${processId}:`,
            error
          );
          // Fallback zur alten Methode
          const processes = await getRunningApplications();
          process = processes.find((p) => p.id === processId);
        }

        if (process) {
          console.log(
            `[IPC] Prozess gefunden: ${process.name} (${process.id}), Pfad: ${
              process.path || "unbekannt"
            }`
          );

          // Persistenten Identifikator erstellen und speichern
          const persistentId = createPersistentIdentifier(process);
          console.log(
            `[IPC] Persistenter Identifikator erstellt: ${JSON.stringify(
              persistentId
            )}`
          );

          // Prüfen, ob der persistente Identifikator bereits existiert
          const exists = theme.persistentProcesses.some(
            (p) => p.executableName === persistentId.executableName
          );

          if (!exists) {
            console.log(
              `[IPC] Füge persistenten Identifikator für ${process.name} zum Thema ${theme.id} hinzu.`
            );
            theme.persistentProcesses.push(persistentId);
          } else {
            console.log(
              `[IPC] Persistenter Identifikator für ${process.name} existiert bereits im Thema ${theme.id}.`
            );
          }

          // Prozess-ID zum processes-Array hinzufügen, falls noch nicht vorhanden
          const wasNewlyAdded = !theme.processes.includes(processId);
          if (wasNewlyAdded) {
            console.log(
              `[IPC] Füge Prozess-ID ${processId} zum Thema ${theme.id} hinzu.`
            );
            theme.processes.push(processId);
          }

          // Thema aktualisieren
          dataStore.updateTheme(themeId, theme);

          // Analytics: App zu Theme hinzugefügt (nur wenn wirklich neu hinzugefügt)
          if (wasNewlyAdded) {
            const finalTheme = dataStore.getTheme(themeId);
            if (finalTheme) {
              trackEvent("app_added_to_theme", {
                theme_name: finalTheme.name,
                apps_in_theme:
                  finalTheme.processes.length > 0
                    ? finalTheme.processes.length
                    : finalTheme.applications?.length || 0,
                apps_added: 1,
              });
            }
          }

          console.log(
            `[IPC] Prozess ${processId} erfolgreich zum Thema ${themeId} hinzugefügt.`
          );

          return true;
        } else {
          console.error(`[IPC] Prozess mit ID ${processId} nicht gefunden.`);
          return false;
        }
      } catch (error) {
        console.error(
          `[IPC] Fehler beim Hinzufügen des Prozesses ${processId} zum Thema ${themeId}:`,
          error
        );
        return false;
      }
    }
  );

  ipcMain.handle(
    "remove-process-from-theme",
    async (_, themeId: string, processId: number) => {
      try {
        console.log(`[BACKEND STEP 3] remove-process-from-theme aufgerufen:`);
        console.log(`[BACKEND STEP 3] - themeId: ${themeId}`);
        console.log(`[BACKEND STEP 3] - processId: ${processId}`);

        // Theme vor Änderung anzeigen
        const themeBefore = dataStore.getTheme(themeId);
        console.log(
          `[BACKEND STEP 3] - Theme VORHER:`,
          JSON.stringify(
            {
              id: themeBefore?.id,
              name: themeBefore?.name,
              applications: themeBefore?.applications,
              processes: themeBefore?.processes,
              persistentProcesses: themeBefore?.persistentProcesses,
              windows: (themeBefore as any)?.windows,
            },
            null,
            2
          )
        );

        // Initial check for theme existence
        const initialThemeCheck = dataStore.getTheme(themeId);
        if (!initialThemeCheck) {
          console.error(
            `[IPC] Theme with ID ${themeId} not found at initial check.`
          );
          return false;
        }

        // OPTIMIERT: Nur den spezifischen Prozess abrufen statt aller
        let process: ProcessInfo | undefined;
        try {
          const script = `
            $process = Get-Process -Id ${processId} -ErrorAction SilentlyContinue
            if ($process) {
              $name = $process.ProcessName
              $path = $null
              try { $path = $process.MainModule.FileName } catch {}
              
              [PSCustomObject]@{
                id = $process.Id
                name = $name
                path = $path
                title = $process.MainWindowTitle
              } | ConvertTo-Json
            }
          `;

          const result = await runPowerShellCommand(script);
          if (result && result.trim()) {
            const processData = JSON.parse(result);
            process = {
              id: processData.id,
              name: formatAppName(
                processData.name.toLowerCase().replace(".exe", "")
              ),
              title: processData.title || processData.name,
              path: processData.path || "",
            };
            console.log(
              `[IPC] Optimiert: Spezifischen Prozess ${process.name} (${process.id}) abgerufen`
            );
          }
        } catch (error) {
          console.error(
            `[IPC] Fehler beim Abrufen des Prozesses ${processId}:`,
            error
          );
          // Prozess ist nicht laufend oder nicht verfügbar
          process = undefined;
        }

        let success = false;

        if (process) {
          // Process is running
          console.log(
            `[IPC] Process ${processId} (${process.name}) is running. Checking current theme state before removal attempt.`
          );
          const persistentId = createPersistentIdentifier(process);

          // Get the most current theme state directly before the check and operation
          const currentTheme = dataStore.getTheme(themeId);
          if (!currentTheme) {
            // This case should be rare if initialThemeCheck passed, but good for safety
            console.error(
              `[IPC] Theme with ID ${themeId} was not found when re-fetching for removal operation.`
            );
            return false;
          }

          const processStillInTheme = (currentTheme.processes || []).includes(
            processId
          );
          const persistentProcessStillInTheme = (
            currentTheme.persistentProcesses || []
          ).some(
            (p) =>
              p.executableName.toLowerCase() ===
              persistentId.executableName.toLowerCase()
          );

          if (processStillInTheme || persistentProcessStillInTheme) {
            console.log(
              `[IPC] Attempting to remove running process ${process.name} (${process.id}) and/or its persistent identifier ${persistentId.executableName} from theme ${themeId} as they appear to be present.`
            );

            const result = dataStore.removeProcessAndPersistentFromTheme(
              themeId,
              processId,
              persistentId.executableName
            );

            if (result.processRemoved || result.persistentRemoved) {
              if (result.processRemoved && result.persistentRemoved) {
                console.log(
                  `[IPC] Successfully removed process ${processId} and persistent identifier ${persistentId.executableName} from theme ${themeId}.`
                );
              } else if (result.processRemoved) {
                console.log(
                  `[IPC] Successfully removed process ${processId} from theme ${themeId}. Persistent identifier ${persistentId.executableName} may not have been present or removed.`
                );
              } else {
                // only persistentRemoved
                console.log(
                  `[IPC] Successfully removed persistent identifier ${persistentId.executableName} from theme ${themeId}. Process ${processId} may not have been present or removed.`
                );
              }
              success = true;
            } else {
              // This means DataStore made no changes, implying they weren't there despite our earlier check.
              // This could happen due to an extremely rapid concurrent modification.
              console.log(
                `[IPC] DataStore reported no changes for process ${processId} or persistent identifier ${persistentId.executableName} in theme ${themeId}. Assuming already removed or handled.`
              );
              success = true; // If DataStore confirms they are not there (by making no changes), state is good.
            }
          } else {
            console.log(
              `[IPC] Process ${processId} (${process.name}) and/or its persistent identifier ${persistentId.executableName} are already removed from theme ${themeId} or were never present. No action needed.`
            );
            success = true;
          }
        } else {
          // Process is not running
          console.log(
            `[IPC] Process ${processId} is not running. Attempting to remove its ID from theme ${themeId}.`
          );
          const result = dataStore.removeProcessAndPersistentFromTheme(
            themeId,
            processId,
            undefined
          );
          if (result.processRemoved) {
            console.log(
              `[IPC] Successfully removed process ID ${processId} from theme ${themeId}.`
            );
            success = true;
          } else {
            // If processId was not found in theme.processes
            console.log(
              `[IPC] Process ID ${processId} not found in theme ${themeId}. Assuming already removed or never present.`
            );
            success = true;
          }
        }

        return success;
      } catch (error) {
        console.error(
          `[IPC] Error during remove-process-from-theme for process ${processId}, theme ${themeId}:`,
          error
        );
        return false;
      }
    }
  );
  ipcMain.on(
    "toggle-compact-mode",
    (_, isCompact: boolean, groupCount: number) => {
      // Aktualisiere die globale compactMode Variable
      compactMode = isCompact;

      // Berechne dynamische Breite basierend auf Gruppenanzahl
      let width = 300; // Mindestbreite
      if (isCompact && groupCount > 0) {
        // Pro Gruppe etwa 120px, aber maximal 4 Gruppen pro Zeile
        const groupsPerRow = Math.min(groupCount, 4);
        width = Math.max(300, groupsPerRow * 120 + 80); // 80px für Padding/Margins
      }

      // Neue Fenstergröße für Kompaktmodus
      const newSize = isCompact
        ? { width, height: 120, alwaysOnTop: false }
        : { width: 600, height: 680, alwaysOnTop: false };

      // Fenstereigenschaften anpassen und Übergang berücksichtigen
      if (mainWindow) {
        // Aktiviere/deaktiviere "immer im Vordergrund" sofort
        mainWindow.setAlwaysOnTop(newSize.alwaysOnTop);

        // Verzögere die Größenänderung leicht, damit die CSS-Transition sichtbar ist
        setTimeout(() => {
          if (mainWindow) {
            mainWindow.setSize(newSize.width, newSize.height, true);

            if (isCompact) {
              // Wenn Kompaktmodus aktiviert wird, positioniere das Fenster in der unteren rechten Ecke
              const { width: screenWidth, height: screenHeight } =
                require("electron").screen.getPrimaryDisplay().workAreaSize;
              const xPosition = screenWidth - newSize.width - 20; // 20px Abstand vom Rand
              const yPosition = screenHeight - newSize.height - 20; // 20px Abstand vom Rand

              mainWindow.setPosition(xPosition, yPosition);
            } else {
              // Wenn Vollansicht aktiviert wird, positioniere das Fenster in der Mitte des Bildschirms
              const { width: screenWidth, height: screenHeight } =
                require("electron").screen.getPrimaryDisplay().workAreaSize;
              const xPosition = Math.round((screenWidth - newSize.width) / 2);
              const yPosition = Math.round((screenHeight - newSize.height) / 2);

              mainWindow.setPosition(xPosition, yPosition);
            }
          }
        }, 50); // Kleine Verzögerung für bessere Animation
      }
    }
  );

  // Analytics Handler für App Startup Complete
  ipcMain.handle("track-app-startup-complete", async (_, eventData) => {
    trackEvent("app_startup_complete", eventData);
    return true;
  });

  // Allgemeiner Analytics Handler für alle Events
  ipcMain.handle(
    "track-event",
    async (_, eventName: string, eventData: Record<string, any>) => {
      trackEvent(eventName, eventData);
      return true;
    }
  );

  // Handler für das Abrufen von Usage-Statistiken
  ipcMain.handle("analytics:getUsageStats", async () => {
    const { fetchUsageStats } = require("./main/analytics");
    try {
      const stats = await fetchUsageStats();
      return stats;
    } catch (error) {
      console.error("[IPC] Fehler beim Abrufen der Usage-Statistiken:", error);
      return null;
    }
  });
}

// Beim Beenden der App alle Shortcuts entfernen
app.on("will-quit", () => {
  // Unregister all shortcuts
  globalShortcut.unregisterAll();

  // Shutdown analytics to ensure all events are sent
  shutdownAnalytics();
});

// Funktion zum Aktualisieren der Prozess-IDs eines Themes basierend auf persistenten Identifikatoren
async function updateThemeProcessIds(theme: any): Promise<void> {
  try {
    console.log(
      `[updateThemeProcessIds] Aktualisiere PIDs für Theme ${theme.id}`
    );

    // Hole aktuelle laufende Prozesse
    const runningProcesses = await getRunningApplications();

    // Sammle valide persistente Prozesse und neue Prozess-IDs
    const validPersistentProcesses: PersistentProcessIdentifier[] = [];
    const newProcessIds: number[] = [];

    // Wenn keine persistenten Prozesse vorhanden sind, leere das processes-Array
    if (!theme.persistentProcesses || theme.persistentProcesses.length === 0) {
      console.log(
        `[updateThemeProcessIds] Theme ${theme.id} hat keine persistenten Prozesse - lösche alle Prozess-IDs`
      );
      theme.processes = [];
      dataStore.updateTheme(theme.id, theme);
      return;
    }

    // Für jeden persistenten Prozess prüfen
    for (const persistentProcess of theme.persistentProcesses) {
      const matchingProcess = findMatchingProcess(
        runningProcesses,
        persistentProcess
      );

      if (matchingProcess) {
        console.log(
          `[updateThemeProcessIds] Gefunden: ${matchingProcess.name} (${matchingProcess.id})`
        );
        newProcessIds.push(matchingProcess.id);
        validPersistentProcesses.push(persistentProcess);
      } else {
        console.log(
          `[updateThemeProcessIds] Kein laufender Prozess gefunden für: ${persistentProcess.executableName}`
        );

        // Prüfe, ob die Anwendung startbar ist (Pfad existiert)
        if (persistentProcess.executablePath) {
          try {
            if (fs.existsSync(persistentProcess.executablePath)) {
              console.log(
                `[updateThemeProcessIds] Anwendung ${persistentProcess.executableName} ist startbar - behalte persistenten Prozess bei`
              );
              validPersistentProcesses.push(persistentProcess);
            } else {
              console.log(
                `[updateThemeProcessIds] Anwendung ${persistentProcess.executableName} ist nicht startbar (Pfad nicht gefunden) - entferne persistenten Prozess`
              );
            }
          } catch (error) {
            console.warn(
              `[updateThemeProcessIds] Fehler beim Prüfen des Pfads für ${persistentProcess.executableName}:`,
              error
            );
            // Im Zweifel behalten wir den persistenten Prozess bei
            validPersistentProcesses.push(persistentProcess);
          }
        } else {
          console.log(
            `[updateThemeProcessIds] Kein Pfad für ${persistentProcess.executableName} vorhanden - entferne persistenten Prozess`
          );
        }
      }
    }

    // Prüfe, ob sich etwas geändert hat
    const processesChanged =
      JSON.stringify(theme.processes) !== JSON.stringify(newProcessIds);
    const persistentProcessesChanged =
      theme.persistentProcesses.length !== validPersistentProcesses.length;

    if (processesChanged || persistentProcessesChanged) {
      console.log(`[updateThemeProcessIds] Aktualisiere Theme ${theme.id}:`);
      console.log(
        `[updateThemeProcessIds] - Aktive Prozesse: ${
          newProcessIds.length
        } (vorher: ${theme.processes?.length || 0})`
      );
      console.log(
        `[updateThemeProcessIds] - Persistente Prozesse: ${validPersistentProcesses.length} (vorher: ${theme.persistentProcesses.length})`
      );

      // Aktualisiere beide Arrays
      theme.processes = newProcessIds;
      theme.persistentProcesses = validPersistentProcesses;

      // Theme in der Datenbank aktualisieren
      dataStore.updateTheme(theme.id, theme);
    } else {
      console.log(
        `[updateThemeProcessIds] Keine Änderungen für Theme ${theme.id} erforderlich`
      );
    }
  } catch (error) {
    console.error(
      `[updateThemeProcessIds] Fehler beim Aktualisieren der PIDs für Theme ${theme.id}:`,
      error
    );
  }
}

// Funktion zum Registrieren aller gespeicherten Shortcuts
async function registerSavedShortcuts() {
  try {
    console.log(
      "[Shortcut] Beginne Registrierung aller gespeicherten Shortcuts..."
    );

    // Zuerst alle vorhandenen Shortcuts deregistrieren, um einen sauberen Start zu haben
    globalShortcut.unregisterAll();
    console.log("[Shortcut] Alle vorhandenen Shortcuts wurden deregistriert");

    // Maps leeren, um einen konsistenten Zustand zu gewährleisten
    registeredShortcuts.clear();
    shortcutHandlers.clear();
    console.log("[Shortcut] Shortcut-Maps wurden geleert");

    // Themes laden und Shortcuts registrieren
    const themes = dataStore.getThemes();
    console.log(`[Shortcut] ${themes.length} Themes geladen`);

    // Längere Verzögerung, um sicherzustellen, dass die Anwendung vollständig initialisiert ist
    // und alle Prozesse geladen sind
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Alle Shortcuts in einer Schleife registrieren
    let registeredCount = 0;
    const themesWithShortcuts = themes.filter(
      (t) => t.shortcut && t.shortcut.trim() !== ""
    );

    // Mehrere Registrierungsversuche, falls nötig
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[Shortcut] Registrierungsversuch ${attempt} von 3`);

      // Alle Shortcuts erneut entfernen bei wiederholten Versuchen
      if (attempt > 1) {
        globalShortcut.unregisterAll();
        registeredShortcuts.clear();
        shortcutHandlers.clear();
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Shortcuts sequentiell registrieren
      for (const theme of themesWithShortcuts) {
        console.log(
          `[Shortcut] Registriere Shortcut für Theme ${theme.name} (${theme.id}): ${theme.shortcut}`
        );
        const success = registerThemeShortcut(theme.id, theme.shortcut);
        console.log(
          `[Shortcut] Registrierung für Theme ${theme.name} war ${
            success ? "erfolgreich" : "nicht erfolgreich"
          }`
        );

        if (success) registeredCount++;

        // Kurze Pause zwischen den Registrierungen
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      // Überprüfe, ob alle Shortcuts registriert wurden
      registeredCount = Array.from(registeredShortcuts.keys()).length;
      console.log(
        `[Shortcut] ${registeredCount} von ${themesWithShortcuts.length} Shortcuts wurden registriert`
      );

      // Wenn alle Shortcuts registriert wurden, beende die Schleife
      if (registeredCount === themesWithShortcuts.length) {
        console.log("[Shortcut] Alle Shortcuts wurden erfolgreich registriert");
        // Sende Event an Renderer, dass Shortcuts registriert wurden
        if (mainWindow) {
          mainWindow.webContents.send("shortcuts-registered");
          console.log(
            '[Shortcut] Event "shortcuts-registered" an Renderer gesendet'
          );
        }
        break;
      } else {
        console.warn(
          `[Shortcut] Nicht alle Shortcuts konnten registriert werden (${registeredCount}/${themesWithShortcuts.length}). Versuche es erneut...`
        );
      }
    }

    // Starte einen Hintergrund-Timer, der regelmäßig prüft, ob die Shortcuts noch aktiv sind
    startShortcutWatchdog();

    console.log("[Shortcut] Registrierung aller Shortcuts abgeschlossen");
  } catch (error) {
    console.error(
      "[Shortcut] Fehler bei der Registrierung der gespeicherten Shortcuts:",
      error
    );
  }
}

// Watchdog-Timer, der regelmäßig prüft, ob die Shortcuts noch aktiv sind
let shortcutWatchdogTimer: NodeJS.Timeout | null = null;

function startShortcutWatchdog() {
  // Stoppe einen eventuell laufenden Timer
  if (shortcutWatchdogTimer) {
    clearInterval(shortcutWatchdogTimer);
  }

  console.log("[Shortcut] Starte Shortcut-Watchdog");

  // Starte einen neuen Timer, der alle 30 Sekunden prüft
  shortcutWatchdogTimer = setInterval(() => {
    try {
      const entries = Array.from(registeredShortcuts.entries());
      console.log(`[Shortcut] Watchdog prüft ${entries.length} Shortcuts`);

      for (const [themeId, shortcutKey] of entries) {
        if (!globalShortcut.isRegistered(shortcutKey)) {
          console.warn(
            `[Shortcut] Shortcut ${shortcutKey} für Theme ${themeId} ist nicht mehr registriert! Registriere neu...`
          );

          // Versuche, den Shortcut neu zu registrieren
          const theme = dataStore.getTheme(themeId);
          if (theme && theme.shortcut) {
            registerThemeShortcut(themeId, theme.shortcut);
          }
        }
      }
    } catch (error) {
      console.error("[Shortcut] Fehler im Shortcut-Watchdog:", error);
    }
  }, 30000); // Alle 30 Sekunden prüfen
}

/**
 * Korrigiert die Daten in den Themes, um sicherzustellen, dass alle Prozesse korrekt gespeichert sind
 */
async function fixThemeData() {
  console.log("[Fix] Beginne Korrektur der Theme-Daten...");

  // Alle gespeicherten Themen abrufen
  const themes = dataStore.getThemes();
  let themesUpdated = false;

  // Aktuelle Prozesse abrufen
  const currentProcesses = await getRunningApplications();

  // Für jedes Thema
  for (const theme of themes) {
    let themeUpdated = false;

    // Prüfe, ob Prozess-IDs im applications-Array statt im processes-Array gespeichert sind
    if (theme.applications && theme.applications.length > 0) {
      // Filtere Prozess-IDs (unter 100000) aus applications heraus
      const processIds = theme.applications.filter(
        (id) => typeof id === "number" && id < 100000
      );
      const windowHandles = theme.applications.filter(
        (id) => typeof id === "string" || id >= 100000
      );

      if (processIds.length > 0) {
        console.log(
          `[Fix] Theme ${theme.name}: ${processIds.length} Prozess-IDs vom applications-Array ins processes-Array verschoben`
        );

        // Füge die Prozess-IDs zum processes-Array hinzu (ohne Duplikate)
        for (const processId of processIds) {
          if (!theme.processes.includes(processId)) {
            theme.processes.push(processId);
          }
        }

        // Aktualisiere das applications-Array, um nur Fenster-Handles zu enthalten
        theme.applications = windowHandles;
        themeUpdated = true;
      }
    }

    // Stelle sicher, dass für alle Prozesse persistente Identifikatoren existieren
    if (theme.processes && theme.processes.length > 0) {
      for (const processId of theme.processes) {
        // Finde den Prozess in der Liste der laufenden Prozesse
        const process = currentProcesses.find((p) => p.id === processId);

        if (process) {
          // Prüfe, ob bereits ein persistenter Identifikator für diesen Prozess existiert
          const persistentId = createPersistentIdentifier(process);
          const exists = theme.persistentProcesses.some(
            (p) =>
              p.executableName === persistentId.executableName &&
              (p.executablePath === persistentId.executablePath ||
                !p.executablePath)
          );

          if (!exists) {
            console.log(
              `[Fix] Theme ${theme.name}: Persistenter Identifikator für ${process.name} (${process.id}) hinzugefügt`
            );
            theme.persistentProcesses.push(persistentId);
            themeUpdated = true;
          }
        }
      }
    }

    // Wenn das Theme aktualisiert wurde, speichere es
    if (themeUpdated) {
      dataStore.updateTheme(theme.id, theme);
      themesUpdated = true;
    }
  }

  if (themesUpdated) {
    console.log("[Fix] Theme-Daten wurden korrigiert und gespeichert.");
  }
}

// Protokoll-Handler für switchfast:// registrieren
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Wenn eine andere Instanz bereits läuft, beenden wir diese Instanz
  app.quit();
} else {
  // Wenn eine zweite Instanz gestartet wird und ein URL-Argument übergibt
  app.on("second-instance", (event, commandLine, workingDirectory) => {
    // Jemand hat versucht, eine zweite Instanz zu starten, wir sollten unsere Instanz fokussieren
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      // URL-Argument verarbeiten (für Deep-Links)
      handleDeepLink(commandLine.pop());
    }
  });

  // Protokoll-Handler für macOS
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // Protokoll-Handler für Windows registrieren
  if (process.platform === "win32") {
    // Für Windows-Entwicklung
    app.setAsDefaultProtocolClient("switchfast");
  }
}

/**
 * Verarbeitet Deep-Links wie switchfast://success?session_id=cs_test_xxx&env=test
 */
function handleDeepLink(url: string | undefined) {
  if (!url) return;

  try {
    // URL parsen
    const urlObj = new URL(url);

    // Prüfen, ob es sich um unser Protokoll handelt
    if (urlObj.protocol === "switchfast:") {
      console.log(`[Deep-Link] Verarbeite URL: ${url}`);

      // Payment Success Handler
      if (urlObj.pathname === "//success") {
        const sessionId = urlObj.searchParams.get("session_id");
        const environment = urlObj.searchParams.get("env") || "test";

        if (sessionId) {
          console.log(
            `[Deep-Link] Payment Success mit Session ID: ${sessionId}, Umgebung: ${environment}`
          );

          // Lizenz aktivieren
          if (mainWindow) {
            mainWindow.webContents.send("activate-license-from-session", {
              sessionId,
              environment,
            });
            mainWindow.show();
          }
        }
      }

      // Payment Cancel Handler
      else if (urlObj.pathname === "//payment-cancel") {
        console.log("[Deep-Link] Payment wurde abgebrochen");

        if (mainWindow) {
          mainWindow.webContents.send("payment-cancelled");
          mainWindow.show();
        }
      }
    }
  } catch (error) {
    console.error(
      "[Deep-Link] Fehler bei der Verarbeitung des Deep-Links:",
      error
    );
  }
}

// App bereit-Event
app.whenReady().then(async () => {
  const startupStartTime = Date.now();

  // Initialize analytics
  initAnalytics();

  // Initialize enhanced analytics with rich context
  initEnhancedAnalytics();

  // Setup global error handlers for error tracking
  setupGlobalErrorHandlers();

  // Lizenzsystem initialisieren
  initializeLicenseSystem();

  createWindow();
  setupIpcHandlers();

  // Auto-Updater einrichten
  setupAutoUpdater();

  // Theme-Daten korrigieren
  await fixThemeData();

  // Bestehende Themen mit persistenten Prozessidentifikatoren aktualisieren
  await updateExistingThemesWithPersistentIdentifiers();

  // Prozesszuordnungen wiederherstellen
  await restoreProcessAssociations();

  // Alle Themes mit aktuellen PIDs aktualisieren
  const themes = dataStore.getThemes();
  console.log(`[App] Aktualisiere PIDs für ${themes.length} Themes`);

  for (const theme of themes) {
    await updateThemeProcessIds(theme);
  }

  // Shortcuts erst nach der Wiederherstellung der Prozesse registrieren
  registerSavedShortcuts();

  // Register global shortcut to open DevTools
  globalShortcut.register("CommandOrControl+Shift+I", () => {
    if (mainWindow && !mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.openDevTools();
    }
  });

  // Startup-Zeit wird jetzt im Frontend getrackt wenn Loading Screen verschwindet
  console.log(`[App] Initialisierung abgeschlossen`);

  // PostHog Error Tracking is now working correctly with proper structure

  app.on("activate", () => {
    if (!mainWindow) {
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
                            if (IsWindowVisible(hWnd)) {
                                var builder = new StringBuilder(256);
                                uint processId = 0;

                                if (GetWindowThreadProcessId(hWnd, out processId) != 0) {
                                    Process process;
                                    if (!processCache.TryGetValue(processId, out process)) {
                                        try {
                                            process = Process.GetProcessById((int)processId);
                                            processCache[processId] = process;
                                        } catch {
                                            return true;
                                        }
                                    }

                                    if (GetWindowText(hWnd, builder, 256) > 0) {
                                        string title = builder.ToString().Trim();
                                        
                                        if (!string.IsNullOrEmpty(title) && 
                                            !title.EndsWith(".exe") &&
                                            !title.Contains("Program Manager") &&
                                            !title.Contains("Windows Input Experience") &&
                                            !title.Contains("Microsoft Text Input Application") &&
                                            !title.Contains("Settings") &&
                                            !title.Contains("Windows Shell Experience Host")) {
                                            
                                            var classNameBuilder = new StringBuilder(256);
                                            GetClassName(hWnd, classNameBuilder, 256);
                                            string className = classNameBuilder.ToString();

                                            bool isBrowserWindow = 
                                                className.Contains("Chrome") || 
                                                className.Contains("Mozilla") || 
                                                className.Contains("Brave") ||
                                                process.ProcessName.ToLower().Contains("brave") ||
                                                process.ProcessName.ToLower().Contains("chrome") ||
                                                process.ProcessName.ToLower().Contains("firefox");

                                            IntPtr parentHwnd = GetParent(hWnd);
                                            if (isBrowserWindow || parentHwnd == IntPtr.Zero) {
                                                windows.Add(string.Format("{0}|{1}|{2}", hWnd, processId, title));
                                            }
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

/**
 * Richtet den Auto-Updater ein und prüft auf Updates
 * Hinweis: Vor der Verwendung müssen folgende Pakete installiert werden:
 * npm install electron-updater electron-log
 */
function setupAutoUpdater() {
  // Konfiguriere den Auto-Updater Logger
  if (process.env.NODE_ENV === "development") {
    const log = require("electron-log");
    autoUpdater.logger = log;
    log.transports.file.level = "info";
  }

  // Updater-Events
  autoUpdater.on("checking-for-update", () => {
    sendStatusToWindow("Suche nach Updates...");
  });

  autoUpdater.on("update-available", (info: any) => {
    sendStatusToWindow("Update verfügbar.");
  });

  autoUpdater.on("update-not-available", (info: any) => {
    sendStatusToWindow("App ist aktuell.");
  });

  autoUpdater.on("error", (err: Error) => {
    sendStatusToWindow(`Fehler beim Update: ${err.toString()}`);
  });

  autoUpdater.on(
    "download-progress",
    (progressObj: {
      bytesPerSecond: number;
      percent: number;
      transferred: number;
      total: number;
    }) => {
      const message = `Download-Geschwindigkeit: ${progressObj.bytesPerSecond} - Heruntergeladen: ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
      sendStatusToWindow(message);
    }
  );

  autoUpdater.on("update-downloaded", (info: any) => {
    sendStatusToWindow(
      "Update heruntergeladen. Es wird beim Neustart installiert."
    );

    // Optional: Dialog anzeigen und Neustart anbieten
    const dialogOpts: MessageBoxOptions = {
      type: "info",
      buttons: ["Jetzt neu starten", "Später"],
      title: "Update verfügbar",
      message:
        "Eine neue Version wurde heruntergeladen. Neustart erforderlich, um das Update zu installieren.",
    };

    dialog
      .showMessageBox(dialogOpts)
      .then((returnValue: { response: number }) => {
        if (returnValue.response === 0) autoUpdater.quitAndInstall();
      });
  });

  // Nach Updates suchen
  autoUpdater.checkForUpdatesAndNotify();

  // Periodisch nach Updates suchen (z.B. alle 60 Minuten)
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify();
  }, 60 * 60 * 1000);
}

/**
 * Sendet Update-Status an das Hauptfenster
 */
function sendStatusToWindow(text: string) {
  if (mainWindow) {
    mainWindow.webContents.send("update-message", text);
  }
}

// Die createPersistentIdentifier Funktion wird jetzt aus processUtils importiert

/**
 * Findet einen passenden Prozess anhand eines persistenten Identifikators
 */
function findMatchingProcess(
  processes: ProcessInfo[],
  persistentId: PersistentProcessIdentifier
): ProcessInfo | undefined {
  return processes.find((process) => {
    // Prüfen auf Übereinstimmung des Ausführungspfads (wenn vorhanden)
    if (persistentId.executablePath && process.path) {
      if (
        process.path.toLowerCase() === persistentId.executablePath.toLowerCase()
      ) {
        return true;
      }
    }

    // Prüfen auf Übereinstimmung des Anwendungsnamens
    if (
      process.name.toLowerCase() === persistentId.executableName.toLowerCase()
    ) {
      // Wenn ein Titel-Muster vorhanden ist, auch dieses prüfen
      if (persistentId.titlePattern) {
        return process.title.includes(persistentId.titlePattern);
      }
      return true;
    }

    return false;
  });
}

/**
 * Stellt Prozesszuordnungen nach einem Neustart wieder her und startet fehlende Anwendungen
 */
async function restoreProcessAssociations() {
  // Bereinige zuerst konflikthafte Prozess-IDs (für Browser-Subprozesse)
  dataStore.cleanupConflictingProcessIds();

  // Alle gespeicherten Themen abrufen
  const themes = dataStore.getThemes();

  // Aktuelle Prozesse MIT Windows abrufen (wichtig für restoreWindowHandles)
  const currentProcesses = await getProcessesWithWindows();

  // Window-Handles für Browser-Subprozesse wiederherstellen
  await restoreWindowHandles(themes, currentProcesses);

  // Liste der zu startenden Anwendungen
  const applicationsToStart: PersistentProcessIdentifier[] = [];

  // Für jedes Thema
  themes.forEach((theme) => {
    // Für jeden persistenten Prozessidentifikator im Thema
    if (theme.persistentProcesses && theme.persistentProcesses.length > 0) {
      theme.persistentProcesses.forEach((persistentId) => {
        // Passenden aktuellen Prozess finden
        const matchingProcess = findMatchingProcess(
          currentProcesses,
          persistentId
        );

        if (matchingProcess) {
          // Nur Prozess-ID hinzufügen wenn das Theme keine Window-Handles hat
          if (!theme.windows || theme.windows.length === 0) {
            if (!theme.processes.includes(matchingProcess.id)) {
              theme.processes.push(matchingProcess.id);
              dataStore.updateTheme(theme.id, theme);
            }
          }
        } else {
          // Prüfen, ob die Anwendung gestartet werden kann
          if (persistentId.executablePath) {
            // Prüfen, ob die Anwendung bereits in der Liste der zu startenden Anwendungen ist
            const alreadyInStartList = applicationsToStart.some(
              (app) => app.executablePath === persistentId.executablePath
            );

            if (!alreadyInStartList) {
              applicationsToStart.push(persistentId);
            }
          }
        }
      });
    }
  });

  // Starte die fehlenden Anwendungen
  if (applicationsToStart.length > 0) {
    // Sende Event an den Renderer, dass Anwendungen gestartet werden
    if (mainWindow) {
      mainWindow.webContents.send("apps-starting");
    }

    await startMissingApplications(applicationsToStart);

    // Warte kurz und aktualisiere dann die Prozessliste, um die neuen Prozesse zu erfassen
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Aktualisiere die Prozesszuordnungen mit den neu gestarteten Anwendungen
    await updateProcessAssociations();

    // WICHTIG: Zweiter Restore-Durchlauf für Window-Handles nach dem Browser-Start
    setTimeout(async () => {
      try {
        const themes = dataStore.getThemes();
        const currentProcesses = await getProcessesWithWindows();

        await restoreWindowHandles(themes, currentProcesses);

        // Sende Event an den Renderer, dass Apps gestartet wurden
        if (mainWindow) {
          mainWindow.webContents.send("apps-started");
        }
      } catch (error) {
        console.error(
          "[Restore] Fehler beim zweiten Restore-Durchlauf:",
          error
        );

        // Fallback: Sende Event trotzdem
        if (mainWindow) {
          mainWindow.webContents.send("apps-started");
        }
      }
    }, 3000); // Warte 3 Sekunden auf vollständigen Browser-Start
  } else {
    // WICHTIG: Auch hier zweiter Restore-Durchlauf für den Fall dass Browser bereits läuft
    setTimeout(async () => {
      try {
        const themes = dataStore.getThemes();
        const currentProcesses = await getProcessesWithWindows();

        await restoreWindowHandles(themes, currentProcesses);

        // Sende Event an den Renderer, dass Apps gestartet wurden
        if (mainWindow) {
          mainWindow.webContents.send("apps-started");
        }
      } catch (error) {
        console.error(
          "[Restore] Fehler beim zweiten Restore-Durchlauf (kein App-Start):",
          error
        );

        // Fallback: Sende Event trotzdem
        if (mainWindow) {
          mainWindow.webContents.send("apps-started");
        }
      }
    }, 2000); // Kürzere Wartezeit da Browser schon läuft
  }
}

/**
 * Stellt Window-Handles nach einem Neustart wieder her
 * Basiert auf dem titlePattern der persistenten Prozesse
 */
async function restoreWindowHandles(
  themes: any[],
  currentProcesses: ProcessInfo[]
): Promise<void> {
  console.log("[Restore] Beginne Wiederherstellung der Window-Handles...");
  console.log(
    `[Restore] Gefunden ${currentProcesses.length} aktuelle Prozesse`
  );
  console.log(`[Restore] Zu verarbeitende Themes: ${themes.length}`);

  for (const theme of themes) {
    // Nur Themes mit persistenten Prozessen und existierenden Windows bearbeiten
    if (!theme.persistentProcesses || theme.persistentProcesses.length === 0) {
      continue;
    }

    if (!theme.windows || theme.windows.length === 0) {
      continue;
    }

    // Sammle alle aktuellen Fenster für dieses Theme basierend auf titlePattern
    const newWindows: WindowInfo[] = [];

    theme.persistentProcesses.forEach(
      (persistentProcess: any, index: number) => {
        if (!persistentProcess.titlePattern) {
          return;
        }

        // Finde passende Prozesse für diesen persistenten Prozess
        const matchingProcesses = currentProcesses.filter((process) => {
          const nameMatches =
            process.name.toLowerCase() ===
            persistentProcess.executableName.toLowerCase();
          return nameMatches;
        });

        if (matchingProcesses.length === 0) {
          return;
        }

        // Für jeden passenden Prozess, sammle alle Fenster die dem titlePattern entsprechen
        matchingProcesses.forEach((process, processIndex) => {
          if (process.windows && process.windows.length > 0) {
            process.windows.forEach((window, windowIndex) => {
              // VERBESSERTES TITEL-MATCHING: Berücksichtige Steuerzeichen-Behandlung
              let titleMatches = false;

              // Methode 1: Direkter Vergleich (für normale Titel ohne Steuerzeichen)
              if (window.title.includes(persistentProcess.titlePattern)) {
                titleMatches = true;
              }

              // Methode 2: Konvertiere escaped Steuerzeichen zu echten Steuerzeichen für Vergleich
              if (!titleMatches && persistentProcess.titlePattern) {
                const patternWithRealControlChars =
                  persistentProcess.titlePattern.replace(
                    /\\x([0-9A-Fa-f]{2})/g,
                    (match: string, hex: string) =>
                      String.fromCharCode(parseInt(hex, 16))
                  );

                if (window.title.includes(patternWithRealControlChars)) {
                  titleMatches = true;
                }
              }

              if (titleMatches) {
                newWindows.push({
                  hwnd: window.hwnd,
                  processId: window.processId,
                  title: window.title,
                });
              }
            });
          }
        });
      }
    );

    // Aktualisiere die Window-Handles für dieses Theme
    if (newWindows.length > 0) {
      // Entferne alle alten Window-Handles aus dem applications Array
      if (theme.windows && theme.windows.length > 0) {
        theme.windows.forEach((oldWindow: WindowInfo) => {
          const appIndex = theme.applications.indexOf(oldWindow.hwnd);
          if (appIndex >= 0) {
            theme.applications.splice(appIndex, 1);
          }
        });
      }

      // Setze die neuen Window-Handles
      theme.windows = newWindows;

      // Füge alle neuen Window-Handles zum applications Array hinzu
      newWindows.forEach((newWindow) => {
        if (!theme.applications.includes(newWindow.hwnd)) {
          theme.applications.push(newWindow.hwnd);
        }
      });

      // KORREKTUR: NUR die Prozess-IDs entfernen, die WIRKLICH zu den gefundenen Window-Handles gehören
      // Das verhindert, dass andere Browser-Prozesse fälschlicherweise als Fallback verwendet werden
      const processIdsToRemove = newWindows.map((w: WindowInfo) => w.processId);
      const originalProcessCount = theme.processes.length;

      // Entferne NUR die Prozess-IDs, die zu den neu gefundenen Window-Handles gehören
      theme.processes = theme.processes.filter(
        (pid: number) => !processIdsToRemove.includes(pid)
      );

      const removedProcessCount = originalProcessCount - theme.processes.length;
      console.log(
        `[Restore] ${removedProcessCount} Prozess-IDs aus Theme "${theme.name}" entfernt, da spezifische Window-Handles verwendet werden`
      );

      // Speichere die Änderungen
      dataStore.updateTheme(theme.id, theme);
    } else {
      console.log(
        `[Restore] Keine neuen Window-Handles für Theme "${theme.name}" gefunden`
      );

      // WICHTIG: Wenn keine Window-Handles gefunden werden, behalte die ursprüngliche Struktur bei
      // Entferne NICHT das processes Array - das wäre ein Fallback für den Fall dass Window-Handles nicht verfügbar sind
      console.log(
        `[Restore] Theme "${theme.name}" behält ursprüngliche Prozess-Zuordnungen als Fallback`
      );
    }
  }
}

/**
 * Startet fehlende Anwendungen anhand ihrer Pfade
 */
async function startMissingApplications(
  applications: PersistentProcessIdentifier[]
): Promise<void> {
  // Starte jede Anwendung
  for (const app of applications) {
    if (app.executablePath) {
      try {
        // Prüfe, ob die Datei existiert
        const fs = require("fs");
        const exists = fs.existsSync(app.executablePath);

        if (!exists) {
          // Hier könnte man eine Suche nach der Anwendung implementieren
          // Zum Beispiel für bekannte Browser und Anwendungen
          let alternativePath = null;

          if (app.executableName.toLowerCase() === "perplexity") {
            // Versuche, Perplexity im Standardpfad zu finden
            const possiblePaths = [
              `${process.env.LOCALAPPDATA}\Programs\Perplexity\Perplexity.exe`,
              `${process.env.PROGRAMFILES}\Perplexity\Perplexity.exe`,
              `${process.env["PROGRAMFILES(X86)"]}\Perplexity\Perplexity.exe`,
            ];

            for (const path of possiblePaths) {
              if (fs.existsSync(path)) {
                alternativePath = path;
                break;
              }
            }
          } else if (app.executableName.toLowerCase().includes("chatgpt")) {
            // Versuche, ChatGPT im Standardpfad zu finden
            const possiblePaths = [
              `${process.env.LOCALAPPDATA}\Programs\ChatGPT\ChatGPT.exe`,
              `${process.env.PROGRAMFILES}\ChatGPT\ChatGPT.exe`,
              `${process.env["PROGRAMFILES(X86)"]}\ChatGPT\ChatGPT.exe`,
            ];

            for (const path of possiblePaths) {
              if (fs.existsSync(path)) {
                alternativePath = path;
                break;
              }
            }
          }

          if (alternativePath) {
            await startApplication(alternativePath);
          }
        } else {
          // Starte die Anwendung
          await startApplication(app.executablePath);
        }

        // Kurze Pause zwischen dem Starten von Anwendungen, um System nicht zu überlasten
        await new Promise((resolve) => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(
          `[Restore] Fehler beim Starten von ${app.executableName}:`,
          error
        );
      }
    }
  }
}

/**
 * Startet eine Anwendung mit dem angegebenen Pfad
 */
async function startApplication(executablePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      // Verwende child_process.spawn, um die Anwendung zu starten (besser für mehrere Prozesse)
      const { spawn } = require("child_process");

      // Unter Windows müssen wir cmd.exe verwenden, um den start-Befehl auszuführen
      // Der /c Parameter bedeutet, dass cmd nach Ausführung des Befehls beendet wird
      // Der /b Parameter für start bedeutet, dass kein neues Fenster geöffnet wird
      const childProcess = spawn(
        "cmd.exe",
        ["/c", "start", "/b", '""', executablePath],
        {
          detached: true, // Prozess vom Elternprozess trennen
          stdio: "ignore", // Keine Ein-/Ausgabe-Streams
          windowsHide: true, // Kein Konsolenfenster anzeigen
        }
      );

      // Wir warten nicht auf das Ende des Prozesses, da wir ihn im Hintergrund laufen lassen wollen
      childProcess.unref();

      // Kurze Verzögerung, um sicherzustellen, dass der Prozess gestartet wird
      setTimeout(() => {
        resolve();
      }, 500);
    } catch (error) {
      console.error(
        `[Restore] Unerwarteter Fehler beim Starten von ${executablePath}:`,
        error
      );
      reject(error);
    }
  });
}

/**
 * Aktualisiert die Prozesszuordnungen nach dem Starten neuer Anwendungen
 */
async function updateProcessAssociations(): Promise<void> {
  // Alle gespeicherten Themen abrufen
  const themes = dataStore.getThemes();

  // Aktuelle Prozesse MIT Windows abrufen (wichtig für titlePattern-Matching)
  const currentProcesses = await getProcessesWithWindows();

  // Sammle alle neu gestarteten Prozesse und ihre potentiellen Theme-Matches
  const processThemeMatches = new Map<
    number,
    Array<{ themeId: string; score: number }>
  >();

  // Für jedes Thema
  themes.forEach((theme) => {
    // Für jeden persistenten Prozessidentifikator im Thema
    if (theme.persistentProcesses && theme.persistentProcesses.length > 0) {
      theme.persistentProcesses.forEach((persistentId) => {
        // Passenden aktuellen Prozess finden
        const matchingProcess = findMatchingProcess(
          currentProcesses,
          persistentId
        );

        if (matchingProcess && !theme.processes.includes(matchingProcess.id)) {
          // Berechne Match-Score basierend auf titlePattern
          let matchScore = 1; // Basis-Score für Executable-Match

          // Bonus-Score für titlePattern-Match
          if (
            persistentId.titlePattern &&
            matchingProcess.windows &&
            matchingProcess.windows.length > 0
          ) {
            const hasMatchingWindow = matchingProcess.windows.some((window) =>
              window.title.includes(persistentId.titlePattern!)
            );
            if (hasMatchingWindow) {
              matchScore += 10; // Höherer Score für titlePattern-Match
            }
          }

          // Füge Match zur Map hinzu
          if (!processThemeMatches.has(matchingProcess.id)) {
            processThemeMatches.set(matchingProcess.id, []);
          }
          processThemeMatches.get(matchingProcess.id)!.push({
            themeId: theme.id,
            score: matchScore,
          });
        }
      });
    }
  });

  // Verarbeite jeden Prozess und weise ihn dem Theme mit dem höchsten Score zu
  for (const [processId, matches] of processThemeMatches.entries()) {
    if (matches.length === 0) continue;

    // Sortiere nach Score (höchster zuerst)
    matches.sort((a, b) => b.score - a.score);

    const bestMatch = matches[0];
    const matchingProcess = currentProcesses.find((p) => p.id === processId);

    if (matchingProcess) {
      // Finde das entsprechende Theme
      const theme = themes.find((t) => t.id === bestMatch.themeId);
      if (theme) {
        // Füge den Prozess nur zu diesem einen Theme hinzu
        theme.processes.push(processId);
        dataStore.updateTheme(theme.id, theme);
      }
    }
  }
}

/**
 * Aktualisiert bestehende Themen mit persistenten Prozessidentifikatoren
 * Diese Funktion wird einmalig beim Start ausgeführt, um sicherzustellen, dass alle Themen
 * persistente Prozessidentifikatoren für ihre Prozesse haben
 */
async function updateExistingThemesWithPersistentIdentifiers(): Promise<void> {
  try {
    // Alle gespeicherten Themen abrufen
    const themes = dataStore.getThemes();

    // Wenn keine Themen vorhanden sind, gibt es nichts zu tun
    if (themes.length === 0) {
      return;
    }

    // Aktuelle Prozesse abrufen
    const currentProcesses = await getRunningApplications();

    // Sammle alle Informationen über Prozesse aus allen Themen
    const processInfoMap = new Map<number, ProcessInfo>();
    for (const process of currentProcesses) {
      processInfoMap.set(process.id, process);
    }

    let themesUpdated = 0;
    let processesWithPersistentIds = 0;

    // Für jedes Thema
    for (const theme of themes) {
      let themeUpdated = false;

      // Initialisiere persistentProcesses, falls nicht vorhanden
      if (!theme.persistentProcesses) {
        theme.persistentProcesses = [];
        themeUpdated = true; // Markiere als aktualisiert, damit es gespeichert wird
      }

      // Initialisiere processes, falls nicht vorhanden
      if (!theme.processes) {
        theme.processes = [];
        themeUpdated = true; // Markiere als aktualisiert, damit es gespeichert wird
      }

      // Sammle alle Prozess-IDs aus applications und processes
      const allProcessIds = new Set<number>();

      // Füge Prozess-IDs aus processes hinzu
      if (theme.processes && theme.processes.length > 0) {
        theme.processes.forEach((pid) => allProcessIds.add(pid));
      }

      // Füge Prozess-IDs aus applications hinzu (nur numerische IDs, keine Fenster-Handles)
      if (theme.applications && theme.applications.length > 0) {
        theme.applications.forEach((appId) => {
          const numId = typeof appId === "string" ? parseInt(appId, 10) : appId;
          // Fenster-Handles sind typischerweise sehr große Zahlen, wir filtern sie heraus
          if (numId < 100000) {
            allProcessIds.add(numId);
            // Auch zum processes-Array hinzufügen, falls noch nicht vorhanden
            if (!theme.processes.includes(numId)) {
              theme.processes.push(numId);
              themeUpdated = true;
            }
          }
        });
      }

      // Für jeden Prozess im Thema
      if (allProcessIds.size > 0) {
        // Speichere die aktuellen Prozess-IDs, um später nicht mehr existierende zu entfernen
        const validProcessIds = [];

        for (const processId of allProcessIds) {
          // Finde den Prozess in der Liste der laufenden Prozesse
          const process = processInfoMap.get(processId);

          if (process) {
            validProcessIds.push(processId);

            // Erstelle einen persistenten Identifikator für den Prozess
            const persistentId = createPersistentIdentifier(process);

            // Prüfe, ob der persistente Identifikator bereits existiert
            const exists = theme.persistentProcesses.some(
              (p) => p.executableName === persistentId.executableName
            );

            if (!exists) {
              theme.persistentProcesses.push(persistentId);
              themeUpdated = true;
              processesWithPersistentIds++;
            }
          }
          // Wir behalten den Prozess bei, auch wenn er nicht mehr läuft
        }
      }

      // Speichere das aktualisierte Thema
      if (themeUpdated) {
        dataStore.updateTheme(theme.id, theme);
        themesUpdated++;
      }
    }

    // Erzwinge das Speichern aller Themen, auch wenn keine Änderungen vorgenommen wurden
    // Dies stellt sicher, dass die persistentProcesses und processes Arrays in der JSON-Datei gespeichert werden
    dataStore.setThemes(themes);
  } catch (error) {
    console.error(
      "[Init] Fehler bei der Aktualisierung der Themen mit persistenten Prozessidentifikatoren:",
      error
    );
  }
}
