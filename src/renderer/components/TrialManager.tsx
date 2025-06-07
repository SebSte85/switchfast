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
        console.log("🔍 [TrialManager DEBUG] Starte Lizenzstatus-Prüfung...");

        // Zuerst Lizenzstatus prüfen
        const status = await ipcRenderer.invoke("license:getStatus");
        setLicenseStatus(status);

        console.log("📋 [TrialManager DEBUG] Lizenzstatus erhalten:", status);

        // Wenn bereits lizenziert oder im Trial → kein Modal anzeigen
        if (status.isLicensed || status.isInTrial) {
          console.log(
            "✅ [TrialManager DEBUG] Bereits lizenziert oder im Trial - keine weitere Aktion nötig"
          );
          return;
        }

        // Privacy Consent prüfen
        const consentGiven = await ipcRenderer.invoke(
          "privacy:getConsentStatus"
        );
        console.log(
          "🔒 [TrialManager DEBUG] Privacy Consent Status:",
          consentGiven
        );

        if (!consentGiven) {
          console.log(
            "❌ [TrialManager DEBUG] Kein Privacy Consent - zeige Modal"
          );
          setShowPrivacyConsent(true);
          return;
        }

        console.log("✅ [TrialManager DEBUG] Privacy Consent bereits gegeben");

        // Consent bereits gegeben, aber kein aktiver Trial
        // Prüfen, ob Trial überhaupt möglich ist (noch nicht verwendet)
        const trialInfo = await ipcRenderer.invoke("license:getTrialInfo");
        console.log("📋 [TrialManager DEBUG] Trial Info erhalten:", trialInfo);

        if (!trialInfo) {
          // Noch nie Trial gestartet → Trial automatisch aktivieren
          console.log(
            "🆕 [TrialManager DEBUG] Kein Trial-Eintrag gefunden - aktiviere automatisch"
          );
          await activateTrialAutomatically();
        } else if (trialInfo.remainingDays <= 0 || !trialInfo.isTrialActive) {
          // Trial abgelaufen oder deaktiviert → Keine weiteren Trials möglich
          console.log(
            "⏰ [TrialManager DEBUG] Trial abgelaufen - Lizenz erforderlich"
          );
          console.log("📋 [TrialManager DEBUG] Trial Details:", {
            remainingDays: trialInfo.remainingDays,
            isTrialActive: trialInfo.isTrialActive,
          });
          // LicenseCheck Component wird Benutzer zur Lizenz-Kaufseite weiterleiten
          // Hier zeigen wir keine Modals an
        } else {
          // Trial sollte eigentlich aktiv sein, aber status.isInTrial war false
          // Das ist inkonsistent - Trial automatisch reaktivieren
          console.warn(
            "⚠️ [TrialManager DEBUG] Inkonsistenter Trial-Status - reaktiviere Trial"
          );
          console.warn("⚠️ [TrialManager DEBUG] Inkonsistenz Details:", {
            statusIsInTrial: status.isInTrial,
            trialInfoIsActive: trialInfo.isTrialActive,
            remainingDays: trialInfo.remainingDays,
          });
          await activateTrialAutomatically();
        }
      } catch (error) {
        console.error(
          "💥 [TrialManager DEBUG] Fehler beim Abrufen des Lizenzstatus:",
          error
        );
      } finally {
        console.log(
          "🏁 [TrialManager DEBUG] Lizenzstatus-Prüfung abgeschlossen"
        );
        setIsLoading(false);
      }
    };

    checkLicenseStatus();
  }, []);

  // Hilfsfunktion für automatische Trial-Aktivierung
  const activateTrialAutomatically = async () => {
    try {
      console.log("🚀 [TrialManager DEBUG] Aktiviere Trial automatisch...");
      const trialResult = await ipcRenderer.invoke("activate-trial", {
        email: "user@example.com",
      });

      if (trialResult.success) {
        console.log("✅ [TrialManager DEBUG] Trial erfolgreich aktiviert");
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
      console.log("[TrialManager] Payment Success Event erhalten:", data);
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
      console.log("[TrialManager] Payment Cancelled Event erhalten");
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
    console.log(
      "✅ [TrialManager DEBUG] Privacy Consent akzeptiert - speichere..."
    );
    try {
      // Consent in der Datenbank speichern
      const result = await ipcRenderer.invoke("privacy:setConsent", true);
      console.log(
        "💾 [TrialManager DEBUG] Privacy Consent gespeichert, Ergebnis:",
        result
      );
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
