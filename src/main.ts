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
  parentId?: number;
  children?: ProcessInfo[];
}

const registeredShortcuts: Map<string, string> = new Map();
let compactMode = false; // Zustand für den Kompaktmodus

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
    console.log("==========================================");
    console.log(`SHORTCUT REGISTRIERUNG: ${shortcut} für Theme ${themeId}`);

    // Wenn bereits ein Shortcut für dieses Theme existiert, entferne ihn zuerst
    if (registeredShortcuts.has(themeId)) {
      const oldShortcut = registeredShortcuts.get(themeId);
      console.log(
        `Entferne alten Shortcut ${oldShortcut} für Theme ${themeId}`
      );
      if (oldShortcut) {
        try {
          globalShortcut.unregister(oldShortcut);
          console.log(`Alter Shortcut ${oldShortcut} erfolgreich entfernt`);
        } catch (err) {
          console.error(`Fehler beim Entfernen des alten Shortcuts:`, err);
        }
      }
    }

    // Prüfe, ob der Shortcut gültig ist
    if (!shortcut || shortcut.trim() === "") {
      console.error("Shortcut ist leer oder ungültig:", shortcut);
      return false;
    }

    const formattedShortcut = formatShortcutForElectron(shortcut);
    console.log(`Formatierter Shortcut für Electron: ${formattedShortcut}`);

    // Überprüfen, ob Shortcut bereits registriert ist
    if (globalShortcut.isRegistered(formattedShortcut)) {
      console.log(
        `Shortcut ${formattedShortcut} ist bereits registriert, wird entfernt`
      );
      globalShortcut.unregister(formattedShortcut);
    }

    // Registriere den neuen Shortcut
    const success = globalShortcut.register(formattedShortcut, () => {
      console.log(
        `Shortcut ${formattedShortcut} für Theme ${themeId} wurde ausgelöst!`
      );

      if (!mainWindow) {
        console.error("Hauptfenster nicht gefunden, kann Event nicht senden!");
        return;
      }

      // Sende Benachrichtigung an Renderer
      console.log(
        `Sende activate-theme-and-minimize Event für Theme ${themeId} an Renderer...`
      );
      try {
        mainWindow.webContents.send("activate-theme-and-minimize", themeId);
        console.log("Event erfolgreich gesendet");
      } catch (err) {
        console.error("Fehler beim Senden des Events:", err);
      }
    });

    if (!success) {
      console.error(`Konnte Shortcut ${formattedShortcut} nicht registrieren!`);
      return false;
    }

    // Speichere den registrierten Shortcut
    registeredShortcuts.set(themeId, formattedShortcut);
    console.log(
      `Shortcut ${formattedShortcut} für Theme ${themeId} erfolgreich registriert`
    );
    console.log(
      "Aktuelle registrierte Shortcuts:",
      Object.fromEntries(registeredShortcuts)
    );
    console.log("==========================================");
    return true;
  } catch (error) {
    console.error(`Fehler beim Registrieren des Shortcuts ${shortcut}:`, error);
    return false;
  }
}

// Funktion zum Konvertieren des Shortcut-Formats für Electron
function formatShortcutForElectron(shortcut: string): string {
  // Electron verwendet leicht andere Formate für Tastenkombinationen
  // z.B.: "Ctrl+Alt+S" -> "CommandOrControl+Alt+S"
  let formatted = shortcut;

  // Ctrl zu CommandOrControl für plattformübergreifende Kompatibilität
  if (formatted.includes("Ctrl+")) {
    formatted = formatted.replace("Ctrl+", "CommandOrControl+");
  }

  // Sicherstellen, dass Modifier-Keys korrekt formatiert sind
  formatted = formatted
    .replace(/\s+/g, "") // Leerzeichen entfernen
    .replace(/\+\+/g, "+"); // Doppelte + entfernen

  console.log(`Shortcut konvertiert: "${shortcut}" -> "${formatted}"`);
  return formatted;
}

function unregisterThemeShortcut(themeId: string): boolean {
  try {
    console.log("==========================================");
    console.log(`SHORTCUT DEREGISTRIERUNG für Theme ${themeId}`);

    if (registeredShortcuts.has(themeId)) {
      const shortcut = registeredShortcuts.get(themeId);
      if (shortcut) {
        console.log(`Entferne Shortcut ${shortcut} für Theme ${themeId}`);
        try {
          globalShortcut.unregister(shortcut);
          console.log(`Shortcut ${shortcut} erfolgreich entfernt`);
          registeredShortcuts.delete(themeId);
          console.log(
            "Aktuelle registrierte Shortcuts:",
            Object.fromEntries(registeredShortcuts)
          );
        } catch (err) {
          console.error(
            `Fehler beim Entfernen des Shortcuts ${shortcut}:`,
            err
          );
          return false;
        }
      }
    } else {
      console.log(`Kein registrierter Shortcut für Theme ${themeId} gefunden`);
    }
    console.log("==========================================");
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
 * Ruft alle laufenden Anwendungen mit ihren Fenstertiteln ab
 */
async function getRunningApplications(): Promise<ProcessInfo[]> {
  try {
    // Wir verwenden einen PowerShell-Befehl, um Prozesse hierarchisch abzurufen
    const command = `
      $processes = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CommandLine;
      $results = @();
      
      foreach ($p in $processes) {
        # Fenstertitel abrufen (wenn vorhanden)
        $title = "";
        
        # Nur für Prozesse, die ein Fenster haben könnten
        $process = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue;
        if ($process -and $process.MainWindowHandle -ne 0) {
          $title = $process.MainWindowTitle;
          
          # Falls kein Titel vorhanden ist, Prozessnamen verwenden
          if (-not $title) {
            $title = $p.Name;
          }
          
          # Prozess in die Ergebnisse einfügen
          $results += [PSCustomObject]@{
            Id = $p.ProcessId;
            ParentId = $p.ParentProcessId;
            Name = $p.Name;
            Title = $title;
            CommandLine = $p.CommandLine;
          }
        }
      }
      
      # Als JSON ausgeben
      $results | ConvertTo-Json
    `;

    // PowerShell-Befehl ausführen und Ausgabe verarbeiten
    const stdout = await runPowerShellCommand(command);

    if (!stdout || stdout.trim() === "") {
      console.error("PowerShell-Ausgabe ist leer, verwende Mock-Daten");
      return getMockApplications();
    }

    // JSON-Ausgabe parsen
    const processData = JSON.parse(stdout);

    // Prozesse mit IDs, Namen und Titeln extrahieren
    const flatProcesses: ProcessInfo[] = processData.map((proc: any) => ({
      id: proc.Id,
      parentId: proc.ParentId,
      name: formatAppName(proc.Name.toLowerCase().replace(".exe", "")),
      title: proc.Title || proc.Name,
      path: proc.CommandLine,
    }));

    // Baum aus Prozessen erstellen
    const processTree = buildProcessTree(flatProcesses);

    // Nach Namen sortieren
    processTree.sort((a, b) => a.name.localeCompare(b.name));

    console.log(`${processTree.length} Desktop-Anwendungen gefunden`);

    return processTree;
  } catch (error) {
    console.error("Fehler beim Abrufen der laufenden Anwendungen:", error);
    return getMockApplications();
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
 * Minimiert alle Fenster außer die angegebenen Apps und stellt diese wieder her
 */
async function showDesktopExceptApps(
  appIdsToProtect: number[]
): Promise<boolean> {
  try {
    // Füge die Process ID unserer Electron App hinzu
    const ourProcessId = process.pid;
    const protectedIds = [...appIdsToProtect, ourProcessId];

    console.log(
      `Minimiere alle Fenster außer Apps: ${protectedIds.join(
        ", "
      )} (inkl. unserer App ${ourProcessId})`
    );

    // PowerShell-Skript, das alle Fenster minimiert außer die angegebenen
    const psScript = `
      Add-Type @"
        using System;
        using System.Runtime.InteropServices;
        public class Win32 {
          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
          
          [DllImport("user32.dll")]
          [return: MarshalAs(UnmanagedType.Bool)]
          public static extern bool IsWindowVisible(IntPtr hWnd);

          [DllImport("user32.dll")]
          public static extern bool SetForegroundWindow(IntPtr hWnd);

          [DllImport("user32.dll")]
          public static extern bool BringWindowToTop(IntPtr hWnd);

          [DllImport("user32.dll")]
          public static extern bool SwitchToThisWindow(IntPtr hWnd, bool fAltTab);
        }
"@

      # Hole alle Fenster
      $windows = Get-Process | Where-Object {$_.MainWindowHandle -ne 0} | ForEach-Object {
        @{
          Id = $_.Id
          Handle = $_.MainWindowHandle
          Title = $_.MainWindowTitle
        }
      }

      # IDs der zu schützenden Apps
      $protectedIds = @(${protectedIds.join(",")})

      # Minimiere zuerst alle nicht geschützten Fenster (SW_MINIMIZE = 6)
      $windows | Where-Object { $protectedIds -notcontains $_.Id } | ForEach-Object {
        Write-Host "Minimiere Fenster: $($_.Title) (ID: $($_.Id))"
        [Win32]::ShowWindow($_.Handle, 6)
      }

      # Warte kurz, damit Windows Zeit hat, die Fenster zu minimieren
      Start-Sleep -Milliseconds 100

      # Stelle geschützte Fenster wieder her und bringe sie in den Vordergrund
      $windows | Where-Object { $protectedIds -contains $_.Id } | ForEach-Object {
        Write-Host "Aktiviere Fenster: $($_.Title) (ID: $($_.Id))"
        
        # Stelle sicher, dass das Fenster nicht minimiert ist (SW_RESTORE = 9)
        [Win32]::ShowWindow($_.Handle, 9)
        
        # Bringe das Fenster in den Vordergrund
        [Win32]::SetForegroundWindow($_.Handle)
        [Win32]::BringWindowToTop($_.Handle)
        [Win32]::SwitchToThisWindow($_.Handle, $true)
        
        # Warte kurz zwischen den Fenstern
        Start-Sleep -Milliseconds 50
      }
    `;

    const result = await runPowerShellCommand(psScript);
    console.log("PowerShell-Skript ausgeführt:", result);
    return true;
  } catch (error) {
    console.error("Fehler beim Ausführen des PowerShell-Skripts:", error);
    return false;
  }
}

// Hilfsfunktion zum Ausführen von PowerShell-Befehlen
function runPowerShellCommand(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Erstelle temporäre Datei mit UTF-8 Encoding
    const tempFilePath = path.join(os.tmpdir(), `ps-script-${Date.now()}.ps1`);
    fs.writeFileSync(tempFilePath, script, { encoding: "utf8" });

    // Führe PowerShell-Skript aus
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", tempFilePath],
      { encoding: "utf8" },
      (error, stdout, stderr) => {
        // Lösche temporäre Datei
        try {
          fs.unlinkSync(tempFilePath);
        } catch (e) {
          console.warn("Konnte temporäre Datei nicht löschen:", e);
        }

        if (error) {
          reject(new Error(`PowerShell error: ${error.message}\n${stderr}`));
          return;
        }

        resolve(stdout);
      }
    );
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

  // Add window control handlers
  ipcMain.on("minimize-window", () => {
    if (mainWindow) mainWindow.minimize();
  });

  ipcMain.on("close-window", () => {
    if (mainWindow) mainWindow.close();
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

// Toggle zwischen Kompakt- und Normalansicht
ipcMain.on("toggle-compact-mode", (_, isCompact, groupCount) => {
  console.log(
    `Ändere zu ${
      isCompact ? "Kompakt" : "Normal"
    }-Modus (Gruppen: ${groupCount})`
  );

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

  console.log(`Neue Fenstergröße: ${JSON.stringify(newSize)}`);

  // Fenstereigenschaften anpassen und Übergang berücksichtigen
  if (mainWindow) {
    // Aktiviere/deaktiviere "immer im Vordergrund" sofort
    mainWindow.setAlwaysOnTop(newSize.alwaysOnTop);

    // Verzögere die Größenänderung leicht, damit die CSS-Transition sichtbar ist
    setTimeout(() => {
      mainWindow?.setSize(newSize.width, newSize.height, true);
    }, 50); // Kleine Verzögerung für bessere Animation
  }
});
