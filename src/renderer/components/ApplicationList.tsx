import React, { useState, useEffect, useRef } from "react";
import { ipcRenderer } from "electron";
import { ProcessInfo, Theme, ApplicationListProps } from "../../types";

// New component for group input
const NewGroupInput = ({
  onAdd,
  onCancel,
}: {
  onAdd: (name: string) => void;
  onCancel: () => void;
}) => {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the input when component mounts
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
    }
  }, []);

  console.log("NewGroupInput rendered with name:", name);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    console.log("NewGroupInput keyDown:", e.key);
    if (e.key === "Enter" && name.trim()) {
      console.log("NewGroupInput Enter pressed, calling onAdd with:", name);
      onAdd(name);
    } else if (e.key === "Escape") {
      console.log("NewGroupInput Escape pressed, calling onCancel");
      onCancel();
    }
  };

  return (
    <div className="group-item group-input-container">
      <input
        ref={inputRef}
        type="text"
        className="group-input"
        value={name}
        onChange={(e) => {
          console.log("NewGroupInput input changed to:", e.target.value);
          setName(e.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder="Gruppenname"
      />
      <div className="group-input-buttons">
        <button
          className="group-input-save"
          onClick={() => {
            console.log("NewGroupInput save button clicked with name:", name);
            if (name.trim()) onAdd(name);
          }}
          disabled={!name.trim()}
        >
          ✓
        </button>
        <button
          className="group-input-cancel"
          onClick={() => {
            console.log("NewGroupInput cancel button clicked");
            onCancel();
          }}
        >
          ✕
        </button>
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
  const unassignedApplications = applications.filter((app) => {
    // Prüfe, ob diese Anwendung in irgendeiner Gruppe vorkommt
    return !themes.some((theme) => theme.applications.includes(app.id));
  });

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

  const createNewGroup = (groupName: string) => {
    console.log("createNewGroup called with name:", groupName);

    // Create a new theme with a unique timestamp-based ID
    const themeId = `theme_${Date.now()}`;
    console.log("Generated new theme ID:", themeId);

    const newTheme = {
      id: themeId,
      name: groupName.trim(),
      applications: [],
      shortcut: "",
    };

    console.log("Created new theme object:", newTheme);

    // Dispatch event to add the new theme
    console.log("Dispatching addTheme event with theme:", newTheme);
    window.dispatchEvent(new CustomEvent("addTheme", { detail: newTheme }));

    // Hide the input
    console.log("Setting showNewGroupInput to false");
    setShowNewGroupInput(false);
  };

  // Shortcut-Funktionen
  const startEditingShortcut = (themeId: string) => {
    const theme = themes.find((t) => t.id === themeId);
    setEditingShortcut(themeId);
    setCurrentShortcut(theme?.shortcut || "");
  };

  const saveShortcut = (themeId: string) => {
    if (onUpdateTheme && themeId) {
      onUpdateTheme(themeId, { shortcut: currentShortcut });

      // Registriere Shortcut beim Main-Prozess
      if (currentShortcut) {
        ipcRenderer.invoke("register-shortcut", {
          themeId,
          shortcut: currentShortcut,
        });
      } else {
        // Wenn Shortcut leer ist, deregistriere ihn
        ipcRenderer.invoke("unregister-shortcut", { themeId });
      }
    }
    setEditingShortcut(null);
  };

  const handleShortcutKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    // Wir erfassen Strg, Alt, Shift und normale Tasten
    const modifiers = [];
    if (e.ctrlKey) modifiers.push("Ctrl");
    if (e.altKey) modifiers.push("Alt");
    if (e.shiftKey) modifiers.push("Shift");

    // Beachte: Hier wollen wir nur echte Tasten und keine Modifizierer
    if (e.key !== "Control" && e.key !== "Alt" && e.key !== "Shift") {
      const key = e.key === " " ? "Space" : e.key;

      // Erstelle Shortcut-String (z.B. "Ctrl+Alt+S")
      const shortcut = [...modifiers, key].join("+");
      setCurrentShortcut(shortcut);

      // Wenn Enter gedrückt wird, speichere den Shortcut
      if (e.key === "Enter" && editingShortcut) {
        saveShortcut(editingShortcut);
      }

      // Escape drücken bricht die Bearbeitung ab
      if (e.key === "Escape") {
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

  return (
    <div className="application-list">
      {/* Gruppen-Sektion */}
      <section className="groups-section">
        <h2 className="groups-title">
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
        <div className="groups-container">
          {/* Display a new group input at the beginning of the container */}
          {showNewGroupInput && (
            <NewGroupInput
              onAdd={(name) => {
                console.log("NewGroupInput onAdd called with name:", name);
                createNewGroup(name);
              }}
              onCancel={() => {
                console.log("NewGroupInput onCancel called");
                console.log("Setting showNewGroupInput to false");
                setShowNewGroupInput(false);
              }}
            />
          )}

          {/* Vorhandene Gruppen anzeigen */}
          {themes.map((theme) => (
            <div
              key={theme.id}
              className={`group-item ${
                theme.name.toLowerCase().includes("arbeit")
                  ? "group-item-work"
                  : "group-item-project"
              } ${
                draggedOverTheme === theme.id ? "group-item-active-drop" : ""
              } ${
                activeThemes.includes(theme.id) ? "group-item-selected" : ""
              }`}
              onClick={(e) => handleThemeClick(e, theme.id)}
              onDragOver={(e) => handleDragOver(e, theme.id)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleThemeDrop(e, theme.id)}
            >
              <div className="group-item-content">
                <div className="group-item-name">
                  {theme.name} ({theme.applications.length})
                  {activeThemes.includes(theme.id) && (
                    <span className="group-active-indicator">✓</span>
                  )}
                </div>
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
                      <button
                        className="shortcut-save"
                        onClick={() => saveShortcut(theme.id)}
                        title="Shortcut speichern"
                      >
                        ✓
                      </button>
                      <button
                        className="shortcut-cancel"
                        onClick={() => setEditingShortcut(null)}
                        title="Abbrechen"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div
                      className="shortcut-badge"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEditingShortcut(theme.id);
                      }}
                      title="Shortcut bearbeiten"
                    >
                      {theme.shortcut || "Shortcut hinzufügen"}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Prozesse-Sektion */}
      <section className="processes-section">
        <h2 className="processes-title">PROZESSE</h2>

        <div className="process-list">
          {unassignedApplications.length > 0 ? (
            unassignedApplications.map((app) => (
              <div
                key={app.id}
                className="process-item"
                draggable
                onDragStart={(e) => handleDragStart(e, app.id)}
                onDragEnd={handleDragEnd}
              >
                <div className="process-name">{app.title}</div>
                <div
                  className="process-drag-handle"
                  title="Ziehen, um zur Gruppe hinzuzufügen"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="drag-handle-icon"
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="8" y1="6" x2="16" y2="6"></line>
                    <line x1="8" y1="12" x2="16" y2="12"></line>
                    <line x1="8" y1="18" x2="16" y2="18"></line>
                  </svg>
                </div>
              </div>
            ))
          ) : (
            <div className="no-processes">
              Alle Prozesse sind Gruppen zugeordnet
            </div>
          )}
        </div>
      </section>
    </div>
  );
};

export default ApplicationList;
