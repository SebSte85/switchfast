import { useState, useEffect, useCallback } from "react";

// Typdefinitionen
interface LicenseStatus {
  isLicensed: boolean;
  isInTrial: boolean;
  remainingTrialDays: number;
  subscriptionEndDate?: string | null;
  isSubscription?: boolean;
  cancelledAt?: string | null;
  cancelsAtPeriodEnd?: boolean;
  email?: string | null;
}

// Electron IPC-Renderer
const { ipcRenderer } = window.require("electron");

export function useLicense() {
  const [status, setStatus] = useState<LicenseStatus>({
    isLicensed: false,
    isInTrial: false,
    remainingTrialDays: 0,
  });
  const [isLoading, setIsLoading] = useState(true);

  // Lizenzstatus abrufen
  const fetchLicenseStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await ipcRenderer.invoke("license:getStatus");
      setStatus(result);
    } catch (error) {
      console.error("Fehler beim Abrufen des Lizenzstatus:", error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Lizenz aktivieren
  const activateLicense = useCallback(
    async (licenseKey: string) => {
      try {
        const success = await ipcRenderer.invoke(
          "license:activate",
          licenseKey
        );
        if (success) {
          await fetchLicenseStatus();
        }
        return success;
      } catch (error) {
        console.error("Fehler bei der Lizenzaktivierung:", error);
        return false;
      }
    },
    [fetchLicenseStatus]
  );

  // Lizenz deaktivieren
  const deactivateLicense = useCallback(async () => {
    try {
      const success = await ipcRenderer.invoke("license:deactivate");
      if (success) {
        await fetchLicenseStatus();
      }
      return success;
    } catch (error) {
      console.error("Fehler bei der Lizenzdeaktivierung:", error);
      return false;
    }
  }, [fetchLicenseStatus]);

  // Stripe Checkout öffnen
  const openStripeCheckout = useCallback(async (email?: string) => {
    try {
      return await ipcRenderer.invoke("license:openCheckout", email);
    } catch (error) {
      console.error("Fehler beim Öffnen des Stripe Checkouts:", error);
      return false;
    }
  }, []);

  // Lizenz mit Stripe Session aktivieren
  const activateLicenseFromSession = useCallback(
    async (sessionId: string, environment: string = "test") => {
      try {
        console.log(
          `[License] Aktiviere Lizenz aus Stripe Session: ${sessionId}, Umgebung: ${environment}`
        );
        const success = await ipcRenderer.invoke(
          "license:activateFromSession",
          { sessionId, environment }
        );
        if (success) {
          await fetchLicenseStatus();
        }
        return success;
      } catch (error) {
        console.error(
          "Fehler bei der Lizenzaktivierung aus Stripe Session:",
          error
        );
        return false;
      }
    },
    [fetchLicenseStatus]
  );

  // Lizenzstatus prüfen
  const checkLicenseStatus = useCallback(async () => {
    try {
      const isValid = await ipcRenderer.invoke("license:checkStatus");
      await fetchLicenseStatus();
      return isValid;
    } catch (error) {
      console.error("Fehler bei der Lizenzprüfung:", error);
      return false;
    }
  }, [fetchLicenseStatus]);

  // Subscription kündigen
  const cancelSubscription = useCallback(async () => {
    try {
      const result = await ipcRenderer.invoke("license:cancelSubscription");
      await fetchLicenseStatus();
      return result;
    } catch (error) {
      console.error("Fehler beim Kündigen der Subscription:", error);
      return false;
    }
  }, [fetchLicenseStatus]);

  // Account löschen
  const deleteAccount = useCallback(async () => {
    try {
      console.log("🟡 [useLicense] deleteAccount: Starting IPC call");
      const result = await ipcRenderer.invoke("license:deleteAccount");
      console.log("🟡 [useLicense] deleteAccount: IPC result:", result);
      await fetchLicenseStatus();
      console.log("🟡 [useLicense] deleteAccount: Returning result:", result);
      return result;
    } catch (error) {
      console.error("🔴 [useLicense] Fehler beim Löschen des Accounts:", error);
      return false;
    }
  }, [fetchLicenseStatus]);

  // Initialer Abruf des Lizenzstatus
  useEffect(() => {
    fetchLicenseStatus();
  }, [fetchLicenseStatus]);

  return {
    ...status,
    isLoading,
    activateLicense,
    deactivateLicense,
    openStripeCheckout,
    activateLicenseFromSession,
    checkLicenseStatus,
    refreshStatus: fetchLicenseStatus,
    cancelSubscription,
    deleteAccount,
  };
}
