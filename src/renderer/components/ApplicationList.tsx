import React, { useState, useEffect, useRef } from "react";
import { ipcRenderer } from "electron";
import { ProcessInfo, Theme, ApplicationListProps } from "../../types";
import ProcessTree from "./ProcessTree";

// New component for group input with color selection
const NewGroupInput = ({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string, color?: string) => void;
  onCancel: () => void;
}) => {
  const [name, setName] = useState("");
  const [selectedColor, setSelectedColor] = useState("#78d97c"); // Default grün
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const colorOptions = [
    "#78d97c", // Grün (Standard)
    "#3b82f6", // Blau
    "#ef4444", // Rot
    "#f59e0b", // Orange
    "#8b5cf6", // Lila
    "#ec4899", // Pink
    "#14b8a6", // Türkis
    "#f97316", // Helleres Orange
    "#facc15", // Gelb
  ];

  // Click outside handler
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        onCancel();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [onCancel]);

  // Focus the input when component mounts
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim()) {
      onAdd(name, selectedColor);
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div ref={containerRef} className="group-input-container browser-style">
      <input
        ref={inputRef}
        type="text"
        className="group-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Gruppe benennen"
        autoFocus
      />
      <div className="color-options">
        {colorOptions.map((color) => (
          <div
            key={color}
            className={`color-option ${
              selectedColor === color ? "selected" : ""
            }`}
            style={{ backgroundColor: color }}
            onClick={() => setSelectedColor(color)}
          />
        ))}
      </div>
    </div>
  );
};

const ApplicationList: React.FC<ApplicationListProps> = ({
  applications,
  themes,
  activeTheme,
  activeThemes = [],
  onAddToTheme,
  onRemoveFromTheme,
  onUpdateTheme,
  onToggleActiveTheme,
  compactMode = false,
  showOnlyShortcuts = false,
}) => {
  const [draggedApp, setDraggedApp] = useState<number | null>(null);
  const [draggedOverTheme, setDraggedOverTheme] = useState<string | null>(null);
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
  const [currentShortcut, setCurrentShortcut] = useState<string>("");
  const [showProcessPopup, setShowProcessPopup] = useState<string | null>(null);
  const [selectedProcessIds, setSelectedProcessIds] = useState<
    Array<number | string>
  >([]);

  // Debug-Ausgabe der empfangenen Anwendungsliste
  useEffect(() => {
    console.log(
      "ApplicationList - Eingegangene Anwendungen:",
      applications?.length || 0,
      JSON.stringify(applications?.slice(0, 3), null, 2),
      applications?.length > 3 ? "... und weitere" : ""
    );
  }, [applications]);

  // Filtere die Anwendungen, um nur die zu zeigen, die keiner Gruppe zugeordnet sind
  const unassignedApplications = applications
    .map((app) => {
      // Rekursive Funktion zum Filtern von Unterprozessen
      const filterAssignedApps = (
        currentApp: ProcessInfo
      ): ProcessInfo | null => {
        // Prüfe, ob die aktuelle App in einer Gruppe ist
        const isAssigned = themes.some((theme) =>
          theme.applications.includes(currentApp.id)
        );
        if (isAssigned) return null;

        // Wenn die App Kinder hat, filtere diese rekursiv
        if (currentApp.children && currentApp.children.length > 0) {
          const filteredChildren = currentApp.children
            .map((child) => filterAssignedApps(child))
            .filter((child): child is ProcessInfo => child !== null);

          // Wenn nach dem Filtern noch Kinder übrig sind, gib die App mit gefilterten Kindern zurück
          if (filteredChildren.length > 0) {
            return {
              ...currentApp,
              children: filteredChildren,
            };
          }
          // Wenn keine Kinder mehr übrig sind und die App selbst nicht zugeordnet ist,
          // zeige sie ohne children an
          else if (!isAssigned) {
            return {
              ...currentApp,
              children: undefined,
            };
          }
        }

        // Wenn die App keine Kinder hat und nicht zugeordnet ist, zeige sie an
        return isAssigned ? null : currentApp;
      };

      // Filtere die App und ihre Unterprozesse
      return filterAssignedApps(app);
    })
    .filter((app): app is ProcessInfo => app !== null);

  const isApplicationInTheme = (
    themeId: string,
    applicationId: number
  ): boolean => {
    const theme = themes.find((t) => t.id === themeId);
    return theme ? theme.applications.includes(applicationId) : false;
  };

  const handleDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    appId: number
  ) => {
    setDraggedApp(appId);
    const app = applications.find((a) => a.id === appId);
    if (app) {
      e.dataTransfer.setData("text/plain", app.title);
      e.dataTransfer.effectAllowed = "move";

      // Verbesserte visuelle Darstellung beim Ziehen
      const element = e.currentTarget;
      element.classList.add("dragging");
    }
  };

  const handleDragEnd = (e: React.DragEvent<HTMLDivElement>) => {
    e.currentTarget.classList.remove("dragging");
    setDraggedOverTheme(null);
    setDraggedApp(null);
  };

  const handleDragOver = (
    e: React.DragEvent<HTMLDivElement>,
    themeId: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = "move";
    setDraggedOverTheme(themeId);
  };

  const handleDragLeave = () => {
    setDraggedOverTheme(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, themeId: string) => {
    e.preventDefault();
    const appIdStr = e.dataTransfer.getData("application");

    // Check if we have a valid application ID
    if (appIdStr && onAddToTheme) {
      // Handle window IDs (prefixed with 'w') and process IDs
      if (appIdStr.startsWith("w")) {
        // This is a window handle - we need to extract the hwnd and get window info
        const hwnd = parseInt(appIdStr.substring(1));

        // Find the window in the applications list
        let windowInfo = null;
        for (const app of applications) {
          if (app.windows) {
            const foundWindow = app.windows.find((w) => w.hwnd === hwnd);
            if (foundWindow) {
              windowInfo = foundWindow;
              break;
            }
          }
        }

        if (windowInfo) {
          // Call the IPC directly to ensure window is properly saved
          ipcRenderer.invoke("add-windows-to-theme", themeId, [windowInfo]);

          // Also update the UI state
          onAddToTheme(themeId, hwnd);
        }
      } else {
        // This is a process ID - handle it normally
        const appId = parseInt(appIdStr);
        onAddToTheme(themeId, appId);
      }
    }

    setDraggedOverTheme(null);
  };

  const createNewGroup = (groupName: string, color: string = "#78d97c") => {
    // Create a new theme with a unique timestamp-based ID
    const themeId = `theme_${Date.now()}`;

    const newTheme = {
      id: themeId,
      name: groupName.trim(),
      applications: [],
      shortcut: "",
      color: color, // Speichere die ausgewählte Farbe
    };

    // Dispatch event to add the new theme
    window.dispatchEvent(new CustomEvent("addTheme", { detail: newTheme }));

    // Hide the input
    setShowNewGroupInput(false);
  };

  // Shortcut-Funktionen
  const startEditingShortcut = (themeId: string) => {
    const theme = themes.find((t) => t.id === themeId);
    setEditingShortcut(themeId);
    setCurrentShortcut(theme?.shortcut || "");
  };

  const handleShortcutSave = (themeId: string, currentShortcut: string) => {
    const theme = themes.find((t) => t.id === themeId);
    if (theme && onUpdateTheme) {
      onUpdateTheme({
        ...theme,
        shortcut: currentShortcut,
      });
    }
  };

  const handleShortcutKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Verarbeite Tastenkombinationen für alle Tasten außer Enter (das wird nur zum Bestätigen verwendet)
    if (e.key !== "Enter") {
      e.preventDefault();
      e.stopPropagation();

      // Ignoriere reine Modifier-Tasten
      if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) {
        return;
      }

      // Baue den Shortcut-String
      let shortcut = "";
      if (e.ctrlKey) shortcut += "Ctrl+";
      if (e.altKey) shortcut += "Alt+";
      if (e.shiftKey) shortcut += "Shift+";
      if (e.metaKey) shortcut += "Meta+";

      // Taste mit besonderem Format für spezielle Tasten
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key;
      shortcut += key;

      // Aktualisiere den Shortcut
      setCurrentShortcut(shortcut);
    }

    // Speichern beim Drücken von Enter
    if (e.key === "Enter" && editingShortcut) {
      e.preventDefault();
      e.stopPropagation();

      if (onUpdateTheme) {
        const theme = themes.find((t) => t.id === editingShortcut);
        if (theme) {
          onUpdateTheme({
            ...theme,
            shortcut: currentShortcut,
          });
        }
      }

      // Registriere den Shortcut sofort beim Main-Prozess
      if (editingShortcut && currentShortcut) {
        ipcRenderer.invoke("register-shortcut", {
          themeId: editingShortcut,
          shortcut: currentShortcut,
        });
      }

      // Warte kurz mit dem Beenden des Edit-Modus
      setTimeout(() => {
        setEditingShortcut(null);
      }, 10);
    }
  };

  // Add this function to handle theme activation via clicking
  const handleThemeClick = (e: React.MouseEvent, themeId: string) => {
    e.preventDefault();
    if (onToggleActiveTheme) {
      onToggleActiveTheme(themeId);
    }
  };

  // In der ApplicationList-Komponente fügen wir eine Löschfunktion hinzu
  const handleDeleteTheme = (e: React.MouseEvent, themeId: string) => {
    e.stopPropagation(); // Verhindern, dass der Theme-Click ausgelöst wird

    // Direkt löschen ohne Bestätigungsdialog
    window.dispatchEvent(new CustomEvent("deleteTheme", { detail: themeId }));
  };

  // Process popup handling
  const handleShowProcesses = (e: React.MouseEvent, themeId: string) => {
    e.stopPropagation();
    setShowProcessPopup(themeId);
  };

  const handleCloseProcessPopup = () => {
    setShowProcessPopup(null);
  };

  const handleRemoveFromThemeClick = (
    themeId: string,
    processId: number | string
  ) => {
    if (onRemoveFromTheme) {
      onRemoveFromTheme(themeId, processId);
    }
  };

  const handleProcessSelect = (processId: number | string) => {
    setSelectedProcessIds((prev) =>
      prev.includes(processId)
        ? prev.filter((id) => id !== processId)
        : [...prev, processId]
    );
  };

  // Render process popup
  const renderProcessPopup = () => {
    if (!showProcessPopup) return null;

    const theme = themes.find((t) => t.id === showProcessPopup);
    if (!theme) return null;

    const themeProcesses = applications.filter((app) =>
      theme.applications.includes(app.id)
    );

    return (
      <div className="process-popup-overlay" onClick={handleCloseProcessPopup}>
        <div className="process-popup" onClick={(e) => e.stopPropagation()}>
          <div className="process-popup-header">
            <div className="process-popup-title">Prozesse in {theme.name}</div>
            <button
              className="process-popup-close"
              onClick={handleCloseProcessPopup}
            >
              ×
            </button>
          </div>
          <div className="process-popup-content">
            <div className="popup-process-list">
              {themeProcesses.map((process) => (
                <div key={process.id} className="popup-process-item">
                  <span>{process.title || process.name}</span>
                  <span
                    className="popup-process-remove"
                    onClick={(e) =>
                      handleRemoveFromThemeClick(theme.id, process.id)
                    }
                  >
                    ×
                  </span>
                </div>
              ))}
              {themeProcesses.length === 0 && (
                <div className="text-gray-400 text-center py-4">
                  Keine Prozesse in dieser Gruppe
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="application-list">
      {/* Gruppen-Sektion */}
      <section className="groups-section">
        {!showOnlyShortcuts && (
          <h2 className="groups-title font-extrabold">
            GRUPPEN
            <button
              className="add-group-button"
              onClick={() => {
                console.log(
                  "Add group button clicked, current showNewGroupInput:",
                  showNewGroupInput
                );
                console.log("Setting showNewGroupInput to true");
                setShowNewGroupInput(true);
              }}
              title="Neue Gruppe erstellen"
            >
              +
            </button>
          </h2>
        )}
        <div className="groups-container">
          {/* Display a new group input at the beginning of the container */}
          {showNewGroupInput && !showOnlyShortcuts && (
            <NewGroupInput
              onAdd={(name, color) => {
                createNewGroup(name, color);
              }}
              onCancel={() => {
                setShowNewGroupInput(false);
              }}
            />
          )}

          {/* Vorhandene Gruppen anzeigen */}
          {showOnlyShortcuts ? (
            <div
              className={`flex flex-wrap justify-center items-start gap-2 p-2 ${
                compactMode ? "compact-mode" : ""
              }`}
            >
              {themes.map((theme) => (
                <div
                  key={theme.id}
                  className="group-item relative flex flex-col items-center justify-center transition-all border border-gray-700"
                  style={{
                    borderColor: theme.color,
                    boxShadow: compactMode
                      ? `0 0 10px ${theme.color}40`
                      : "none",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onToggleActiveTheme) {
                      onToggleActiveTheme(theme.id);
                    }
                  }}
                >
                  {theme.shortcut && (
                    <div
                      className="shortcut-badge text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onToggleActiveTheme) {
                          onToggleActiveTheme(theme.id);
                        }
                      }}
                    >
                      {theme.shortcut}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            themes.map((theme) => {
              const isOver = draggedOverTheme === theme.id;
              const isActive = activeThemes.includes(theme.id);

              // Bestimme die Farb-CSS-Klasse basierend auf dem Farbwert des Themes
              const getColorClass = (color?: string) => {
                if (!color) return "group-item-green"; // Standardfarbe

                const colorMap: { [key: string]: string } = {
                  "#78d97c": "group-item-green",
                  "#3b82f6": "group-item-blue",
                  "#ef4444": "group-item-red",
                  "#f59e0b": "group-item-orange",
                  "#8b5cf6": "group-item-purple",
                  "#ec4899": "group-item-pink",
                  "#14b8a6": "group-item-teal",
                  "#f97316": "group-item-orange-light",
                  "#facc15": "group-item-yellow",
                };

                return colorMap[color] || "group-item-green";
              };

              return (
                <div
                  key={theme.id}
                  className={`group-item ${getColorClass(theme.color)} ${
                    isActive ? "group-item-selected" : ""
                  } ${isOver ? "group-item-active-drop" : ""}`}
                  onDragOver={(e) => handleDragOver(e, theme.id)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, theme.id)}
                  onClick={(e) => handleThemeClick(e, theme.id)}
                >
                  {/* Action Buttons */}
                  <div className="group-action-buttons">
                    <button
                      className="group-action-button show-processes"
                      onClick={(e) => handleShowProcesses(e, theme.id)}
                      title="Prozesse anzeigen"
                    >
                      •••
                    </button>
                    <button
                      className="group-action-button delete"
                      onClick={(e) => handleDeleteTheme(e, theme.id)}
                      title="Gruppe löschen"
                    >
                      ×
                    </button>
                  </div>
                  <div className="group-item-content">
                    {!showOnlyShortcuts && (
                      <div className="group-item-name">
                        {theme.name} ({theme.applications.length})
                      </div>
                    )}
                    <div className="group-item-actions">
                      {editingShortcut === theme.id ? (
                        <div
                          className="shortcut-editor"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                          }}
                        >
                          <input
                            type="text"
                            className="shortcut-input"
                            value={currentShortcut}
                            onChange={(e) => setCurrentShortcut(e.target.value)}
                            onKeyDown={handleShortcutKeyDown}
                            placeholder="Tastenkombination drücken"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                            autoFocus
                          />
                        </div>
                      ) : (
                        <div
                          className={`shortcut-badge ${
                            showOnlyShortcuts ? "shortcut-badge-only" : ""
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            startEditingShortcut(theme.id);
                          }}
                          title={
                            showOnlyShortcuts
                              ? theme.name
                              : "Shortcut bearbeiten"
                          }
                        >
                          {theme.shortcut ||
                            (showOnlyShortcuts
                              ? theme.name
                              : "Shortcut hinzufügen")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* Im kompakten Modus oder nur-Shortcuts-Modus blenden wir die Prozesse aus */}
      {!compactMode && !showOnlyShortcuts && (
        <>
          {/* Trennlinie zwischen Gruppen und Prozesse */}
          <div className="section-divider"></div>

          {/* Prozesse-Sektion */}
          <section className="processes-section">
            <h2 className="processes-title font-extrabold">PROZESSE</h2>

            <div className="process-list">
              {unassignedApplications.length > 0 ? (
                unassignedApplications.map((process) => (
                  <ProcessTree
                    key={process.id}
                    processes={[process]}
                    selectedProcessIds={new Set(selectedProcessIds)}
                    onProcessClick={(p) => handleProcessSelect(p.id)}
                  />
                ))
              ) : (
                <div className="no-processes">
                  Alle Prozesse sind Gruppen zugeordnet
                </div>
              )}
            </div>
          </section>
        </>
      )}
      {renderProcessPopup()}
    </div>
  );
};

export default ApplicationList;
