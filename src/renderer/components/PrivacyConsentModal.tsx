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

  return (
    <div className="privacy-consent-modal">
      <div className="consent-content">
        <div className="consent-header">
          <h2>Privacy & Data Notice</h2>
          <p className="consent-subtitle">
            Before you can start using switchfast
          </p>
        </div>

        <div className="consent-body">
          <div className="consent-section">
            <h3>📊 Data Collection for Better User Experience</h3>
            <p>
              To continuously improve switchfast, we collect anonymized usage
              data through PostHog and store it on servers in the EU. This helps
              us understand which features are used most and where we can
              optimize the app.
            </p>
          </div>

          <div className="consent-section">
            <h3>🔒 What we collect</h3>
            <ul>
              <li>App usage statistics (which features are being used)</li>
              <li>Technical information (operating system, app version)</li>
              <li>Anonymized performance data</li>
              <li>Crash reports for bug fixes</li>
            </ul>
          </div>

          <div className="consent-section">
            <h3>🚫 What we DON'T collect</h3>
            <ul>
              <li>Personal files or content</li>
              <li>Passwords or sensitive data</li>
              <li>Screenshot content or screen data</li>
              <li>Data that could personally identify you</li>
            </ul>
          </div>

          <div className="consent-notice">
            <p>
              All collected data is fully anonymized and used exclusively to
              improve switchfast.
            </p>
            <p>
              More information can be found in our{" "}
              <a
                href="https://switchfast.io/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="consent-link"
              >
                Privacy Policy
              </a>{" "}
              and{" "}
              <a
                href="https://switchfast.io/terms"
                target="_blank"
                rel="noopener noreferrer"
                className="consent-link"
              >
                Terms of Service
              </a>
              .
            </p>
          </div>
        </div>

        <div className="consent-actions">
          <button
            onClick={handleDecline}
            className="decline-button"
            disabled={isProcessing}
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="accept-button"
            disabled={isProcessing}
          >
            {isProcessing ? "Saving..." : "Accept & Start Trial"}
          </button>
        </div>

        <p className="consent-footer">
          Without consent, the app cannot be used as we rely on data collection
          for improvements.
        </p>
      </div>
    </div>
  );
};

export default PrivacyConsentModal;
