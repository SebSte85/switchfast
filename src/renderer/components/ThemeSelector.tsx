import React, { useState } from "react";

// Typdefinitionen
interface Theme {
  id: string;
  name: string;
  applications: number[];
}

interface ThemeSelectorProps {
  themes: Theme[];
  activeTheme: string | null;
  onThemeSelect: (themeId: string | null) => void;
  onCreateTheme: (name: string) => void;
}

const ThemeSelector: React.FC<ThemeSelectorProps> = ({
  themes,
  activeTheme,
  onThemeSelect,
  onCreateTheme,
}) => {
  const [newThemeName, setNewThemeName] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);

  const handleCreateTheme = (e: React.FormEvent) => {
    e.preventDefault();
    if (newThemeName.trim()) {
      onCreateTheme(newThemeName.trim());
      setNewThemeName("");
      setShowCreateForm(false);
    }
  };

  return (
    <div className="theme-selector">
      <div className="theme-selector-header">
        <h3 className="text-sm font-semibold">Focus Themes</h3>
        <button
          className="theme-create-button"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          {showCreateForm ? "Cancel" : "New"}
        </button>
      </div>

      {showCreateForm && (
        <form className="theme-create-form" onSubmit={handleCreateTheme}>
          <input
            type="text"
            placeholder="Theme name"
            value={newThemeName}
            onChange={(e) => setNewThemeName(e.target.value)}
            autoFocus
          />
          <button type="submit">Create</button>
        </form>
      )}

      <div className="theme-list">
        {themes.length === 0 ? (
          <p className="no-themes text-gray-400">No themes created yet</p>
        ) : (
          themes.map((theme) => (
            <div
              key={theme.id}
              className={`theme-item ${
                activeTheme === theme.id ? "active" : ""
              }`}
              onClick={() => onThemeSelect(theme.id)}
            >
              <span className="theme-name truncate">{theme.name}</span>
              <span className="app-count text-xs bg-gray-600 text-gray-300 px-2 py-0.5 rounded-full">
                {theme.applications.length}
              </span>
            </div>
          ))
        )}
      </div>

      <div className="theme-selector-help text-xs text-gray-400 mt-4">
        <p>Create themes to group applications and focus on specific tasks.</p>
        <p className="mt-1">Use Ctrl+Shift+1-3 to quickly activate themes.</p>
      </div>
    </div>
  );
};

export default ThemeSelector;
