import React, { useState, useEffect } from "react";
import { ipcRenderer } from "electron";
import "./styles/index.css";
import Sidebar from "./components/Sidebar";
import Dashboard from "./components/Dashboard";
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
    if (!theme) return;

    // Bestimme, welche Anwendungen minimiert werden sollen
    const appsToMinimize = applications
      .filter((app) => !theme.applications.includes(app.id))
      .map((app) => app.id);

    console.log(`${appsToMinimize.length} Anwendungen werden minimiert`);
    if (appsToMinimize.length === 0) return;

    // Minimiere alle Anwendungen, die nicht zum aktiven Theme gehören
    try {
      const success = await ipcRenderer.invoke(
        "minimize-applications",
        appsToMinimize
      );
      console.log(
        success
          ? "Anwendungen erfolgreich minimiert"
          : "Fehler beim Minimieren der Anwendungen"
      );
    } catch (error) {
      console.error("Fehler beim Minimieren der Anwendungen:", error);
    }
  };

  return (
    <div className="app-container">
      <Sidebar
        themes={themes}
        activeTheme={activeTheme}
        onAddTheme={handleAddTheme}
        onDeleteTheme={handleDeleteTheme}
        onActivateTheme={handleActivateTheme}
        focusModeActive={focusModeActive}
        onToggleFocusMode={toggleFocusMode}
      />
      <div className="main-content">
        <Dashboard
          applicationCount={applications.length}
          themeCount={themes.length}
          activeTheme={
            activeTheme
              ? themes.find((t) => t.id === activeTheme) || null
              : null
          }
          focusModeActive={focusModeActive}
        />
        <div className="content-section">
          <h2>Application Management</h2>
          {loading ? (
            <div className="loading">Lade Anwendungen...</div>
          ) : (
            <ApplicationList
              applications={applications}
              themes={themes}
              activeTheme={activeTheme}
              onAddToTheme={handleAddToTheme}
              onRemoveFromTheme={handleRemoveFromTheme}
            />
          )}
        </div>
      </div>
    </div>
  );
};

export default App;
