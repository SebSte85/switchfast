import React, { useEffect, useState } from "react";
import { ipcRenderer } from "electron";
import PrivacyConsentModal from "./PrivacyConsentModal";
import { useLicense } from "../hooks/useLicense";
import "./TrialManager.css";
import console from "console";

interface LicenseStatus {
  isLicensed: boolean;
  isInTrial: boolean;
  remainingTrialDays: number;
  licenseKey: string | null;
  email: string | null;
  purchaseDate: string | null;
}

const TrialManager: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [showPrivacyConsent, setShowPrivacyConsent] = useState<boolean>(false);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(
    null
  );
  const [activationSuccess, setActivationSuccess] = useState<boolean | null>(
    null
  );
  const [isLoading, setIsLoading] = useState(true);

  const { activateLicenseFromSession } = useLicense();

  // Beim Laden des Komponenten: Lizenzstatus und Privacy Consent prüfen
  useEffect(() => {
    const checkLicenseStatus = async () => {
      try {
        // Zuerst Lizenzstatus prüfen
        const status = await ipcRenderer.invoke("license:getStatus");
        setLicenseStatus(status);

        // Wenn bereits lizenziert oder im Trial → kein Modal anzeigen
        if (status.isLicensed || status.isInTrial) {
          return;
        }

        // Privacy Consent prüfen
        const consentGiven = await ipcRenderer.invoke(
          "privacy:getConsentStatus"
        );

        if (!consentGiven) {
          setShowPrivacyConsent(true);
          return;
        }

        // Consent bereits gegeben, aber kein aktiver Trial
        // Prüfen, ob Trial überhaupt möglich ist (noch nicht verwendet)
        const trialInfo = await ipcRenderer.invoke("license:getTrialInfo");
        if (!trialInfo) {
          // Noch nie Trial gestartet → Trial automatisch aktivieren
          await activateTrialAutomatically();
        } else if (trialInfo.remainingDays <= 0 || !trialInfo.isTrialActive) {
          // Trial abgelaufen oder deaktiviert → Keine weiteren Trials möglich
          // LicenseCheck Component wird Benutzer zur Lizenz-Kaufseite weiterleiten
          // Hier zeigen wir keine Modals an
        } else {
          // Trial sollte eigentlich aktiv sein, aber status.isInTrial war false
          // Das ist inkonsistent - Trial automatisch reaktivieren
          await activateTrialAutomatically();
        }
      } catch (error) {
        console.error(
          "💥 [TrialManager DEBUG] Fehler beim Abrufen des Lizenzstatus:",
          error
        );
      } finally {
        // Lizenzstatus-Prüfung abgeschlossen
        setIsLoading(false);
      }
    };

    checkLicenseStatus();
  }, []);

  // Hilfsfunktion für automatische Trial-Aktivierung
  const activateTrialAutomatically = async () => {
    try {
      const trialResult = await ipcRenderer.invoke("activate-trial", {
        email: "user@example.com",
      });

      if (trialResult.success) {
        // Lizenzstatus aktualisieren
        const status = await ipcRenderer.invoke("license:getStatus");
        setLicenseStatus(status);
      } else {
        console.error(
          "❌ [TrialManager DEBUG] Trial-Aktivierung fehlgeschlagen:",
          trialResult.error
        );
      }
    } catch (error) {
      console.error(
        "💥 [TrialManager DEBUG] Fehler bei automatischer Trial-Aktivierung:",
        error
      );
    }
  };

  // IPC-Handler für die Lizenzaktivierung nach erfolgreicher Zahlung
  useEffect(() => {
    // Handler für erfolgreiche Zahlung
    const handlePaymentSuccess = async (
      event: any,
      data: { sessionId: string; environment: string }
    ) => {
      // Payment Success Event erhalten
      try {
        const success = await activateLicenseFromSession(
          data.sessionId,
          data.environment
        );
        setActivationSuccess(success);

        if (success) {
          // Lizenzstatus aktualisieren
          const status = await ipcRenderer.invoke("license:getStatus");
          setLicenseStatus(status);

          // Erfolgsmeldung anzeigen
          ipcRenderer.invoke("show-notification", {
            title: "Lizenz aktiviert",
            body: "Ihre SwitchFast-Lizenz wurde erfolgreich aktiviert.",
          });
        } else {
          // Fehlermeldung anzeigen
          ipcRenderer.invoke("show-notification", {
            title: "Aktivierung fehlgeschlagen",
            body: "Die Lizenzaktivierung ist fehlgeschlagen. Bitte versuchen Sie es später erneut.",
          });
        }
      } catch (error) {
        console.error(
          "[TrialManager] Fehler bei der Lizenzaktivierung:",
          error
        );
        setActivationSuccess(false);
      }
    };

    // Handler für abgebrochene Zahlung
    const handlePaymentCancelled = () => {
      // Payment Cancelled Event erhalten
      ipcRenderer.invoke("show-notification", {
        title: "Zahlung abgebrochen",
        body: "Der Zahlungsvorgang wurde abgebrochen.",
      });
    };

    // Event-Listener registrieren
    ipcRenderer.on("activate-license-from-session", handlePaymentSuccess);
    ipcRenderer.on("payment-cancelled", handlePaymentCancelled);

    // Event-Listener entfernen beim Unmount
    return () => {
      ipcRenderer.removeListener(
        "activate-license-from-session",
        handlePaymentSuccess
      );
      ipcRenderer.removeListener("payment-cancelled", handlePaymentCancelled);
    };
  }, [activateLicenseFromSession]);

  // Privacy Consent akzeptiert
  const handlePrivacyAccept = async () => {
    try {
      // Consent in der Datenbank speichern
      const result = await ipcRenderer.invoke("privacy:setConsent", true);
      setShowPrivacyConsent(false);

      // Trial direkt aktivieren ohne E-Mail-Eingabe
      await activateTrialAutomatically();
    } catch (error) {
      console.error(
        "💥 [TrialManager DEBUG] Fehler beim Speichern des Consents oder Trial-Aktivierung:",
        error
      );
    }
  };

  // Privacy Consent abgelehnt
  const handlePrivacyDecline = async () => {
    try {
      // Consent als abgelehnt speichern
      await ipcRenderer.invoke("privacy:setConsent", false);
      setShowPrivacyConsent(false);
      // App schließen, da ohne Consent keine Nutzung möglich
      await ipcRenderer.invoke("app:quit");
    } catch (error) {
      console.error("Fehler beim Speichern des Consents:", error);
    }
  };

  // Wenn noch geladen wird, zeige Ladeindikator
  if (isLoading) {
    return <div className="loading">Lizenzstatus wird geprüft...</div>;
  }

  return (
    <>
      {showPrivacyConsent && (
        <div className="modal-overlay">
          <PrivacyConsentModal
            onAccept={handlePrivacyAccept}
            onDecline={handlePrivacyDecline}
          />
        </div>
      )}

      {/* Zeige die Hauptanwendung, wenn kein Modal angezeigt wird */}
      {!showPrivacyConsent && children}
    </>
  );
};

export default TrialManager;
