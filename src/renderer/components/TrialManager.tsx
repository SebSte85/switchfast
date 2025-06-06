import React, { useEffect, useState } from "react";
import { ipcRenderer } from "electron";
import TrialSignupModal from "./TrialSignupModal";
import { useLicense } from "../hooks/useLicense";
import "./TrialManager.css";

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
  const [showTrialSignup, setShowTrialSignup] = useState<boolean>(false);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(
    null
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [activationSuccess, setActivationSuccess] = useState<boolean | null>(
    null
  );

  // License Hook für die Aktivierung
  const { activateLicenseFromSession } = useLicense();

  // Lizenzstatus beim Laden der Komponente abrufen
  useEffect(() => {
    const checkLicenseStatus = async () => {
      try {
        const status = await ipcRenderer.invoke("license:getStatus");
        setLicenseStatus(status);

        // Wir zeigen das Trial-Popup nicht mehr automatisch an
        // if (!status.isLicensed && !status.isInTrial) {
        //   setShowTrialSignup(true);
        // }
      } catch (error) {
        console.error("Fehler beim Abrufen des Lizenzstatus:", error);
      } finally {
        setIsLoading(false);
      }
    };

    checkLicenseStatus();
  }, []);

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

  // Trial-Signup abgeschlossen
  const handleTrialComplete = async () => {
    setShowTrialSignup(false);

    // Lizenzstatus aktualisieren
    try {
      const status = await ipcRenderer.invoke("license:getStatus");
      setLicenseStatus(status);
    } catch (error) {
      console.error("Fehler beim Aktualisieren des Lizenzstatus:", error);
    }
  };

  // Wenn noch geladen wird, zeige Ladeindikator
  if (isLoading) {
    return <div className="loading">Lizenzstatus wird geprüft...</div>;
  }

  return (
    <>
      {showTrialSignup && (
        <div className="modal-overlay">
          <TrialSignupModal onComplete={handleTrialComplete} />
        </div>
      )}

      {/* Zeige die Hauptanwendung, wenn kein Trial-Signup angezeigt wird */}
      {!showTrialSignup && children}
    </>
  );
};

export default TrialManager;
