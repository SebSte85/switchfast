import { exec } from "child_process";
import { BrowserWindow } from "electron";
import { ProcessInfo } from "./types";

/**
 * Ruft alle laufenden Anwendungen über PowerShell ab
 */
export const getRunningApplications = (): Promise<ProcessInfo[]> => {
  return new Promise((resolve, reject) => {
    // PowerShell-Befehl, um laufende Prozesse mit Fenstertiteln abzurufen
    const command = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      using System.Text;
      
      public class WindowInfo {
        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc enumFunc, IntPtr lParam);
        
        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);
        
        [DllImport("user32.dll")]
        public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
        
        [DllImport("user32.dll")]
        public static extern int GetWindowTextLength(IntPtr hWnd);
        
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
      }
"@
      
      $apps = @();
      
      [WindowInfo]::EnumWindows(
        {
          param($hwnd, $lparam)
          
          if ([WindowInfo]::IsWindowVisible($hwnd)) {
            $length = [WindowInfo]::GetWindowTextLength($hwnd)
            
            if ($length -gt 0) {
              $sb = New-Object System.Text.StringBuilder($length + 1)
              $res = [WindowInfo]::GetWindowText($hwnd, $sb, $sb.Capacity)
              
              $processId = 0
              [void][WindowInfo]::GetWindowThreadProcessId($hwnd, [ref]$processId)
              
              try {
                $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
                
                if ($process -ne $null) {
                  $apps += [PSCustomObject]@{
                    Id = $processId
                    Name = $process.ProcessName
                    Title = $sb.ToString()
                    Path = $process.Path
                  }
                }
              } catch {}
            }
          }
          
          return $true
        }, 
        [IntPtr]::Zero
      ) | Out-Null
      
      # Doppelte Einträge entfernen und nach Name sortieren
      $apps = $apps | Sort-Object -Property Name, Title -Unique
      
      # Als JSON ausgeben
      $apps | ConvertTo-Json
    `;

    // PowerShell-Befehl ausführen
    exec(
      `powershell -Command "${command}"`,
      { maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          console.error(
            `Fehler beim Ausführen von PowerShell: ${error.message}`
          );
          console.error(`stderr: ${stderr}`);
          // Fallback auf Electron-Fenster zurückgeben
          resolve(getElectronWindows());
          return;
        }

        try {
          const processes = JSON.parse(stdout);
          // Umwandeln in unser ProcessInfo-Format
          const result: ProcessInfo[] = processes.map((proc: any) => ({
            id: proc.Id,
            name: proc.Name,
            title: proc.Title,
            path: proc.Path,
          }));
          resolve(result);
        } catch (parseError) {
          console.error(
            "Fehler beim Parsen der PowerShell-Ausgabe:",
            parseError
          );
          // Fallback auf Electron-Fenster zurückgeben
          resolve(getElectronWindows());
        }
      }
    );
  });
};

/**
 * Fallback: Gibt alle Electron-Fenster zurück
 */
const getElectronWindows = (): ProcessInfo[] => {
  const windows = BrowserWindow.getAllWindows();
  return windows.map((win) => ({
    id: win.webContents.getOSProcessId(),
    name: "Electron",
    title: win.getTitle(),
  }));
};

/**
 * Minimiert eine Anwendung über PowerShell
 */
export const minimizeApplication = (processId: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const command = `
      Add-Type @"
      using System;
      using System.Runtime.InteropServices;
      
      public class WindowManager {
        [DllImport("user32.dll")]
        public static extern bool EnumWindows(EnumWindowsProc enumFunc, IntPtr lParam);
        
        [DllImport("user32.dll")]
        public static extern bool IsWindowVisible(IntPtr hWnd);
        
        [DllImport("user32.dll")]
        public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
        
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
        
        public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        
        public const int SW_MINIMIZE = 6;
      }
"@
      
      $minimized = $false
      
      [WindowManager]::EnumWindows(
        {
          param($hwnd, $lparam)
          
          if ([WindowManager]::IsWindowVisible($hwnd)) {
            $processId = 0
            [void][WindowManager]::GetWindowThreadProcessId($hwnd, [ref]$processId)
            
            if ($processId -eq ${processId}) {
              [WindowManager]::ShowWindow($hwnd, [WindowManager]::SW_MINIMIZE)
              $minimized = $true
            }
          }
          
          return $true
        }, 
        [IntPtr]::Zero
      ) | Out-Null
      
      $minimized
    `;

    exec(`powershell -Command "${command}"`, (error, stdout, stderr) => {
      if (error) {
        console.error(`Fehler beim Minimieren des Prozesses: ${error.message}`);
        console.error(`stderr: ${stderr}`);
        resolve(false);
        return;
      }

      // PowerShell gibt "True" oder "False" zurück
      resolve(stdout.trim().toLowerCase() === "true");
    });
  });
};

/**
 * Minimiert mehrere Anwendungen gleichzeitig
 */
export const minimizeApplications = async (
  processIds: number[]
): Promise<boolean> => {
  const results = await Promise.all(
    processIds.map((id) => minimizeApplication(id))
  );
  return results.every((result) => result === true);
};
