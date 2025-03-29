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
  onUpdateTheme = () => {},
  onToggleActiveTheme = () => {},
  compactMode = false,
  showOnlyShortcuts = false,
}) => {
  const [draggedApp, setDraggedApp] = useState<number | null>(null);
  const [draggedOverTheme, setDraggedOverTheme] = useState<string | null>(null);
  const [showNewGroupInput, setShowNewGroupInput] = useState(false);
  const [editingShortcut, setEditingShortcut] = useState<string | null>(null);
  const [currentShortcut, setCurrentShortcut] = useState<string>("");

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

  const handleThemeDrop = (
    e: React.DragEvent<HTMLDivElement>,
    themeId: string
  ) => {
    e.preventDefault();
    if (draggedApp !== null) {
      if (!isApplicationInTheme(themeId, draggedApp)) {
        onAddToTheme(themeId, draggedApp);
      }
      setDraggedApp(null);
      setDraggedOverTheme(null);
    }
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

  const saveShortcut = (themeId: string) => {
    console.log("Saving shortcut:", themeId, currentShortcut);
    if (onUpdateTheme && themeId) {
      onUpdateTheme(themeId, { shortcut: currentShortcut });

      // Registriere Shortcut beim Main-Prozess
      if (currentShortcut) {
        console.log(
          "Registering shortcut with main process:",
          themeId,
          currentShortcut
        );
        ipcRenderer
          .invoke("register-shortcut", {
            themeId,
            shortcut: currentShortcut,
          })
          .then((result) => {
            console.log("Shortcut registration result:", result);
          })
          .catch((err) => {
            console.error("Error registering shortcut:", err);
          });
      } else {
        // Wenn Shortcut leer ist, deregistriere ihn
        console.log("Unregistering shortcut for theme:", themeId);
        ipcRenderer.invoke("unregister-shortcut", { themeId });
      }
    }
    setEditingShortcut(null);
  };

  const handleShortcutKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    console.log(
      "Shortcut key down event:",
      e.key,
      "ctrlKey:",
      e.ctrlKey,
      "altKey:",
      e.altKey,
      "shiftKey:",
      e.shiftKey
    );

    // Wir erfassen Strg, Alt, Shift und normale Tasten
    const modifiers = [];
    if (e.ctrlKey) modifiers.push("Ctrl");
    if (e.altKey) modifiers.push("Alt");
    if (e.shiftKey) modifiers.push("Shift");

    // Beachte: Hier wollen wir nur echte Tasten und keine Modifizierer
    if (e.key !== "Control" && e.key !== "Alt" && e.key !== "Shift") {
      let key = e.key === " " ? "Space" : e.key;

      // Konvertiere die Taste in Kleinbuchstaben, wenn es ein einzelner Buchstabe ist
      if (key.length === 1) {
        key = key.toLowerCase();
      }

      // Erstelle Shortcut-String (z.B. "Ctrl+n")
      const shortcut = [...modifiers, key].join("+");
      console.log("Setting current shortcut to:", shortcut);
      setCurrentShortcut(shortcut);

      // Wenn Enter gedrückt wird, speichere den Shortcut
      if (e.key === "Enter" && editingShortcut) {
        console.log(
          "Enter pressed, saving shortcut for theme:",
          editingShortcut
        );
        saveShortcut(editingShortcut);
      }

      // Escape drücken bricht die Bearbeitung ab
      if (e.key === "Escape") {
        console.log("Escape pressed, cancelling shortcut editing");
        setEditingShortcut(null);
      }
    }
  };

  // Add this function to handle theme activation via clicking
  const handleThemeClick = (e: React.MouseEvent, themeId: string) => {
    // If dragging, handle drop instead
    if (draggedApp !== null) {
      if (!isApplicationInTheme(themeId, draggedApp)) {
        onAddToTheme(themeId, draggedApp);
      }
      setDraggedApp(null);
      setDraggedOverTheme(null);
      return;
    }

    // Otherwise, toggle theme activation
    e.stopPropagation();
    onToggleActiveTheme(themeId);
  };

  // In der ApplicationList-Komponente fügen wir eine Löschfunktion hinzu
  const handleDeleteTheme = (e: React.MouseEvent, themeId: string) => {
    e.stopPropagation(); // Verhindern, dass der Theme-Click ausgelöst wird

    // Direkt löschen ohne Bestätigungsdialog
    window.dispatchEvent(new CustomEvent("deleteTheme", { detail: themeId }));
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
                    onToggleActiveTheme(theme.id);
                  }}
                >
                  {theme.shortcut && (
                    <div
                      className="shortcut-badge text-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleActiveTheme(theme.id);
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
                  onDrop={(e) => handleThemeDrop(e, theme.id)}
                  onClick={(e) => handleThemeClick(e, theme.id)}
                >
                  <div className="group-item-content">
                    {!showOnlyShortcuts && (
                      <div className="group-item-name">
                        {theme.name} ({theme.applications.length})
                      </div>
                    )}
                    <div className="group-item-actions">
                      {editingShortcut === theme.id ? (
                        <div className="shortcut-editor">
                          <input
                            type="text"
                            className="shortcut-input"
                            value={currentShortcut}
                            onChange={(e) => setCurrentShortcut(e.target.value)}
                            onKeyDown={handleShortcutKeyDown}
                            placeholder="Tastenkombination drücken"
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
                      {!showOnlyShortcuts && (
                        <button
                          className="delete-theme-button"
                          onClick={(e) => handleDeleteTheme(e, theme.id)}
                          title="Gruppe löschen"
                        >
                          ×
                        </button>
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
                <ProcessTree
                  processes={unassignedApplications}
                  onDragStart={handleDragStart}
                  onDragEnd={handleDragEnd}
                />
              ) : (
                <div className="no-processes">
                  Alle Prozesse sind Gruppen zugeordnet
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
};

export default ApplicationList;
