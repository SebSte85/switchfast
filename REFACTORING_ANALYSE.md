# SwitchFast Projekt - Refactoring Analyse

## Executive Summary

Das SwitchFast-Projekt zeigt typische Symptome gewachsener Software mit mehreren kritischen Refactoring-Bedürfnissen. Die Hauptprobleme sind monolithische Dateien, fehlende Modularisierung und Code-Duplikation.

## 🚨 Kritische Problembereiche

### 1. Monolithische "God Files"

**Problem:** Mehrere extrem große Dateien die zu viele Verantwortlichkeiten haben:

- `src/main.ts` (4.000 Zeilen) - Electron Main Process mit allem
- `src/renderer/App.tsx` (1.138 Zeilen) - React Root mit komplettem State Management
- `src/main/dataStore.ts` (926 Zeilen) - Data Layer mit Business Logic
- `src/renderer/components/ApplicationList.tsx` (1.010 Zeilen)
- `src/renderer/components/Settings.tsx` (876 Zeilen)

**Impact:** 
- Schwer zu testen und zu verstehen
- Hohe Kopplung, niedrige Kohäsion
- Merge-Konflikte bei Team-Entwicklung
- Fehleranfällig bei Änderungen

### 2. Fehlende Separation of Concerns

**Problem:** Vermischung von:
- Geschäftslogik und UI-Code
- PowerShell-Aufrufe und Datenverarbeitung  
- Event-Handling und State Management
- Analytics und Core-Funktionalität

### 3. Code-Duplikation

**Identifizierte Duplikate:**
- PowerShell-Command-Erstellung (3+ Stellen)
- Fehlerbehandlung für Electron IPC (mehrfach)
- Theme-Validierung (Frontend/Backend)
- Window-Handle-Management

## 📋 Detaillierte Refactoring-Vorschläge

### A. Main Process Refactoring (`src/main.ts`)

**Aktuell:** Eine 4.000-Zeilen-Datei mit allem

**Ziel-Struktur:**
```
src/main/
├── index.ts (Entry Point, 50-100 Zeilen)
├── window/
│   ├── WindowManager.ts
│   └── TrayManager.ts
├── shortcuts/
│   ├── ShortcutRegistry.ts
│   └── ShortcutHandler.ts
├── processes/
│   ├── ProcessManager.ts
│   ├── PowerShellRunner.ts
│   └── WindowController.ts
├── ipc/
│   ├── IpcHandlers.ts
│   └── EventEmitter.ts
└── initialization/
    ├── AppInitializer.ts
    └── StartupSequence.ts
```

**Konkrete Aufgaben:**

1. **WindowManager extrahieren**
```typescript
// src/main/window/WindowManager.ts
export class WindowManager {
  private mainWindow: BrowserWindow | null = null;
  
  createMainWindow(): BrowserWindow {
    // 50-80 Zeilen fokussierte Fenster-Erstellung
  }
  
  setupWindowEvents(): void {
    // Event-Handler für Fenster
  }
}
```

2. **ShortcutRegistry extrahieren**
```typescript
// src/main/shortcuts/ShortcutRegistry.ts
export class ShortcutRegistry {
  private registeredShortcuts = new Map<string, string>();
  
  registerThemeShortcut(themeId: string, shortcut: string): boolean
  unregisterThemeShortcut(themeId: string): void
  formatShortcutForElectron(shortcut: string): string
}
```

3. **ProcessManager extrahieren**
```typescript
// src/main/processes/ProcessManager.ts
export class ProcessManager {
  async getRunningApplications(): Promise<ProcessInfo[]>
  async minimizeApplications(processIds: number[]): Promise<boolean>
  async showDesktopExceptApps(appIds: number[]): Promise<boolean>
}
```

### B. Frontend App Component Refactoring

**Aktuell:** `App.tsx` mit 1.138 Zeilen

**Ziel-Struktur:**
```
src/renderer/
├── App.tsx (100-150 Zeilen, nur Layout)
├── hooks/
│   ├── useApplications.ts
│   ├── useThemes.ts
│   ├── useShortcuts.ts
│   └── useLoadingState.ts
├── context/
│   ├── AppContext.tsx
│   └── ThemeContext.tsx
├── services/
│   ├── IpcService.ts
│   └── AnalyticsService.ts
└── components/
    ├── LoadingScreen.tsx
    ├── ThemeManager.tsx
    └── ApplicationManager.tsx
```

**Konkrete Aufgaben:**

1. **Custom Hooks extrahieren**
```typescript
// src/renderer/hooks/useApplications.ts
export const useApplications = () => {
  const [applications, setApplications] = useState<ProcessInfo[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  const fetchApplications = useCallback(async () => {
    // Fokussierte Anwendungs-Logik
  }, []);
  
  return { applications, isRefreshing, fetchApplications };
};
```

2. **LoadingState Manager**
```typescript
// src/renderer/hooks/useLoadingState.ts
export const useLoadingState = () => {
  const [loading, setLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [loadingStep, setLoadingStep] = useState('');
  
  // Fokussierte Loading-Logik
  return { loading, loadingPhase, loadingStep, /* methods */ };
};
```

### C. DataStore Refactoring

**Aktuell:** `dataStore.ts` mit 926 Zeilen

**Ziel-Struktur:**
```
src/main/data/
├── DataStore.ts (Interface, 50-100 Zeilen)
├── FileSystemStorage.ts
├── ThemeRepository.ts
├── WindowRepository.ts
└── validators/
    ├── ThemeValidator.ts
    └── ProcessValidator.ts
```

**Konkrete Aufgaben:**

1. **Repository Pattern einführen**
```typescript
// src/main/data/ThemeRepository.ts
export class ThemeRepository {
  constructor(private storage: FileSystemStorage) {}
  
  async save(theme: Theme): Promise<void>
  async findById(id: string): Promise<Theme | null>
  async findAll(): Promise<Theme[]>
  async delete(id: string): Promise<boolean>
}
```

2. **Validation Layer**
```typescript
// src/main/data/validators/ThemeValidator.ts
export class ThemeValidator {
  validateTheme(theme: Theme): ValidationResult
  validateShortcut(shortcut: string): ValidationResult
  hasShortcutConflict(shortcut: string, existingThemes: Theme[]): boolean
}
```

### D. Component Refactoring

**ApplicationList.tsx (1.010 Zeilen) aufteilen:**

```
src/renderer/components/applications/
├── ApplicationList.tsx (150-200 Zeilen)
├── ApplicationItem.tsx
├── ApplicationTree.tsx
├── ProcessGroup.tsx
├── hooks/
│   ├── useApplicationDragDrop.ts
│   └── useApplicationSelection.ts
└── utils/
    └── ApplicationUtils.ts
```

**Settings.tsx (876 Zeilen) aufteilen:**

```
src/renderer/components/settings/
├── Settings.tsx (100-150 Zeilen)
├── sections/
│   ├── GeneralSettings.tsx
│   ├── ShortcutSettings.tsx
│   ├── ThemeSettings.tsx
│   └── AdvancedSettings.tsx
└── hooks/
    └── useSettings.ts
```

## 🔧 PowerShell Integration Refactoring

**Problem:** PowerShell-Code in 3+ Dateien dupliziert

**Lösung:**
```typescript
// src/main/system/PowerShellRunner.ts
export class PowerShellRunner {
  async runScript(script: string, options?: PowerShellOptions): Promise<string>
  async getProcessList(): Promise<ProcessInfo[]>
  async minimizeWindow(processId: number): Promise<boolean>
  async enumerateWindows(): Promise<WindowInfo[]>
}

// src/main/system/WindowController.ts
export class WindowController {
  constructor(private powershell: PowerShellRunner) {}
  
  async minimizeApplications(processIds: number[]): Promise<boolean>
  async showDesktopExcept(protectedIds: number[]): Promise<boolean>
  async restoreWindows(windowHandles: number[]): Promise<boolean>
}
```

## 🧪 Test-Verbesserungen

**Aktuelle Probleme:**
- Tests mit sehr langen Funktionen (400+ Zeilen)
- Mock-Duplikation
- Fehlende Integration Tests

**Refactoring-Vorschläge:**

1. **Test Utilities extrahieren**
```typescript
// tests/utils/TestDataFactory.ts
export class TestDataFactory {
  static createTheme(overrides?: Partial<Theme>): Theme
  static createProcessInfo(overrides?: Partial<ProcessInfo>): ProcessInfo
  static createMockElectronApp(): MockElectronApp
}
```

2. **Test-Hooks für Wiederverwendung**
```typescript
// tests/utils/TestHooks.ts
export const useTestApplications = () => {
  // Wiederverwendbare Test-Setup-Logik
}
```

## 📊 Priorisierte Umsetzungsreihenfolge

### Phase 1 - Kritische Zerlegung (2-3 Wochen)
1. `main.ts` in 5-7 Module aufteilen
2. `App.tsx` State Management extrahieren
3. PowerShell-Runner abstrahieren

### Phase 2 - Component Refactoring (2-3 Wochen)  
1. ApplicationList in Sub-Components
2. Settings in Sections aufteilen
3. Custom Hooks implementieren

### Phase 3 - Data Layer (1-2 Wochen)
1. Repository Pattern für DataStore
2. Validation Layer
3. Error Handling standardisieren

### Phase 4 - Test Improvement (1 Woche)
1. Test Utilities
2. Integration Tests
3. Mock-Standardisierung

## ⚡ Erwartete Verbesserungen

**Wartbarkeit:** 
- 70% kleinere Dateien
- Klarere Verantwortlichkeiten
- Bessere Testbarkeit

**Performance:**
- Reduzierte Bundle-Größe durch Tree-Shaking
- Bessere Code-Splitting-Möglichkeiten
- Optimierte Re-Renders

**Entwicklungseffizienz:**
- Weniger Merge-Konflikte
- Schnellere Orientation für neue Entwickler
- Einfachere Feature-Entwicklung

**Risikominimierung:**
- Isolierte Fehlerbehandlung
- Bessere Error Boundaries
- Robustere IPC-Kommunikation

## 🚀 Quick Wins (1-2 Tage Aufwand)

1. **PowerShellRunner extrahieren** - Sofortige Code-Duplikation-Reduzierung
2. **useApplications Hook** - App.tsx um 200+ Zeilen reduzieren  
3. **ThemeValidator** - Konsistente Validation an allen Stellen
4. **IpcService** - Zentralisierte IPC-Kommunikation

Diese Quick Wins bieten sofortigen Nutzen und schaffen die Basis für größere Refactoring-Schritte.