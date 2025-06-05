# SwitchFast Lizenzsystem - Integrationsanleitung

Diese Anleitung beschreibt, wie Sie das Lizenzsystem in Ihre SwitchFast Electron-App integrieren.

## Voraussetzungen

- Electron-App-Projekt
- Node.js und npm
- Bereitgestellte Edge Functions in Supabase (siehe DEPLOYMENT.md)

## Installation der Abhängigkeiten

Installieren Sie die erforderlichen Abhängigkeiten:

```bash
npm install electron-store node-machine-id crypto axios
```

Für die React-Komponenten (falls Sie React verwenden):

```bash
npm install react react-dom
```

## Integration in den Main-Prozess

### 1. LicenseManager einrichten

1. Kopieren Sie den `licensing`-Ordner in das `src/main`-Verzeichnis Ihrer App.
2. Stellen Sie sicher, dass die Umgebungsvariablen korrekt konfiguriert sind.

### 2. Initialisierung im Hauptprozess

Fügen Sie die folgende Initialisierung in Ihre Hauptdatei (z.B. `main.js` oder `index.js`) ein:

```typescript
import { app, BrowserWindow } from 'electron';
import { initLicenseSystem, isAppAllowedToRun } from './licensing';

// Lizenzsystem initialisieren
const licenseManager = initLicenseSystem();

// App starten
app.whenReady().then(async () => {
  try {
    // Prüfen, ob die App ausgeführt werden darf
    const allowed = await isAppAllowedToRun();
    
    if (allowed) {
      createMainWindow();
    } else {
      createLicenseWindow();
    }
  } catch (error) {
    console.error('Fehler bei der Lizenzprüfung:', error);
    // Im Fehlerfall trotzdem starten
    createMainWindow();
  }
});

// Hauptfenster erstellen
function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  
  mainWindow.loadFile('index.html');
  // oder für eine Entwicklungsumgebung:
  // mainWindow.loadURL('http://localhost:3000');
}

// Lizenzfenster erstellen
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
  
  licenseWindow.loadFile('license.html');
  // oder für eine Entwicklungsumgebung:
  // licenseWindow.loadURL('http://localhost:3000/license');
}

// App beenden, wenn alle Fenster geschlossen sind
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Aufräumen beim Beenden
app.on('will-quit', () => {
  // Lizenzsystem bereinigen
  if (licenseManager) {
    licenseManager.dispose();
  }
});
```

## Integration in den Renderer-Prozess

### 1. React-Komponenten einrichten

1. Kopieren Sie den `licensing`-Ordner aus `src/renderer/components` in Ihr Projekt.
2. Kopieren Sie den `hooks`-Ordner mit `useLicense.ts` in Ihr Projekt.

### 2. LicenseCheck-Komponente verwenden

Umschließen Sie Ihre Hauptanwendung mit der `LicenseCheck`-Komponente:

```tsx
import React from 'react';
import ReactDOM from 'react-dom';
import App from './App';
import LicenseCheck from './components/licensing/LicenseCheck';

ReactDOM.render(
  <React.StrictMode>
    <LicenseCheck>
      <App />
    </LicenseCheck>
  </React.StrictMode>,
  document.getElementById('root')
);
```

### 3. Lizenzseite einrichten

Erstellen Sie eine Route oder eine separate HTML-Datei für die Lizenzseite:

```tsx
import React from 'react';
import ReactDOM from 'react-dom';
import LicensePage from './components/licensing/LicensePage';

ReactDOM.render(
  <React.StrictMode>
    <LicensePage />
  </React.StrictMode>,
  document.getElementById('root')
);
```

### 4. Lizenzeinstellungen integrieren

Fügen Sie die Lizenzeinstellungen in Ihre App-Einstellungen ein:

```tsx
import React from 'react';
import LicenseSettings from './components/licensing/LicenseSettings';

const SettingsPage = () => {
  return (
    <div>
      <h1>Einstellungen</h1>
      
      {/* Andere Einstellungen */}
      
      <LicenseSettings />
    </div>
  );
};

export default SettingsPage;
```

## Umgebungsvariablen konfigurieren

Für die Integration des Lizenzsystems benötigen Sie die folgenden Umgebungsvariablen, die Test- und Produktionsumgebung unterstützen:

1. Erstellen Sie eine `.env`-Datei im Hauptverzeichnis Ihrer Electron-App:

```
# Supabase-Konfiguration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# Lizenz-Konfiguration
LICENSE_ENCRYPTION_KEY=your-secure-encryption-key
DEVICE_ID_SALT=your-device-id-salt

# Umgebungskonfiguration (test oder prod)
ACTIVE_ENVIRONMENT=test
```

2. Laden Sie diese Umgebungsvariablen in Ihrer Electron-App:

```typescript
// src/main/config.ts
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config({ path: join(__dirname, '../../.env') });

// Bestimmen Sie die aktive Umgebung (Standard: test)
const activeEnvironment = process.env.ACTIVE_ENVIRONMENT || 'test';
const isDevelopment = process.env.NODE_ENV === 'development';

// Wenn wir im Entwicklungsmodus sind, verwenden wir immer die Testumgebung
const environment = isDevelopment ? 'test' : activeEnvironment;

export const config = {
  environment, // 'test' oder 'prod'
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
  },
  license: {
    encryptionKey: process.env.LICENSE_ENCRYPTION_KEY || '',
    deviceIdSalt: process.env.DEVICE_ID_SALT || '',
  },
};
```

### 2. Electron-Builder-Konfiguration

Fügen Sie die Umgebungsvariablen zu Ihrer `electron-builder.yml`-Datei hinzu:

```yaml
appId: com.yourcompany.switchfast
productName: SwitchFast
extraResources:
  - from: .env
    to: .env
```

## Testen

### 1. Entwicklungsmodus

Starten Sie Ihre App im Entwicklungsmodus:

```bash
npm run dev
```

### 2. Testszenarien

Testen Sie die folgenden Szenarien:

1. **Erster Start**: Die Trial-Periode sollte beginnen.
2. **Trial-Ablauf**: Setzen Sie das Trial-Enddatum auf ein Datum in der Vergangenheit und starten Sie die App neu.
3. **Lizenzkauf**: Testen Sie den Stripe-Checkout-Prozess mit einem Testkonto.
4. **Lizenzaktivierung**: Aktivieren Sie die Lizenz auf einem anderen Gerät.
5. **Gerätedeaktivierung**: Deaktivieren Sie ein Gerät über die Lizenzeinstellungen.
6. **Offline-Betrieb**: Trennen Sie die Internetverbindung und starten Sie die App.

## Fehlerbehebung

### Häufige Probleme

1. **IPC-Kommunikationsfehler**: Stellen Sie sicher, dass die IPC-Kanäle korrekt eingerichtet sind.
2. **Lizenzvalidierungsfehler**: Überprüfen Sie die Verbindung zu den Edge Functions.
3. **Lokale Speicherungsfehler**: Stellen Sie sicher, dass `electron-store` korrekt konfiguriert ist.
4. **Geräte-ID-Generierungsfehler**: Überprüfen Sie die Installation von `node-machine-id`.

### Debugging

Aktivieren Sie die Protokollierung für das Lizenzsystem:

```typescript
// In src/main/licensing/licenseManager.ts
private log(message: string, data?: any) {
  console.log(`[LicenseManager] ${message}`, data || '');
}
```

## Sicherheitshinweise

- Speichern Sie keine sensiblen Informationen im Renderer-Prozess.
- Verschlüsseln Sie alle lokal gespeicherten Lizenzdaten.
- Validieren Sie alle Eingaben serverseitig.
- Implementieren Sie zusätzliche Sicherheitsmaßnahmen gegen Reverse Engineering.

## Nächste Schritte

- Implementieren Sie ein Logging-System für Lizenzaktivitäten.
- Fügen Sie eine Funktion zum Exportieren von Lizenzinformationen hinzu.
- Implementieren Sie eine Funktion zum Zurücksetzen des Lizenzsystems für Supportzwecke.
