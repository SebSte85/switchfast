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
      if (event.detail) {
        handleAddTheme(event.detail);
      }
    };

    window.addEventListener("addTheme", handleAddThemeEvent);
    return () => {
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
      // Theme aktivieren
      setActiveTheme(themeId);
      setFocusModeActive(true);

      // Alle anderen Anwendungen minimieren
      applyFocusMode(themeId, true);

      console.log(
        `Theme ${themeId} durch Shortcut aktiviert und andere Apps minimiert`
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
    setThemes([...themes, newTheme]);
  };

  // Theme löschen
  const handleDeleteTheme = (themeId: string) => {
    setThemes(themes.filter((theme) => theme.id !== themeId));
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

  // Aktiviere Theme
  const handleActivateTheme = (themeId: string | null) => {
    setActiveTheme(themeId);
    if (focusModeActive && themeId) {
      applyFocusMode(themeId, true);
    }
  };

  // Focus Mode umschalten
  const toggleFocusMode = () => {
    console.log("Focus Mode Toggle: ", !focusModeActive);

    if (!activeTheme) {
      console.log("Kein aktives Theme ausgewählt.");
      return;
    }

    setFocusModeActive(!focusModeActive);
    applyFocusMode(activeTheme, !focusModeActive);
  };

  // Focus Mode anwenden
  const applyFocusMode = async (themeId: string, active: boolean) => {
    if (!active) {
      console.log("Focus Mode deaktiviert");
      return;
    }

    const theme = themes.find((t) => t.id === themeId);
    if (!theme) {
      console.error(`Theme mit ID ${themeId} nicht gefunden`);
      return;
    }

    console.log(
      `Focus Mode für Theme "${theme.name}" (ID: ${themeId}) aktiviert`
    );
    console.log(`Anwendungen in dieser Gruppe: ${theme.applications.length}`);

    if (theme.applications.length === 0) {
      // Zeige dem Benutzer einen Hinweis, dass keine Apps in der Gruppe sind
      alert(
        "Diese Gruppe enthält keine Anwendungen. Füge mindestens eine Anwendung hinzu, damit der Focus-Modus funktioniert."
      );
      console.log("Keine Anwendungen in dieser Gruppe, nichts zu minimieren");
      return;
    }

    try {
      // Neue Methode: "Show Desktop" und dann Apps wiederherstellen
      console.log("Sende Anfrage für 'Show Desktop except Apps'...");
      const success = await ipcRenderer.invoke(
        "show-desktop-except",
        theme.applications
      );

      if (success) {
        console.log("'Show Desktop'-Funktion erfolgreich ausgeführt");
      } else {
        console.warn("Problem beim Ausführen der 'Show Desktop'-Funktion");

        // Fallback auf die alten Methoden, falls die neue nicht funktioniert
        fallbackFocusMode(theme);
      }
    } catch (error) {
      console.error(
        "Fehler beim Ausführen der 'Show Desktop'-Funktion:",
        error
      );

      // Fallback auf die alten Methoden, falls die neue nicht funktioniert
      fallbackFocusMode(theme);
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
          onAddToTheme={handleAddToTheme}
          onRemoveFromTheme={handleRemoveFromTheme}
          onUpdateTheme={handleUpdateTheme}
        />
      )}
    </div>
  );
};

export default App;
