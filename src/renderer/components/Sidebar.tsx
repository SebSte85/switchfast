import React from "react";
import ThemeSelector from "./ThemeSelector";

// Typdefinitionen
interface Theme {
  id: string;
  name: string;
  applications: number[];
}

interface SidebarProps {
  themes: Theme[];
  activeTheme: string | null;
  onActivateTheme: (themeId: string | null) => void;
  onAddTheme: (newTheme: Theme) => void;
  onDeleteTheme: (themeId: string) => void;
  focusModeActive: boolean;
  onToggleFocusMode: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  themes,
  activeTheme,
  onActivateTheme,
  onAddTheme,
  onDeleteTheme,
  focusModeActive,
  onToggleFocusMode,
}) => {
  // Funktion zum Erstellen eines neuen Themes
  const handleCreateTheme = (name: string) => {
    const newTheme: Theme = {
      id: Date.now().toString(),
      name,
      applications: [],
    };
    onAddTheme(newTheme);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2 className="text-xl font-semibold text-white">Work Focus Manager</h2>
      </div>

      <nav className="sidebar-nav">
        <ul>
          <li className="sidebar-nav-item active">
            <span className="sidebar-nav-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5"
              >
                <path d="M11.47 3.84a.75.75 0 011.06 0l8.69 8.69a.75.75 0 101.06-1.06l-8.689-8.69a2.25 2.25 0 00-3.182 0l-8.69 8.69a.75.75 0 001.061 1.06l8.69-8.69z" />
                <path d="M12 5.432l8.159 8.159c.03.03.06.058.091.086v6.198c0 1.035-.84 1.875-1.875 1.875H15a.75.75 0 01-.75-.75v-4.5a.75.75 0 00-.75-.75h-3a.75.75 0 00-.75.75V21a.75.75 0 01-.75.75H5.625a1.875 1.875 0 01-1.875-1.875v-6.198a2.29 2.29 0 00.091-.086L12 5.43z" />
              </svg>
            </span>
            <span>Dashboard</span>
          </li>
          <li className="sidebar-nav-item">
            <span className="sidebar-nav-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5"
              >
                <path
                  fillRule="evenodd"
                  d="M2.25 6a3 3 0 013-3h13.5a3 3 0 013 3v12a3 3 0 01-3 3H5.25a3 3 0 01-3-3V6zm18 3H3.75v9a1.5 1.5 0 001.5 1.5h13.5a1.5 1.5 0 001.5-1.5V9zm-15-3.75A.75.75 0 004.5 6v.008c0 .414.336.75.75.75h.008a.75.75 0 00.75-.75V6a.75.75 0 00-.75-.75H5.25zm1.5.75a.75.75 0 01.75-.75h.008a.75.75 0 01.75.75v.008a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V6zm3-.75a.75.75 0 00-.75.75v.008c0 .414.336.75.75.75h.008a.75.75 0 00.75-.75V6a.75.75 0 00-.75-.75H9.75z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <span>Applications</span>
          </li>
          <li className="sidebar-nav-item">
            <span className="sidebar-nav-icon">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="w-5 h-5"
              >
                <path
                  fillRule="evenodd"
                  d="M11.078 2.25c-.917 0-1.699.663-1.85 1.567L9.05 4.889c-.02.12-.115.26-.297.348a7.493 7.493 0 00-.986.57c-.166.115-.334.126-.45.083L6.3 5.508a1.875 1.875 0 00-2.282.819l-.922 1.597a1.875 1.875 0 00.432 2.385l.84.692c.095.078.17.229.154.43a7.598 7.598 0 000 1.139c.015.2-.059.352-.153.43l-.841.692a1.875 1.875 0 00-.432 2.385l.922 1.597a1.875 1.875 0 002.282.818l1.019-.382c.115-.043.283-.031.45.082.312.214.641.405.985.57.182.088.277.228.297.35l.178 1.071c.151.904.933 1.567 1.85 1.567h1.844c.916 0 1.699-.663 1.85-1.567l.178-1.072c.02-.12.114-.26.297-.349.344-.165.673-.356.985-.57.167-.114.335-.125.45-.082l1.02.382a1.875 1.875 0 002.28-.819l.923-1.597a1.875 1.875 0 00-.432-2.385l-.84-.692c-.095-.078-.17-.229-.154-.43a7.614 7.614 0 000-1.139c-.016-.2.059-.352.153-.43l.84-.692c.708-.582.891-1.59.433-2.385l-.922-1.597a1.875 1.875 0 00-2.282-.818l-1.02.382c-.114.043-.282.031-.449-.083a7.49 7.49 0 00-.985-.57c-.183-.087-.277-.227-.297-.348l-.179-1.072a1.875 1.875 0 00-1.85-1.567h-1.843zM12 15.75a3.75 3.75 0 100-7.5 3.75 3.75 0 000 7.5z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
            <span>Settings</span>
          </li>
        </ul>
      </nav>

      <div className="sidebar-themes">
        <ThemeSelector
          themes={themes}
          activeTheme={activeTheme}
          onThemeSelect={onActivateTheme}
          onCreateTheme={handleCreateTheme}
        />
      </div>

      <div className="sidebar-footer">
        <button
          onClick={onToggleFocusMode}
          disabled={!activeTheme}
          className={`sidebar-focus-toggle ${focusModeActive ? "active" : ""}`}
        >
          <span className="sidebar-nav-icon">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path d="M12 .75a8.25 8.25 0 00-4.135 15.39c.686.398 1.115 1.008 1.134 1.623a.75.75 0 00.577.706c.352.083.71.127 1.074.127.364 0 .722-.044 1.074-.127a.75.75 0 00.577-.706c.02-.615.448-1.225 1.134-1.623A8.25 8.25 0 0012 .75z" />
              <path
                fillRule="evenodd"
                d="M9.75 9a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3A.75.75 0 019.75 9zm-.75 2.25a.75.75 0 000 1.5h6a.75.75 0 000-1.5H9z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <span>
            {focusModeActive ? "Exit Focus Mode" : "Enter Focus Mode"}
          </span>
        </button>
      </div>
    </div>
  );
};

export default Sidebar;
