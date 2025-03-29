import React, { useState, useEffect, useCallback } from "react";
import { ipcRenderer } from "electron";
import "./styles/index.css";
import ApplicationList from "./components/ApplicationList";
import { ProcessInfo, Theme } from "../types";

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
    console.log("App - Lade Anwendungen vom Main-Prozess");
    const fetchApplications = async () => {
      try {
        const apps = await ipcRenderer.invoke("get-running-applications");
        console.log(
          "App - Erhaltene Anwendungen:",
          apps?.length || 0,
          JSON.stringify(apps?.slice(0, 3), null, 2),
          apps?.length > 3 ? "... und weitere" : ""
        );

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

        const runningAppIds = new Set(
          apps.flatMap((app: ProcessInfo) => getAllAppIds(app))
        );

        // Cleanup themes by removing only truly closed applications
        setThemes((prevThemes) =>
          prevThemes.map((theme) => ({
            ...theme,
            applications: theme.applications.filter((appId) =>
              runningAppIds.has(appId)
            ),
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
        console.log(`Theme aktiviert: ${theme.name}`);
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
      console.log("==========================================");
      console.log("Shortcut aktiviert für Theme:", themeId);
      console.log("Aktuelle aktive Themes:", activeThemes);
      console.log("Focus Mode vor Aktivierung:", focusModeActive);

      // Ersetze alle aktiven Themes durch das neue Theme
      setActiveThemes([themeId]);

      // For backward compatibility
      setActiveTheme(themeId);
      setFocusModeActive(true);

      // Alle anderen Anwendungen minimieren
      try {
        console.log("Versuche Focus Mode anzuwenden für:", themeId);
        applyFocusMode(themeId, true);
        console.log("Focus Mode erfolgreich angewendet");
      } catch (error) {
        console.error("Fehler beim Anwenden des Focus Mode:", error);
      }

      console.log(
        `Theme ${themeId} durch Shortcut aktiviert, alle anderen Themes deaktiviert`
      );
      console.log("==========================================");
    };

    // Event-Listener registrieren
    console.log("Registriere activate-theme-and-minimize Event-Listener");
    ipcRenderer.on(
      "activate-theme-and-minimize",
      handleActivateThemeAndMinimize
    );

    return () => {
      console.log("Entferne activate-theme-and-minimize Event-Listener");
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
    console.log("Focus Mode Toggle: ", !focusModeActive);

    if (activeThemes.length === 0) {
      console.log("Keine aktiven Gruppen ausgewählt.");
      return;
    }

    setFocusModeActive(!focusModeActive);

    // If there's at least one active theme, use the first one for compatibility
    if (activeThemes.length > 0) {
      applyFocusMode(activeThemes[0], !focusModeActive);
    }
  };

  // Modified to support multiple themes
  const applyFocusMode = async (themeId: string, active: boolean) => {
    if (!active) {
      console.log("Focus Mode deaktiviert");
      return;
    }

    // Finde das aktuelle Theme
    const currentTheme = themes.find((t) => t.id === themeId);
    if (!currentTheme) {
      console.log("Theme nicht gefunden");
      return;
    }

    console.log(`Aktiviere exklusiv Theme: ${currentTheme.name}`);

    // Verwende nur die Apps des aktuellen Themes
    const appIdsToProtect = currentTheme.applications;

    if (appIdsToProtect.length === 0) {
      alert(
        "Diese Gruppe enthält keine Anwendungen. Füge mindestens eine Anwendung hinzu, damit der Focus-Modus funktioniert."
      );
      console.log("Keine Anwendungen in der Gruppe, nichts zu minimieren");
      return;
    }

    try {
      // Neue Methode: "Show Desktop" und dann Apps wiederherstellen
      console.log(
        `Sende Anfrage für 'Show Desktop except Apps' für ${appIdsToProtect.length} Anwendungen aus Theme "${currentTheme.name}"...`
      );
      const success = await ipcRenderer.invoke(
        "show-desktop-except",
        appIdsToProtect
      );

      if (success) {
        console.log("'Show Desktop'-Funktion erfolgreich ausgeführt");
      } else {
        console.warn("Problem beim Ausführen der 'Show Desktop'-Funktion");

        // Fallback auf die alten Methoden mit dem einzelnen aktiven Theme
        if (currentTheme) {
          fallbackFocusMode(currentTheme);
        }
      }
    } catch (error) {
      console.error(
        "Fehler beim Ausführen der 'Show Desktop'-Funktion:",
        error
      );

      // Fallback auf die alten Methoden
      if (currentTheme) {
        fallbackFocusMode(currentTheme);
      }
    }
  };

  // Fallback-Methode, die verschiedene andere Minimierungsmethoden ausprobiert
  const fallbackFocusMode = async (theme: Theme) => {
    console.log("Verwende Fallback-Methoden für Focus Mode");

    try {
      // Methode 1: Versuche Minimieren aller außer der ersten App
      if (theme.applications.length > 0) {
        const primaryAppId = theme.applications[0];
        console.log(
          `Versuche alle außer Primäranwendung ${primaryAppId} zu minimieren`
        );

        const success = await ipcRenderer.invoke(
          "minimize-all-except",
          primaryAppId
        );

        if (success) {
          console.log("Fenster erfolgreich minimiert");
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
    console.log(
      "Verwende Fallback-Methode zum Minimieren einzelner Anwendungen"
    );

    // Bestimme, welche Anwendungen minimiert werden sollen
    const appsToMinimize = allApps
      .filter((app) => !theme.applications.includes(app.id))
      .map((app) => app.id);

    // Debug-Informationen anzeigen
    console.log(
      `${appsToMinimize.length} Anwendungen werden einzeln minimiert`
    );

    const appsToMinimizeDetails = allApps
      .filter((app) => !theme.applications.includes(app.id))
      .map((app) => `${app.title} (ID: ${app.id})`);

    console.log("Zu minimierende Anwendungen:", appsToMinimizeDetails);

    if (appsToMinimize.length === 0) {
      console.log("Keine Anwendungen zu minimieren");
      return;
    }

    // Minimiere alle Anwendungen, die nicht zum aktiven Theme gehören
    try {
      console.log("Sende Minimierungsanfrage an Main-Prozess...");
      const success = await ipcRenderer.invoke(
        "minimize-applications",
        appsToMinimize
      );

      if (success) {
        console.log("Alle Anwendungen wurden erfolgreich minimiert");
      } else {
        console.warn("Einige Anwendungen konnten nicht minimiert werden");
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
      console.log("Aktiviere Kompaktmodus mit nur Shortcuts");
    } else {
      // Zurück zum Normalmodus
      console.log("Deaktiviere Kompaktmodus, zeige alle Inhalte");
    }
  };

  return (
    <div
      className={`app-container-simple ${compactMode ? "compact-mode" : ""}`}
    >
      <div className="custom-titlebar">
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
          <div className="loading-spinner">
            <div></div>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
            <div></div>
          </div>
          <div className="loading-text">Lade Anwendungen...</div>
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
