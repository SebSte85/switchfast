import { app, BrowserWindow } from 'electron';
import { initLicenseSystem, isAppAllowedToRun, disposeLicenseSystem } from './licensing';

/**
 * Initialisiert das Lizenzsystem und integriert es in den Electron-Lebenszyklus
 */
export function initializeLicenseSystem() {
  // Lizenzsystem initialisieren
  initLicenseSystem();

  // Vor dem Erstellen des Hauptfensters prüfen, ob die App ausgeführt werden darf
  app.on('ready', async () => {
    try {
      const allowed = await isAppAllowedToRun();
      
      if (!allowed) {
        // Wenn die App nicht ausgeführt werden darf, zeigen wir ein Lizenzfenster an
        createLicenseWindow();
      } else {
        // Andernfalls kann die App normal starten
        // Hier würde normalerweise createMainWindow() aufgerufen werden
      }
    } catch (error) {
      console.error('Fehler bei der Lizenzprüfung:', error);
      // Im Fehlerfall erlauben wir die Ausführung der App, um Probleme zu vermeiden
      // Hier würde normalerweise createMainWindow() aufgerufen werden
    }
  });

  // Lizenzsystem bereinigen, wenn die App beendet wird
  app.on('will-quit', () => {
    disposeLicenseSystem();
  });
}

/**
 * Erstellt ein Fenster für die Lizenzaktivierung
 */
function createLicenseWindow() {
  const licenseWindow = new BrowserWindow({
    width: 600,
    height: 500,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    resizable: false,
    title: 'SwitchFast - Lizenzaktivierung'
  });

  // Hier würde normalerweise die Lizenzseite geladen werden
  // licenseWindow.loadURL(`file://${__dirname}/../renderer/license.html`);
  // oder
  // licenseWindow.loadURL('http://localhost:3000/license');
}
