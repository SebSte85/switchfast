# Work Focus Manager

Eine Desktop-Anwendung zur Verwaltung von Anwendungsfokus durch themenbasierte Gruppierung. Entwickelt mit Electron, React und TypeScript.

## Features

### Kernfunktionen

- **Themenbasierte Gruppierung**: Organisieren Sie Ihre Anwendungen in benutzerdefinierten Gruppen/Themes
- **Globale Shortcuts**: Schneller Zugriff auf Ihre Anwendungsgruppen über konfigurierbare Tastenkombinationen
- **Prozessbaum-Visualisierung**: Übersichtliche Darstellung aller laufenden Prozesse und ihrer Beziehungen
- **Persistente Speicherung**: Ihre Themes und Einstellungen bleiben auch nach Neustart der Anwendung erhalten
- **Kompaktmodus**: Platzsparende Darstellung für effiziente Arbeitsabläufe

### Technische Features

- Electron IPC für sichere Prozess-Kommunikation
- Windows Process API Integration
- JSON-basierte Datenpersistenz im Benutzerverzeichnis
- Reaktive Benutzeroberfläche mit React und TypeScript

## Installation

1. Stellen Sie sicher, dass Node.js (v14 oder höher) installiert ist
2. Klonen Sie das Repository:
   ```bash
   git clone [repository-url]
   ```
3. Installieren Sie die Abhängigkeiten:
   ```bash
   npm install
   ```
4. Starten Sie die Anwendung im Entwicklungsmodus:
   ```bash
   npm run dev
   ```

## Build

Um eine ausführbare Datei zu erstellen:

```bash
npm run build
```

## Bekannte Einschränkungen

- Nach einem System-Neustart müssen Prozesse neu zugeordnet werden, da sich die Prozess-IDs ändern
- Einige Anwendungen erfordern erhöhte Berechtigungen für die Interaktion
- Das Fenster-Fokus-Verhalten kann je nach Anwendungstyp variieren

## Technologie-Stack

- **Frontend**: React, TypeScript, Electron, CSS Modules
- **Backend**: Node.js, Electron IPC, Windows Process API
- **Speicherung**: JSON-basierte Persistenz im Benutzerverzeichnis

## Auto-Update-Funktion

Die Anwendung ist mit einem automatischen Update-System ausgestattet. Wenn neue Versionen verfügbar sind, werden Benutzer benachrichtigt und können das Update automatisch installieren.

### Einrichtung für Entwickler

1. Erstelle ein GitHub-Repository für deine App
2. Bearbeite die `package.json` und passe die `publish`-Konfiguration an:
   ```json
   "publish": [
     {
       "provider": "github",
       "owner": "DEIN_GITHUB_BENUTZERNAME",
       "repo": "DEIN_REPOSITORY_NAME"
     }
   ]
   ```
3. Erstelle ein persönliches GitHub-Token mit Berechtigungen für das Repository
4. Setze das Token als Umgebungsvariable:

   ```
   setx GH_TOKEN "dein_github_token"
   ```

5. Erstelle ein Release mit einer Versionsnummer (z.B. v1.0.0):

   ```
   npm version patch
   npm run package
   ```

6. Veröffentliche das Release auf GitHub:
   ```
   npx electron-builder -p always
   ```

Die App wird nun bei jedem Start nach Updates suchen und Benutzer benachrichtigen, wenn eine neue Version verfügbar ist.

## Lizenz

[Ihre Lizenz hier]
