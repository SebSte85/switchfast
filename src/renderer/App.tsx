import React, { useState, useEffect, useCallback } from "react";
import { ipcRenderer } from "electron";
import "./styles/index.css";
import ApplicationList from "./components/ApplicationList";
import { ProcessInfo, Theme, WindowInfo } from "../types";

const App: React.FC = () => {
  const [applications, setApplications] = useState<ProcessInfo[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [activeThemes, setActiveThemes] = useState<string[]>([]);
  const [focusModeActive, setFocusModeActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [compactMode, setCompactMode] = useState<boolean>(false);

  // Laden der laufenden Anwendungen
  useEffect(() => {
    const fetchApplications = async () => {
      try {
        const apps = await ipcRenderer.invoke("get-running-applications");

        // Erstelle eine Map aller App-IDs (inkl. Kinder)
        const getAllAppIds = (app: ProcessInfo): number[] => {
          const ids = [app.id];
          if (app.children) {
            app.children.forEach((child: ProcessInfo) => {
              ids.push(...getAllAppIds(child));
            });
          }
          return ids;
        };

        // Get all process IDs
        const runningAppIds = new Set(
          apps.flatMap((app: ProcessInfo) => getAllAppIds(app))
        );

        // Get all window handles
        const runningWindowIds = new Set<number>();
        apps.forEach((app: ProcessInfo) => {
          if (app.windows) {
            app.windows.forEach((window: WindowInfo) => {
              runningWindowIds.add(window.hwnd);
            });
          }
        });

        // Cleanup themes by removing only truly closed applications and windows
        setThemes((prevThemes) =>
          prevThemes.map((theme) => ({
            ...theme,
            applications: theme.applications.filter((appId) => {
              // If this is a window handle (typically larger numbers)
              if (typeof appId === "number" && appId > 100000) {
                return runningWindowIds.has(appId);
              }
              // If this is a process ID
              return runningAppIds.has(appId);
            }),
          }))
        );

        setApplications(apps || []);
        setLoading(false);
      } catch (error) {
        console.error("App - Fehler beim Abrufen der Anwendungen:", error);
        setLoading(false);
      }
    };

    fetchApplications();

    // Anwendungen alle 10 Sekunden aktualisieren
    const intervalId = setInterval(fetchApplications, 10000);
    return () => clearInterval(intervalId);
  }, []);

  // Laden der gespeicherten Themes beim Start
  useEffect(() => {
    const loadSavedThemes = async () => {
      try {
        const savedThemes = await ipcRenderer.invoke("get-themes");
        if (savedThemes && savedThemes.length > 0) {
          setThemes(savedThemes);
        }
      } catch (error) {
        console.error("Fehler beim Laden der gespeicherten Themes:", error);
      }
    };

    loadSavedThemes();
  }, []);

  // Speichern der Themes bei Änderungen
  useEffect(() => {
    const saveThemes = async () => {
      try {
        await ipcRenderer.invoke("save-themes", themes);
      } catch (error) {
        console.error("Fehler beim Speichern der Themes:", error);
      }
    };

    if (themes.length > 0) {
      saveThemes();
    }
  }, [themes]);

  // Theme hinzufügen mit useCallback
  const handleAddTheme = useCallback(async (newTheme: Theme) => {
    const themeToAdd: Theme = {
      ...newTheme,
      id: newTheme.id || `theme_${Date.now()}`,
      applications: newTheme.applications || [],
      shortcut: newTheme.shortcut || "",
      color: newTheme.color || "#78d97c",
    };

    try {
      await ipcRenderer.invoke("add-theme", themeToAdd);
      setThemes((prevThemes) => [...prevThemes, themeToAdd]);
    } catch (error) {
      console.error("Fehler beim Hinzufügen des Themes:", error);
    }
  }, []);

  // Globale Funktion, um den aktuellen Theme-Status für den Main-Prozess bereitzustellen
  useEffect(() => {
    // Diese Funktion gibt das angeforderte Theme zurück
    (window as any).getCurrentThemeInfo = (themeId: string) => {
      const theme = themes.find((t) => t.id === themeId);
      if (theme) {
        return {
          id: theme.id,
          name: theme.name,
          applications: theme.applications,
          shortcut: theme.shortcut,
        };
      }
      return null;
    };

    // Funktion zum Abrufen des aktiven Themes
    (window as any).getActiveThemeInfo = () => {
      if (!activeTheme) return null;

      const theme = themes.find((t) => t.id === activeTheme);
      if (theme) {
        return {
          id: theme.id,
          name: theme.name,
          applications: theme.applications,
          shortcut: theme.shortcut,
        };
      }
      return null;
    };

    // Funktion zum Abrufen aller Themes
    (window as any).getAllThemesInfo = () => {
      return themes.map((theme) => ({
        id: theme.id,
        name: theme.name,
        applications: theme.applications,
        shortcut: theme.shortcut,
      }));
    };

    return () => {
      // Cleanup
      delete (window as any).getCurrentThemeInfo;
      delete (window as any).getActiveThemeInfo;
      delete (window as any).getAllThemesInfo;
    };
  }, [themes, activeTheme]);

  // Event-Listener für Theme-Erstellung von ApplicationList
  useEffect(() => {
    const handleAddThemeEvent = (event: any) => {
      if (event.detail) {
        handleAddTheme(event.detail);
      }
    };

    window.addEventListener("addTheme", handleAddThemeEvent);
    return () => {
      window.removeEventListener("addTheme", handleAddThemeEvent);
    };
  }, [handleAddTheme]);

  // Tastaturkürzelevent-Listener für Theme-Aktivierung
  useEffect(() => {
    const handleActivateTheme = (_: any, themeIndex: number) => {
      if (themeIndex >= 0 && themeIndex < themes.length) {
        const theme = themes[themeIndex];
        setActiveTheme(theme.id);

        // Automatisch Focus-Modus einschalten
        applyFocusMode(theme.id, true);
      }
    };

    ipcRenderer.on("activate-theme", handleActivateTheme);
    return () => {
      ipcRenderer.removeListener("activate-theme", handleActivateTheme);
    };
  }, [themes]);

  // Handler für Theme-Aktivierung durch Shortcuts
  useEffect(() => {
    const handleActivateThemeAndMinimize = (_: any, themeId: string) => {
      setActiveThemes([themeId]);

      // For backward compatibility
      setActiveTheme(themeId);
      setFocusModeActive(true);

      // Alle anderen Anwendungen minimieren
      try {
        applyFocusMode(themeId, true);
      } catch (error) {
        console.error("Fehler beim Anwenden des Focus Mode:", error);
      }
    };

    // Event-Listener registrieren
    ipcRenderer.on(
      "activate-theme-and-minimize",
      handleActivateThemeAndMinimize
    );

    return () => {
      ipcRenderer.removeListener(
        "activate-theme-and-minimize",
        handleActivateThemeAndMinimize
      );
    };
  }, [themes, applications, activeThemes, focusModeActive]);

  // Toggle Focus Mode via global shortcut
  useEffect(() => {
    const handleToggleFocusMode = () => {
      toggleFocusMode();
    };

    ipcRenderer.on("toggle-focus-mode", handleToggleFocusMode);
    return () => {
      ipcRenderer.removeListener("toggle-focus-mode", handleToggleFocusMode);
    };
  }, [focusModeActive, activeTheme]);

  // Theme löschen (mit useCallback, damit es als Abhängigkeit verwendet werden kann)
  const handleDeleteTheme = useCallback(
    (themeId: string) => {
      // Das Theme aus dem State entfernen
      setThemes((prevThemes) =>
        prevThemes.filter((theme) => theme.id !== themeId)
      );

      // Falls das gelöschte Theme aktiv war, inaktiv setzen
      if (activeTheme === themeId) {
        setActiveTheme(null);
      }

      // Aus der Liste der aktiven Themes entfernen
      setActiveThemes((prevActiveThemes) =>
        prevActiveThemes.filter((id) => id !== themeId)
      );

      // Wenn ein Shortcut für dieses Theme registriert war, diesen entfernen
      ipcRenderer.invoke("unregister-shortcut", { themeId });
    },
    [activeTheme]
  );

  // Event-Listener für Theme-Löschung
  useEffect(() => {
    const handleDeleteThemeEvent = (event: any) => {
      if (event.detail) {
        handleDeleteTheme(event.detail);
      }
    };

    window.addEventListener("deleteTheme", handleDeleteThemeEvent);
    return () => {
      window.removeEventListener("deleteTheme", handleDeleteThemeEvent);
    };
  }, [handleDeleteTheme]);

  // Anwendung zum Theme hinzufügen
  const handleAddToTheme = useCallback(
    (themeId: string, appId: number | string) => {
      setThemes((prevThemes) =>
        prevThemes.map((theme) =>
          theme.id === themeId
            ? {
                ...theme,
                applications: [...theme.applications, appId],
              }
            : theme
        )
      );
    },
    []
  );

  // Anwendung aus Theme entfernen
  const handleRemoveFromTheme = useCallback(
    (themeId: string, appId: number | string) => {
      setThemes((prevThemes) =>
        prevThemes.map((theme) =>
          theme.id === themeId
            ? {
                ...theme,
                applications: theme.applications.filter((id) => id !== appId),
              }
            : theme
        )
      );
    },
    []
  );

  // Theme aktualisieren
  const handleUpdateTheme = useCallback((updatedTheme: Theme) => {
    setThemes((prevThemes) =>
      prevThemes.map((theme) =>
        theme.id === updatedTheme.id ? updatedTheme : theme
      )
    );
  }, []);

  // Toggle theme activation (add to or remove from active themes)
  const toggleActiveTheme = (themeId: string) => {
    setActiveThemes((prev) => {
      if (prev.includes(themeId)) {
        // If already active, remove it
        return prev.filter((id) => id !== themeId);
      } else {
        // If not active, add it
        return [...prev, themeId];
      }
    });

    // For backward compatibility with single activeTheme
    if (activeTheme === themeId) {
      setActiveTheme(null);
    } else {
      setActiveTheme(themeId);
    }

    // If focus mode is active, update it with the new set of active themes
    if (focusModeActive) {
      applyFocusMode(themeId, true);
    }
  };

  // Focus Mode umschalten
  const toggleFocusMode = () => {
    setFocusModeActive(!focusModeActive);

    // If there's at least one active theme, use the first one for compatibility
    if (activeThemes.length > 0) {
      applyFocusMode(activeThemes[0], !focusModeActive);
    }
  };

  // Modified to support multiple themes
  const applyFocusMode = async (themeId: string, active: boolean) => {
    if (!active) {
      return;
    }

    // Finde das aktuelle Theme
    const currentTheme = themes.find((t) => t.id === themeId);
    if (!currentTheme) {
      return;
    }

    // Sammle alle zu schützenden IDs
    let appIdsToProtect: number[] = [];

    // 1. Sammle reguläre Prozess-IDs
    currentTheme.applications.forEach((id) => {
      // Wenn id ein number ist, füge es hinzu
      if (typeof id === "number") {
        appIdsToProtect.push(id);
      }
    });

    // 2. Sammle Fenster-Handles aus dem windows-Array, falls vorhanden
    if (
      (currentTheme as any).windows &&
      (currentTheme as any).windows.length > 0
    ) {
      (currentTheme as any).windows.forEach((window: WindowInfo) => {
        if (window.hwnd && !appIdsToProtect.includes(window.hwnd)) {
          appIdsToProtect.push(window.hwnd);
        }
        if (window.processId && !appIdsToProtect.includes(window.processId)) {
          appIdsToProtect.push(window.processId);
        }
      });
    }

    // 3. Prüfe, ob wir überhaupt etwas zu schützen haben
    if (appIdsToProtect.length === 0) {
      alert(
        "Diese Gruppe enthält keine Anwendungen. Füge mindestens eine Anwendung hinzu, damit der Focus-Modus funktioniert."
      );
      return;
    }

    try {
      // Neue Methode: "Show Desktop" und dann Apps wiederherstellen
      const success = await ipcRenderer.invoke(
        "show-desktop-except",
        appIdsToProtect
      );

      if (!success) {
        // Fallback auf die alten Methoden mit dem einzelnen aktiven Theme
        if (currentTheme) {
          fallbackFocusMode(currentTheme);
        }
      }
    } catch (error) {
      // Fallback auf die alten Methoden
      if (currentTheme) {
        fallbackFocusMode(currentTheme);
      }
    }
  };

  // Fallback-Methode, die verschiedene andere Minimierungsmethoden ausprobiert
  const fallbackFocusMode = async (theme: Theme) => {
    try {
      // Methode 1: Versuche Minimieren aller außer der ersten App
      if (theme.applications.length > 0) {
        const primaryAppId = theme.applications[0];
        const success = await ipcRenderer.invoke(
          "minimize-all-except",
          primaryAppId
        );

        if (success) {
          return;
        }
      }

      // Methode 2: Versuche die alte Minimierungsmethode (einzeln)
      fallbackMinimizeOtherApps(theme, applications);
    } catch (error) {
      console.error("Fehler im Fallback Focus Mode:", error);
    }
  };

  // Fallback-Methode, die die alte Minimierungsmethode verwendet
  const fallbackMinimizeOtherApps = async (
    theme: Theme,
    allApps: ProcessInfo[]
  ) => {
    // Bestimme, welche Anwendungen minimiert werden sollen
    const appsToMinimize = allApps
      .filter((app) => !theme.applications.includes(app.id))
      .map((app) => app.id);

    if (appsToMinimize.length === 0) {
      return;
    }

    // Minimiere alle Anwendungen, die nicht zum aktiven Theme gehören
    try {
      const success = await ipcRenderer.invoke(
        "minimize-applications",
        appsToMinimize
      );

      if (success) {
        return;
      }
    } catch (error) {
      console.error("Fehler beim Minimieren der Anwendungen:", error);
    }
  };

  // Kompaktmodus ändern und Größe anpassen
  const toggleCompactMode = () => {
    const newMode = !compactMode;
    setCompactMode(newMode);

    // Sende Event an Main Process mit der Anzahl der Gruppen
    ipcRenderer.send("toggle-compact-mode", newMode, themes.length);

    // Im kompakten Modus zeigen wir nur Shortcuts an, deaktiviere das im normalen Modus
    if (newMode) {
      // In den kompakten/Shortcut-Modus wechseln
    } else {
      // Zurück zum Normalmodus
    }
  };

  return (
    <div
      className={`app-container-simple ${compactMode ? "compact-mode" : ""}`}
    >
      <div className="custom-titlebar">
        <div className="app-brand">
          <div className="app-logo">
            <img
              src="../assets/logo.svg"
              width="16"
              height="16"
              alt="Switchfast Logo"
            />
          </div>
          <div className="app-name">switchfast</div>
        </div>
        <div className="drag-region"></div>
        <div className="window-controls">
          <button
            className="compact-toggle-button"
            onClick={toggleCompactMode}
            title={compactMode ? "Vollständige Ansicht" : "Kompaktansicht"}
          >
            {compactMode ? (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path fill="currentColor" d="M 6,2 L 10,6 L 2,6 Z" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 12 12">
                <path fill="currentColor" d="M 6,10 L 10,6 L 2,6 Z" />
              </svg>
            )}
          </button>
          <button
            className="minimize-button"
            onClick={() => ipcRenderer.send("minimize-window")}
            title="Minimieren"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <rect
                fill="currentColor"
                width="10"
                height="1"
                x="1"
                y="6"
              ></rect>
            </svg>
          </button>
          <button
            className="close-button"
            onClick={() => ipcRenderer.send("close-window")}
            title="Schließen"
          >
            <svg width="12" height="12" viewBox="0 0 12 12">
              <path
                fill="currentColor"
                d="M 1,1 L 11,11 M 1,11 L 11,1"
                stroke="currentColor"
                strokeWidth="1.5"
              />
            </svg>
          </button>
        </div>
      </div>
      {loading ? (
        <div className="loading-animation">
          <div className="loading-text">Lade Anwendungen...</div>
          <div className="loading-process-item"></div>
        </div>
      ) : (
        <ApplicationList
          applications={applications}
          themes={themes}
          activeTheme={activeTheme}
          activeThemes={activeThemes}
          onAddToTheme={handleAddToTheme}
          onRemoveFromTheme={handleRemoveFromTheme}
          onUpdateTheme={handleUpdateTheme}
          onToggleActiveTheme={toggleActiveTheme}
          compactMode={compactMode}
          showOnlyShortcuts={compactMode}
        />
      )}
    </div>
  );
};

export default App;
