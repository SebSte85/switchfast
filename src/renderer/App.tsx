import React, { useState, useEffect, useCallback } from "react";
import { ipcRenderer } from "electron";
import "./styles/index.css";
import ApplicationList from "./components/ApplicationList";

// Typdefinitionen
interface ProcessInfo {
  id: number;
  name: string;
  title: string;
  path?: string;
  icon?: string;
  parentId?: number;
  children?: ProcessInfo[];
}

interface Theme {
  id: string;
  name: string;
  applications: number[];
  shortcut: string;
  color?: string;
}

const App: React.FC = () => {
  const [applications, setApplications] = useState<ProcessInfo[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [activeThemes, setActiveThemes] = useState<string[]>([]);
  const [focusModeActive, setFocusModeActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [compactMode, setCompactMode] = useState<boolean>(false);

  // Theme hinzufügen mit useCallback
  const handleAddTheme = useCallback((newTheme: Theme) => {
    // Ensure we have a unique ID by using the current timestamp if not provided
    const themeToAdd = {
      ...newTheme,
      id: newTheme.id || `theme_${Date.now()}`,
      applications: newTheme.applications || [],
      shortcut: newTheme.shortcut || "",
      color: newTheme.color || "#78d97c", // Standard-Grün, falls keine Farbe angegeben
    };

    // Überprüfen, ob bereits ein Theme mit dieser ID existiert
    setThemes((prevThemes) => {
      const themeExists = prevThemes.some(
        (theme) => theme.id === themeToAdd.id
      );
      if (themeExists) {
        // Falls ja, eine neue eindeutige ID generieren
        themeToAdd.id = `theme_${Date.now()}`;
      }
      return [...prevThemes, themeToAdd];
    });
  }, []);

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
    try {
      const savedThemes = localStorage.getItem("themes");
      if (savedThemes) {
        const parsedThemes = JSON.parse(savedThemes);
        setThemes(parsedThemes);
      }
    } catch (error) {
      console.error("Fehler beim Laden der gespeicherten Themes:", error);
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
  const handleAddToTheme = (themeId: string, applicationId: number) => {
    setThemes(
      themes.map((theme) => {
        if (theme.id === themeId) {
          return {
            ...theme,
            applications: [...theme.applications, applicationId],
          };
        }
        return theme;
      })
    );
  };

  // Anwendung aus Theme entfernen
  const handleRemoveFromTheme = (themeId: string, applicationId: number) => {
    setThemes(
      themes.map((theme) => {
        if (theme.id === themeId) {
          return {
            ...theme,
            applications: theme.applications.filter(
              (id) => id !== applicationId
            ),
          };
        }
        return theme;
      })
    );
  };

  // Theme aktualisieren (für Shortcut-Änderungen)
  const handleUpdateTheme = (themeId: string, updatedTheme: Partial<Theme>) => {
    setThemes(
      themes.map((theme) => {
        if (theme.id === themeId) {
          return {
            ...theme,
            ...updatedTheme,
          };
        }
        return theme;
      })
    );
  };

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

  // Speichert Themes im localStorage
  useEffect(() => {
    if (themes.length > 0) {
      try {
        const themesData = JSON.stringify(
          themes.map((theme) => ({
            id: theme.id,
            name: theme.name,
            applications: theme.applications,
            shortcut: theme.shortcut || "",
            color: theme.color || "#78d97c", // Speichere die Farbe
          }))
        );
        localStorage.setItem("themes", themesData);
      } catch (error) {
        console.error("Fehler beim Speichern der Themes:", error);
      }
    }
  }, [themes]);

  // Kompaktmodus ändern und Größe anpassen
  const toggleCompactMode = () => {
    const newMode = !compactMode;
    setCompactMode(newMode);
    // Sende Event an Main Process
    ipcRenderer.send("toggle-compact-mode", newMode);

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
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                width="16"
                height="16"
              >
                <path d="M12 9a3.75 3.75 0 100 7.5A3.75 3.75 0 0012 9z" />
                <path
                  fillRule="evenodd"
                  d="M9.344 3.071a49.52 49.52 0 015.312 0c.967.052 1.83.585 2.332 1.39l.821 1.317c.24.383.645.643 1.11.71.386.054.77.113 1.152.177 1.432.239 2.429 1.493 2.429 2.909V18a3 3 0 01-3 3h-15a3 3 0 01-3-3V9.574c0-1.416.997-2.67 2.429-2.909.382-.064.766-.123 1.151-.178a1.56 1.56 0 001.11-.71l.822-1.315a2.942 2.942 0 012.332-1.39zM6.75 12.75a5.25 5.25 0 1110.5 0 5.25 5.25 0 01-10.5 0zm12-1.5a.75.75 0 100 1.5.75.75 0 000-1.5z"
                  clipRule="evenodd"
                />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                width="16"
                height="16"
              >
                <path d="M11.644 1.59a.75.75 0 01.712 0l9.75 5.25a.75.75 0 010 1.32l-9.75 5.25a.75.75 0 01-.712 0l-9.75-5.25a.75.75 0 010-1.32l9.75-5.25z" />
                <path d="M3.265 10.602l7.668 4.129a2.25 2.25 0 002.134 0l7.668-4.13 1.37.739a.75.75 0 010 1.32l-9.75 5.25a.75.75 0 01-.71 0l-9.75-5.25a.75.75 0 010-1.32l1.37-.738z" />
                <path d="M10.933 19.231l-7.668-4.13-1.37.739a.75.75 0 000 1.32l9.75 5.25c.221.12.489.12.71 0l9.75-5.25a.75.75 0 000-1.32l-1.37-.738-7.668 4.13a2.25 2.25 0 01-2.134-.001z" />
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
        <div className="flex items-center justify-center h-full text-white">
          <p>Lade Anwendungen...</p>
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
          showOnlyShortcuts={true}
        />
      )}
    </div>
  );
};

export default App;
