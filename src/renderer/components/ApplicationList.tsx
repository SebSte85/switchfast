import React, { useState, useEffect } from "react";
import { ipcRenderer } from "electron";

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

interface ApplicationListProps {
  applications: ProcessInfo[];
  themes: Theme[];
  activeTheme: string | null;
  onAddToTheme: (themeId: string, applicationId: number) => void;
  onRemoveFromTheme: (themeId: string, applicationId: number) => void;
}

const ApplicationList: React.FC<ApplicationListProps> = ({
  applications,
  themes,
  activeTheme,
  onAddToTheme,
  onRemoveFromTheme,
}) => {
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [filteredApps, setFilteredApps] = useState<ProcessInfo[]>([]);
  const [showThemeAppsOnly, setShowThemeAppsOnly] = useState<boolean>(false);

  // Debug-Ausgabe der empfangenen Anwendungsliste
  useEffect(() => {
    console.log(
      "ApplicationList - Eingegangene Anwendungen:",
      applications?.length || 0,
      JSON.stringify(applications?.slice(0, 3), null, 2),
      applications?.length > 3 ? "... und weitere" : ""
    );
  }, [applications]);

  // Filtere Anwendungen basierend auf der Suche und aktivem Theme
  useEffect(() => {
    let filtered = applications;

    // Suchtermfilter
    if (searchTerm) {
      filtered = filtered.filter(
        (app) =>
          app.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          app.title.toLowerCase().includes(searchTerm.toLowerCase())
      );
    }

    // Filter nach Theme-Zugehörigkeit
    if (showThemeAppsOnly && activeTheme) {
      filtered = filtered.filter(
        (app) =>
          themes
            .find((t) => t.id === activeTheme)
            ?.applications.includes(app.id) || false
      );
    }

    setFilteredApps(filtered);
  }, [applications, searchTerm, activeTheme, showThemeAppsOnly, themes]);

  const isApplicationInActiveTheme = (applicationId: number): boolean => {
    if (!activeTheme) return false;

    const theme = themes.find((t) => t.id === activeTheme);
    return theme ? theme.applications.includes(applicationId) : false;
  };

  const handleToggleApplication = (applicationId: number) => {
    if (!activeTheme) return;

    if (isApplicationInActiveTheme(applicationId)) {
      onRemoveFromTheme(activeTheme, applicationId);
    } else {
      onAddToTheme(activeTheme, applicationId);
    }
  };

  return (
    <div className="application-list">
      <div className="application-list-header">
        <div className="search-container">
          <input
            type="text"
            placeholder="Anwendungen suchen..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="search-input"
          />
          <div className="filter-toggle">
            <input
              type="checkbox"
              id="theme-filter"
              checked={showThemeAppsOnly}
              onChange={() => setShowThemeAppsOnly(!showThemeAppsOnly)}
              className="filter-checkbox"
              disabled={!activeTheme}
            />
            <label htmlFor="theme-filter" className="filter-label">
              Nur Theme-Anwendungen anzeigen
            </label>
          </div>
        </div>
      </div>

      {filteredApps.length === 0 ? (
        <div className="no-applications">
          {applications.length === 0
            ? "Keine laufenden Anwendungen gefunden."
            : "Keine Anwendungen entsprechen deiner Suche."}
        </div>
      ) : (
        <div className="application-items">
          {filteredApps.map((app) => {
            const isInTheme =
              (activeTheme &&
                themes
                  .find((t) => t.id === activeTheme)
                  ?.applications.includes(app.id)) ||
              false;
            return (
              <div
                key={app.id}
                className={`application-item ${
                  isInTheme ? "in-active-theme" : ""
                }`}
              >
                <div className="application-name">{app.title}</div>
                <div className="application-controls">
                  {activeTheme && (
                    <button
                      className="toggle-button"
                      onClick={() => handleToggleApplication(app.id)}
                    >
                      {isInTheme ? "Entfernen" : "Hinzufügen"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="info-message">
        {activeTheme ? (
          <p>
            Klicke auf eine Anwendung, um sie dem aktiven Theme hinzuzufügen
            oder zu entfernen
          </p>
        ) : (
          <p>Wähle ein Theme aus, um Anwendungen hinzuzufügen</p>
        )}
      </div>
    </div>
  );
};

export default ApplicationList;
