import React, { useState, useEffect } from "react";
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
}

interface Theme {
  id: string;
  name: string;
  applications: number[];
  shortcut: string;
}

const App: React.FC = () => {
  const [applications, setApplications] = useState<ProcessInfo[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [activeThemes, setActiveThemes] = useState<string[]>([]);
  const [focusModeActive, setFocusModeActive] = useState(false);
  const [loading, setLoading] = useState(true);

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
      console.log(
        "App - handleAddThemeEvent called with event detail:",
        event.detail
      );
      if (event.detail) {
        console.log("App - Calling handleAddTheme with theme:", event.detail);
        handleAddTheme(event.detail);
      }
    };

    console.log("App - Adding addTheme event listener");
    window.addEventListener("addTheme", handleAddThemeEvent);
    return () => {
      console.log("App - Removing addTheme event listener");
      window.removeEventListener("addTheme", handleAddThemeEvent);
    };
  }, []);

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
      console.log("Aktiviere Theme:", themeId);
      console.log("Aktuelle aktive Themes:", activeThemes);

      // Ersetze alle aktiven Themes durch das neue Theme
      setActiveThemes([themeId]);

      // For backward compatibility
      setActiveTheme(themeId);
      setFocusModeActive(true);

      // Alle anderen Anwendungen minimieren
      applyFocusMode(themeId, true);

      console.log(
        `Theme ${themeId} durch Shortcut aktiviert, alle anderen Themes deaktiviert`
      );
    };

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
  }, [themes, applications]);

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

  // Theme hinzufügen
  const handleAddTheme = (newTheme: Theme) => {
    console.log("App - handleAddTheme called with newTheme:", newTheme);
    console.log("App - Current themes:", themes);

    // Ensure we have a unique ID by using the current timestamp if not provided
    const themeToAdd = {
      ...newTheme,
      id: newTheme.id || Date.now().toString(),
      shortcut: newTheme.shortcut || "",
    };

    console.log("App - Prepared themeToAdd:", themeToAdd);

    // Check if a theme with this ID already exists
    const themeExists = themes.some((theme) => theme.id === themeToAdd.id);
    console.log("App - Theme with this ID exists?", themeExists);

    if (themeExists) {
      // Generate a new unique ID to avoid conflicts
      themeToAdd.id = Date.now().toString();
      console.log("App - Generated new ID to avoid conflict:", themeToAdd.id);
    }

    // Add the new theme
    console.log("App - Adding new theme to state");
    setThemes((prevThemes) => {
      const newThemes = [...prevThemes, themeToAdd];
      console.log("App - New themes state will be:", newThemes);
      return newThemes;
    });
  };

  // Theme löschen
  const handleDeleteTheme = (themeId: string) => {
    setThemes(themes.filter((theme) => theme.id !== themeId));

    // Remove from active themes if it was active
    setActiveThemes((prev) => prev.filter((id) => id !== themeId));

    // For backward compatibility
    if (activeTheme === themeId) {
      setActiveTheme(null);
      setFocusModeActive(false);
    }
  };

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

  return (
    <div className="app-container-simple">
      {loading ? (
        <div className="loading">Lade Anwendungen...</div>
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
        />
      )}
    </div>
  );
};

export default App;
