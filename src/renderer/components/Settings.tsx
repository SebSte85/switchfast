import React, { useState, useEffect } from "react";
import { ipcRenderer } from "electron";

interface SettingsProps {
  onClose: () => void;
}

const Settings: React.FC<SettingsProps> = ({ onClose }) => {
  const [autoStartEnabled, setAutoStartEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [deviceId, setDeviceId] = useState<string>("");
  const [isClosing, setIsClosing] = useState(false);

  // Load initial data
  useEffect(() => {
    const loadInitialData = async () => {
      try {
        // Check autostart status
        const isEnabled = await ipcRenderer.invoke("autostart:is-enabled");
        setAutoStartEnabled(isEnabled);

        // Get device ID
        const id = await ipcRenderer.invoke("get-device-id");
        setDeviceId(id);

        // Enable autostart by default if not already configured
        if (!isEnabled) {
          try {
            const success = await ipcRenderer.invoke("autostart:enable");
            if (success) {
              setAutoStartEnabled(true);
            }
          } catch (error) {
            console.error("Error enabling autostart by default:", error);
          }
        }
      } catch (error) {
        console.error("Error loading initial data:", error);
      } finally {
        setIsLoading(false);
      }
    };

    loadInitialData();
  }, []);

  // Toggle autostart setting
  const handleAutoStartToggle = async () => {
    setIsSaving(true);
    try {
      let success = false;

      if (autoStartEnabled) {
        success = await ipcRenderer.invoke("autostart:disable");
      } else {
        success = await ipcRenderer.invoke("autostart:enable");
      }

      if (success) {
        setAutoStartEnabled(!autoStartEnabled);
      } else {
        console.error("Error changing autostart setting");
      }
    } catch (error) {
      console.error("Error changing autostart setting:", error);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle close with animation
  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 300); // Match animation duration
  };

  return (
    <div
      className={`settings-container ${
        isClosing ? "settings-slide-out" : "settings-slide-in"
      }`}
    >
      {/* Header */}
      <div className="settings-header">
        <div className="settings-title">
          <svg
            className="w-6 h-6 text-[#78d97c] mr-3"
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
          <h2 className="text-[#78d97c]">Settings</h2>
        </div>
        <button
          className="settings-close-button"
          onClick={handleClose}
          title="Close Settings"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Content */}
      <div className="settings-content">
        <div className="settings-section">
          <h3 className="settings-section-title">Startup</h3>
          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Start with Windows</div>
              <div className="settings-item-description">
                SwitchFast will automatically start when Windows boots up. Your
                app groups will be available immediately.
              </div>
            </div>
            <div className="settings-item-control">
              {isLoading ? (
                <div className="settings-loading">
                  <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24">
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                      fill="none"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                </div>
              ) : (
                <button
                  className={`toggle-switch ${
                    autoStartEnabled ? "enabled" : "disabled"
                  } ${isSaving ? "saving" : ""}`}
                  onClick={handleAutoStartToggle}
                  disabled={isSaving}
                >
                  <div className="toggle-slider">
                    {isSaving && (
                      <svg
                        className="toggle-spinner animate-spin w-3 h-3"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                  </div>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Device Information */}
        <div className="settings-section">
          <h3 className="settings-section-title">Device</h3>
          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Device ID</div>
              <div className="settings-item-description">
                {deviceId || "Loading..."}
              </div>
            </div>
          </div>
        </div>

        {/* About Section */}
        <div className="settings-section">
          <h3 className="settings-section-title">About</h3>
          <div className="settings-item">
            <div className="settings-item-info">
              <div className="settings-item-label">Version</div>
              <div className="settings-item-description">SwitchFast v0.1.1</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
