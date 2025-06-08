import React, { useState, useEffect, useCallback, useRef } from "react";
import { ipcRenderer } from "electron";
import "./styles/index.css";
import "./styles/trial.css";
import ApplicationList from "./components/ApplicationList";
import Settings from "./components/Settings";
import { ProcessInfo, Theme, WindowInfo } from "../types";
import TrialManager from "./components/TrialManager";
import LicenseCheck from "./components/licensing/LicenseCheck";

const AppContent: React.FC<{ initialLoadingText?: string }> = ({
  initialLoadingText,
}) => {
  const [applications, setApplications] = useState<ProcessInfo[]>([]);
  const [themes, setThemes] = useState<Theme[]>([]);
  const [activeTheme, setActiveTheme] = useState<string | null>(null);
  const [activeThemes, setActiveThemes] = useState<string[]>([]);
  const [focusModeActive, setFocusModeActive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [shortcutsRegistered, setShortcutsRegistered] = useState(false);
  const [compactMode, setCompactMode] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  // Loading Screen Startzeitpunkt für Analytics
  const [loadingStartTime] = useState(() => Date.now());
  const startupEventTracked = useRef<boolean>(false);

  // Ladephasen mit angepassten Texten
  const loadingPhaseTexts = [
    initialLoadingText || "Searching for active licence...", // Phase 0: Lizenzprüfung
    "Initializing workspace...", // Phase 1: Initialer Ladevorgang
    "Starting your applications...", // Phase 2: Anwendungen werden gestartet
    "Registering shortcuts...", // Phase 3: Shortcuts werden registriert
    "Saving your settings...", // Phase 4: Einstellungen werden gespeichert
  ];

  // Refresh-Funktion mit useCallback
  const fetchApplications = useCallback(async () => {
    // Loading-State setzen - nur für manuelle Aktualisierungen
    setIsRefreshing(true);

    try {
      const apps = await ipcRenderer.invoke("get-running-applications");

      // Get all process IDs
      const runningAppIds = new Set(
        apps.flatMap((app: ProcessInfo) => {
          const ids = [app.id];
          if (app.children) {
            app.children.forEach((child: ProcessInfo) => {
              ids.push(child.id);
            });
          }
          return ids;
        })
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

      // Cleanup themes by removing only closed applications
      setThemes((prevThemes) => {
        const updatedThemes = prevThemes.map((theme) => {
          const filteredApps = theme.applications.filter((appId) => {
            const numericId =
              typeof appId === "string" ? parseInt(appId, 10) : appId;

            // Check if it's a window handle by checking if it exists in runningWindowIds
            const isWindowHandle = runningWindowIds.has(numericId);
            // Check if it's a process ID by checking if it exists in runningAppIds
            const isRunningApp = runningAppIds.has(numericId);

            // Keep the ID if it's either a valid window handle or a running process
            return isWindowHandle || isRunningApp;
          });

          return {
            ...theme,
            applications: filteredApps,
          };
        });

        return updatedThemes;
      });

      setApplications(apps || []);
      // Wir beenden den Ladezustand hier nicht mehr, da dies jetzt
      // in den Event-Handlern für apps-started gesteuert wird
      // Nur den Refresh-Status beenden
      setIsRefreshing(false);
    } catch (error) {
      console.error("[REFRESH] Error:", error);
      // Bei Fehlern den Ladezustand beenden, um die Anwendung nicht zu blockieren
      setIsRefreshing(false);
    }
  }, []); // Keine Abhängigkeit von themes mehr

  // Initial loading of applications
  useEffect(() => {
    // Starte mit der Lizenzprüfung (Phase 0)
    setLoadingPhase(0);

    // Nach 2 Sekunden zur nächsten Phase (Workspace-Initialisierung) wechseln
    const licenseCheckTimer = setTimeout(() => {
      setLoadingPhase(1);

      // Jetzt die eigentliche Initialisierung starten
      const loadInitialData = async () => {
        try {
          const apps = await ipcRenderer.invoke("get-running-applications");

          setApplications(apps || []);

          // Wechsle zur Phase 2 (Anwendungen starten)

          setLoadingPhase(2);

          // Lade gespeicherte Themes
          const savedThemes = await ipcRenderer.invoke("get-themes");
          if (savedThemes && savedThemes.length > 0) {
            setThemes(savedThemes);
          }

          // Prüfe, ob es persistente Anwendungen gibt, die gestartet werden müssen
          const hasPersistentApps =
            savedThemes &&
            savedThemes.some(
              (theme: Theme) =>
                theme.persistentProcesses &&
                theme.persistentProcesses.length > 0
            );

          // Wechsle zur Phase 3 (Shortcuts registrieren)

          setLoadingPhase(3);

          // Wenn keine persistenten Anwendungen vorhanden sind, beenden wir den Ladezustand sofort
          // Andernfalls wird der Ladezustand durch die IPC-Events gesteuert
          if (!hasPersistentApps) {
            // Kurze Verzögerung, damit der Benutzer die letzte Phase sehen kann
            setTimeout(() => {
              // Track app startup completion nur einmal
              if (!startupEventTracked.current) {
                startupEventTracked.current = true;
                const loadingDuration = Date.now() - loadingStartTime;
                ipcRenderer.invoke("track-app-startup-complete", {
                  startup_duration_ms: loadingDuration,
                  theme_count: savedThemes?.length || 0,
                });
              }
              setLoading(false);
            }, 1000);
          } else {
            // Ladezustand bleibt aktiv, bis apps-started Event empfangen wird
          }
        } catch (error) {
          console.error("Error loading initial data:", error);
          // Bei Fehlern den Ladezustand beenden, um die Anwendung nicht zu blockieren
          setLoading(false);
        }
      };

      loadInitialData();
    }, 2000); // 2 Sekunden für die Lizenzprüfung

    return () => clearTimeout(licenseCheckTimer);
  }, []);

  // Wir entfernen den Timer-Effekt und steuern stattdessen die Phasen durch die IPC-Events

  // Listener für das Starten von Anwendungen und Shortcut-Registrierung
  useEffect(() => {
    const handleAppStarting = () => {
      setLoading(true);
      // Setze die Phase auf 1 (zweiter Text), wenn der Ladevorgang beginnt
      setLoadingPhase(1);
    };

    const handleAppsStarted = () => {
      // Lade die Anwendungen neu, aber behalte den Ladezustand bei
      // bis die Anwendungen vollständig geladen sind und Shortcuts registriert sind
      const updateApps = async () => {
        try {
          const apps = await ipcRenderer.invoke("get-running-applications");
          setApplications(apps || []);

          // Setze die Phase auf 2 (dritter Text), für die Shortcut-Registrierung
          setLoadingPhase(2);

          // Wenn bereits Shortcuts registriert wurden, können wir den Ladezustand beenden
          if (shortcutsRegistered) {
            setLoading(false);
          }
        } catch (error) {
          setLoading(false);
        }
      };

      updateApps();
    };

    const handleShortcutsRegistered = () => {
      setShortcutsRegistered(true);
      // Wechsle zur letzten Phase (DataStore-Prozess)
      setLoadingPhase(4);
      // Wir beenden den Ladezustand nicht hier, sondern warten auf das themes-saved Event
    };

    const handleThemesSaved = () => {
      // Track app startup completion nur einmal - exakt die Zeit die der Loading Screen zu sehen war
      if (!startupEventTracked.current) {
        startupEventTracked.current = true;
        const loadingDuration = Date.now() - loadingStartTime;
        ipcRenderer.invoke("track-app-startup-complete", {
          startup_duration_ms: loadingDuration,
          theme_count: themes.length,
        });
      }

      // Jetzt erst den Ladezustand beenden, nachdem die Themes gespeichert wurden
      setLoading(false);
    };

    ipcRenderer.on("apps-starting", handleAppStarting);
    ipcRenderer.on("apps-started", handleAppsStarted);
    ipcRenderer.on("shortcuts-registered", handleShortcutsRegistered);
    ipcRenderer.on("themes-saved", handleThemesSaved);

    return () => {
      ipcRenderer.removeListener("apps-starting", handleAppStarting);
      ipcRenderer.removeListener("apps-started", handleAppsStarted);
      ipcRenderer.removeListener(
        "shortcuts-registered",
        handleShortcutsRegistered
      );
      ipcRenderer.removeListener("themes-saved", handleThemesSaved);
    };
  }, [shortcutsRegistered]);

  // Laden der laufenden Anwendungen und Refresh-Intervall
  useEffect(() => {
    // Anwendungen alle 5 Minuten aktualisieren
    const intervalId = setInterval(fetchApplications, 300000);
    return () => clearInterval(intervalId);
  }, [fetchApplications]);

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
    const handleActivateThemeAndMinimize = (
      _: any,
      themeId: string,
      freshTheme?: Theme
    ) => {
      setActiveThemes([themeId]);

      // For backward compatibility
      setActiveTheme(themeId);
      setFocusModeActive(true);

      // Alle anderen Anwendungen minimieren
      try {
        // Verwende das direkt mitgesendete Theme, wenn vorhanden
        if (freshTheme) {
          // Verwende direkt mitgesendetes Theme
          applyFocusMode(themeId, true, freshTheme);
        } else {
          applyFocusMode(themeId, true);
        }
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
    async (themeId: string) => {
      try {
        // Zuerst den IPC-Handler aufrufen, um das Theme im DataStore zu löschen
        const success = await ipcRenderer.invoke("delete-theme", themeId);

        if (success) {
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
        } else {
          console.error(`[UI] Theme ${themeId} konnte nicht gelöscht werden`);
        }
      } catch (error) {
        console.error(`[UI] Fehler beim Löschen des Themes ${themeId}:`, error);
      }
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
      // Zuerst den lokalen State aktualisieren
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

      // Dann den IPC-Handler aufrufen, um persistente Identifikatoren zu erstellen
      // Nur für numerische Prozess-IDs (keine Fenster-Handles)
      const numId = typeof appId === "string" ? parseInt(appId, 10) : appId;
      if (!isNaN(numId) && numId < 100000) {
        // Fenster-Handles sind typischerweise sehr große Zahlen

        ipcRenderer
          .invoke("add-process-to-theme", themeId, numId)
          .then((success) => {
            if (success) {
            } else {
              console.error(
                `[UI] Fehler beim Hinzufügen des Prozesses ${numId} zum Thema ${themeId} mit persistentem Identifikator.`
              );
            }
          })
          .catch((error) => {
            console.error(
              `[UI] Fehler beim Aufruf des IPC-Handlers add-process-to-theme:`,
              error
            );
          });
      }
    },
    []
  );

  // Anwendung aus Theme entfernen
  const handleRemoveFromTheme = useCallback(
    (themeId: string, appId: number | string) => {
      // Zuerst den lokalen State aktualisieren
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

      // Dann den IPC-Handler aufrufen, um persistente Identifikatoren zu entfernen
      // Nur für numerische Prozess-IDs (keine Fenster-Handles)
      const numId = typeof appId === "string" ? parseInt(appId, 10) : appId;
      if (!isNaN(numId) && numId < 100000) {
        // Fenster-Handles sind typischerweise sehr große Zahlen

        ipcRenderer
          .invoke("remove-process-from-theme", themeId, numId)
          .then((success) => {
            if (success) {
              // Prozess erfolgreich entfernt
            } else {
              console.error(
                `[UI] Fehler beim Entfernen des Prozesses ${numId} aus Thema ${themeId} mit persistentem Identifikator.`
              );
            }
          })
          .catch((error) => {
            console.error(
              `[UI] Fehler beim Aufruf des IPC-Handlers remove-process-from-theme:`,
              error
            );
          });
      }
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

  // Modified to support multiple themes with PERFORMANCE-OPTIMIERUNG
  const applyFocusMode = async (
    themeId: string,
    active: boolean,
    providedTheme?: Theme
  ) => {
    if (!active) {
      return;
    }

    // PERFORMANCE-OPTIMIERUNG: Reduziere Logging und optimiere Theme-Zugriff
    let currentTheme;
    if (providedTheme) {
      currentTheme = providedTheme;
    } else {
      // Schneller Zugriff auf lokalen State zuerst, dann erst Datenbank-Abfrage
      currentTheme = themes.find((t) => t.id === themeId);

      // Nur wenn nicht im lokalen State gefunden, aus Datenbank laden
      if (!currentTheme) {
        try {
          currentTheme = await ipcRenderer.invoke("get-theme", themeId);
        } catch (error) {
          console.error(
            `[FOCUS] Fehler beim Laden des Themes ${themeId}:`,
            error
          );
        }
      }
    }

    if (!currentTheme) {
      console.error(`[FOCUS] Theme ${themeId} konnte nicht gefunden werden`);
      return;
    }

    // PERFORMANCE-OPTIMIERUNG: Verwende Set für schnellere Lookups
    const appIdsToProtectSet = new Set<number>();

    // Sammle Window-Handles aus dem windows-Array für präzise Fenster-Kontrolle
    // WICHTIG: Wir bevorzugen Window-Handles über Prozess-IDs für Browser-Subprozesse
    const hasWindowHandles =
      (currentTheme as any).windows && (currentTheme as any).windows.length > 0;
    const windowHandlesUsed = new Set<number>();

    if (hasWindowHandles) {
      const windows = (currentTheme as any).windows;
      for (let i = 0; i < windows.length; i++) {
        const window = windows[i];
        if (window.hwnd) {
          // Verwende Window-Handle für präzise Fenster-Kontrolle
          appIdsToProtectSet.add(window.hwnd);
          windowHandlesUsed.add(window.hwnd);
        }
      }
    }

    // Sammle Prozess-IDs aus dem processes-Array nur wenn keine entsprechenden Window-Handles existieren
    if (currentTheme.processes && currentTheme.processes.length > 0) {
      for (let i = 0; i < currentTheme.processes.length; i++) {
        const processId = currentTheme.processes[i];
        if (typeof processId === "number") {
          // Prüfe, ob für diesen Prozess bereits Window-Handles vorhanden sind
          let hasWindowForProcess = false;
          if (hasWindowHandles) {
            const windows = (currentTheme as any).windows;
            for (let j = 0; j < windows.length; j++) {
              if (windows[j].processId === processId && windows[j].hwnd) {
                hasWindowForProcess = true;
                break;
              }
            }
          }

          // Füge Prozess-ID nur hinzu, wenn kein Window-Handle für diesen Prozess existiert
          if (!hasWindowForProcess) {
            appIdsToProtectSet.add(processId);
          }
        }
      }
    }

    // Sammle aus applications Array nur wenn es keine Window-Handles gibt
    // Das applications Array kann sowohl Prozess-IDs als auch Window-Handles enthalten
    if (
      currentTheme.applications &&
      currentTheme.applications.length > 0 &&
      !hasWindowHandles
    ) {
      for (let i = 0; i < currentTheme.applications.length; i++) {
        const id = currentTheme.applications[i];
        if (typeof id === "number") {
          appIdsToProtectSet.add(id);
        }
      }
    }

    // Konvertiere Set zurück zu Array
    const appIdsToProtect = Array.from(appIdsToProtectSet);

    // 3. Prüfe, ob wir überhaupt etwas zu schützen haben
    if (appIdsToProtect.length === 0) {
      alert(
        "Diese Gruppe enthält keine Anwendungen. Füge mindestens eine Anwendung hinzu, damit der Focus-Modus funktioniert."
      );
      return;
    }

    try {
      // PERFORMANCE-OPTIMIERUNG: Direkter Aufruf ohne zusätzliches Logging
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
    // Sammle alle geschützten IDs - WICHTIG: Priorisiere Window-Handles über Prozess-IDs
    const protectedIds = new Set<number>();

    // Prüfe, ob Window-Handles vorhanden sind
    const hasWindowHandles =
      (theme as any).windows && (theme as any).windows.length > 0;

    // Füge Window-Handles hinzu (höchste Priorität für Browser-Subprozesse)
    if (hasWindowHandles) {
      const windows = (theme as any).windows;
      for (let i = 0; i < windows.length; i++) {
        const window = windows[i];
        if (window.hwnd) {
          protectedIds.add(window.hwnd);
        }
        // WICHTIG: Füge KEINE Prozess-IDs hinzu, wenn Window-Handles vorhanden sind
        // Das verhindert, dass andere Browser-Fenster mit derselben Prozess-ID geschützt werden
      }
    } else {
      // Nur wenn keine Window-Handles vorhanden sind, verwende Prozess-IDs
      if (theme.processes && theme.processes.length > 0) {
        theme.processes.forEach((processId) => protectedIds.add(processId));
      }

      // Füge applications hinzu nur wenn keine Window-Handles vorhanden sind
      if (theme.applications && theme.applications.length > 0) {
        theme.applications.forEach((id) => {
          if (typeof id === "number") {
            protectedIds.add(id);
          }
        });
      }
    }

    // Bestimme, welche Anwendungen minimiert werden sollen
    const appsToMinimize = allApps
      .filter((app) => !protectedIds.has(app.id))
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

  // Event-Listener für Auto-Updates
  useEffect(() => {
    // Listener für Update-Nachrichten
    const handleUpdateMessage = (_: any, message: string) => {
      setUpdateMessage(message);

      // Nachricht nach 5 Sekunden ausblenden
      setTimeout(() => {
        setUpdateMessage(null);
      }, 5000);
    };

    ipcRenderer.on("update-message", handleUpdateMessage);

    return () => {
      ipcRenderer.removeListener("update-message", handleUpdateMessage);
    };
  }, []);

  return (
    <div className={`app ${compactMode ? "compact-mode" : ""}`}>
      {/* Update-Benachrichtigung */}
      {updateMessage && (
        <div className="update-notification">
          <div className="update-message">{updateMessage}</div>
          <button
            className="update-close"
            onClick={() => setUpdateMessage(null)}
          >
            ×
          </button>
        </div>
      )}

      <div className="custom-titlebar">
        <div className="app-brand">
          <div className="app-logo">
            <img
              src={require("../assets/logo.svg")}
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
            className="settings-button"
            onClick={() => setShowSettings(!showSettings)}
            title="Settings"
          >
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
          <button
            className={`refresh-button ${isRefreshing ? "refreshing" : ""}`}
            onClick={fetchApplications}
            title="Anwendungen aktualisieren"
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <svg
                className="spinner"
                width="12"
                height="12"
                viewBox="0 0 16 16"
              >
                <circle
                  className="path"
                  cx="8"
                  cy="8"
                  r="6"
                  fill="none"
                  strokeWidth="2"
                  stroke="currentColor"
                />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 16 16">
                <path
                  fill="currentColor"
                  d="M8 3a5 5 0 0 0-5 5H1l3.5 3.5L8 8H6a2 2 0 1 1 2 2v2a4 4 0 1 0-4-4H2a6 6 0 1 1 6 6v-2a4 4 0 0 0 0-8z"
                />
              </svg>
            )}
          </button>
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
      {showSettings ? (
        <Settings onClose={() => setShowSettings(false)} />
      ) : loading ? (
        <div className="loading-animation">
          <div className="loading-text">{loadingPhaseTexts[loadingPhase]}</div>
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

// Wrapper-Komponente mit TrialManager und LicenseCheck (Reihenfolge geändert!)
const App: React.FC<{ initialLoadingText?: string }> = ({
  initialLoadingText,
}) => {
  return (
    <TrialManager>
      <LicenseCheck>
        <AppContent initialLoadingText={initialLoadingText} />
      </LicenseCheck>
    </TrialManager>
  );
};

export default App;
