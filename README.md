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

## Geplante Verbesserungen

- Verbesserte Prozesserkennung nach System-Neustart
- Drag-and-Drop-Unterstützung für Prozessgruppierung
- Theme-Farbanpassung
- Autostart-Funktion
- Schnellzugriffe über das System-Tray

## Technologie-Stack

- **Frontend**: React, TypeScript, Electron, CSS Modules
- **Backend**: Node.js, Electron IPC, Windows Process API
- **Speicherung**: JSON-basierte Persistenz im Benutzerverzeichnis

## Lizenz

[Ihre Lizenz hier]
