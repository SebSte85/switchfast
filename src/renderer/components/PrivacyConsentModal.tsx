import React, { useState } from "react";
import "./PrivacyConsentModal.css";

const { ipcRenderer } = window.require("electron");

interface PrivacyConsentModalProps {
  onAccept: () => void;
  onDecline: () => void;
}

const PrivacyConsentModal: React.FC<PrivacyConsentModalProps> = ({
  onAccept,
  onDecline,
}) => {
  const [isProcessing, setIsProcessing] = useState(false);

  const handleAccept = async () => {
    setIsProcessing(true);

    // Track consent_clicked event with accept action
    try {
      await ipcRenderer.invoke("track-event", "consent_clicked", {
        action: "accept",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Fehler beim Tracking des Consent Events:", error);
    }

    // Small delay for better UX
    await new Promise((resolve) => setTimeout(resolve, 300));
    onAccept();
  };

  const handleDecline = async () => {
    // Track consent_clicked event with decline action
    try {
      await ipcRenderer.invoke("track-event", "consent_clicked", {
        action: "decline",
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Fehler beim Tracking des Consent Events:", error);
    }

    onDecline();
  };

  const handleWebsiteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const { shell } = window.require("electron");
    shell.openExternal("https://www.switchfast.io");
  };

  const handlePrivacyPolicyClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const { shell } = window.require("electron");
    shell.openExternal("https://switchfast.io/privacy");
  };

  const handleTermsClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const { shell } = window.require("electron");
    shell.openExternal("https://switchfast.io/terms");
  };

  return (
    <div className="min-h-screen bg-[#2D2D3F] flex items-center justify-center p-4">
      <div className="max-w-lg w-full bg-[#2D2D3F] rounded-lg shadow-xl border border-gray-700 max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="p-6 pb-4 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center justify-center mb-3">
            <div className="w-12 h-12 flex items-center justify-center mr-3">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                className="w-10 h-10"
              >
                <rect
                  width="20"
                  height="12"
                  x="2"
                  y="6"
                  fill="#78d97c"
                  rx="6"
                  ry="6"
                ></rect>
                <path
                  fill="#2d2d3f"
                  d="M15.58,14.33c-.2,0-.39-.08-.53-.22l-1.58-1.58c-.29-.29-.29-.77,0-1.06s.77-.29,1.06,0l.98,.98,1.9-2.5c.25-.33,.72-.4,1.05-.14,.33,.25,.39,.72,.14,1.05l-2.42,3.18c-.13,.17-.33,.28-.55,.29-.02,0-.03,0-.05,0Z"
                ></path>
                <circle cx="8" cy="12" r="3" fill="#2d2d3f"></circle>
              </svg>
            </div>
            <h1 className="text-xl font-bold text-[#78d97c]">switchfast</h1>
          </div>
          <h2 className="text-2xl font-semibold text-white text-center mb-2">
            Privacy & Data Notice
          </h2>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          <div className="space-y-6">
            <div className="consent-section">
              <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                📊 Data Collection for Better User Experience
              </h3>
              <p className="text-gray-300 leading-relaxed">
                To continuously improve switchfast, we collect anonymized usage
                data through PostHog and store it on servers in the EU. This
                helps us understand which features are used most and where we
                can optimize the app.
              </p>
            </div>

            <div className="consent-section">
              <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                🔒 What we collect
              </h3>
              <ul className="text-gray-300 space-y-2 list-disc list-inside">
                <li>App usage statistics (which features are being used)</li>
                <li>Technical information (operating system, app version)</li>
                <li>Anonymized performance data</li>
                <li>Crash reports for bug fixes</li>
              </ul>
            </div>

            <div className="consent-section">
              <h3 className="text-lg font-semibold text-white mb-3 flex items-center gap-2">
                🚫 What we DON'T collect
              </h3>
              <ul className="text-gray-300 space-y-2 list-disc list-inside">
                <li>Personal files or content</li>
                <li>Passwords or sensitive data</li>
                <li>Screenshot content or screen data</li>
                <li>Data that could personally identify you</li>
              </ul>
            </div>

            <div className="p-4 bg-gray-700/30 border border-gray-600 rounded-lg">
              <p className="text-white text-sm leading-relaxed mb-2">
                All collected data is fully anonymized and used exclusively to
                improve switchfast.
              </p>
              <p className="text-gray-300 text-sm leading-relaxed">
                More information can be found in our{" "}
                <a
                  href="https://switchfast.io/privacy"
                  onClick={handlePrivacyPolicyClick}
                  className="text-[#78d97c] hover:underline focus:outline-none cursor-pointer"
                >
                  Privacy Policy
                </a>{" "}
                and{" "}
                <a
                  href="https://switchfast.io/terms"
                  onClick={handleTermsClick}
                  className="text-[#78d97c] hover:underline focus:outline-none cursor-pointer"
                >
                  Terms of Service
                </a>
                .
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="p-6 pt-4 border-t border-gray-700 flex-shrink-0">
          <div className="flex gap-3 mb-4">
            <button
              onClick={handleAccept}
              className="flex-1 bg-[#78d97c] hover:bg-[#6bc870] text-white font-semibold py-3 px-6 rounded-lg transition-colors focus:outline-none focus:ring-0 transform hover:scale-[1.02] transition-transform"
              style={{ boxShadow: "0 4px 8px rgba(120, 217, 124, 0.3)" }}
              disabled={isProcessing}
            >
              {isProcessing ? "Saving..." : "Accept & Start Trial"}
            </button>
            <button
              onClick={handleDecline}
              className="flex-1 bg-gray-700 hover:bg-gray-600 text-gray-200 font-semibold py-3 px-6 rounded-lg transition-colors focus:outline-none focus:ring-0 border border-gray-500"
              disabled={isProcessing}
            >
              Decline
            </button>
          </div>

          {/* Company Information */}
          <div className="pt-3 border-t border-gray-700">
            <p className="text-xs text-gray-500 text-center leading-relaxed">
              DigITup GmbH - Königsallee 27 - 40212 Düsseldorf - Germany
            </p>
            <a
              href="https://www.switchfast.io"
              onClick={handleWebsiteClick}
              className="text-xs text-gray-500 text-center leading-relaxed block mt-1 cursor-pointer hover:text-gray-400 transition-colors focus:outline-none"
            >
              www.switchfast.io
            </a>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PrivacyConsentModal;
