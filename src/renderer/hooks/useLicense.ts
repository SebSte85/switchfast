import { useState, useEffect, useCallback } from 'react';

// Typdefinitionen
interface LicenseStatus {
  isLicensed: boolean;
  isInTrial: boolean;
  remainingTrialDays: number;
}

// Electron IPC-Renderer
const { ipcRenderer } = window.require('electron');

export function useLicense() {
  const [status, setStatus] = useState<LicenseStatus>({
    isLicensed: false,
    isInTrial: false,
    remainingTrialDays: 0
  });
  const [isLoading, setIsLoading] = useState(true);

  // Lizenzstatus abrufen
  const fetchLicenseStatus = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await ipcRenderer.invoke('license:getStatus');
      setStatus(result);
    } catch (error) {
      console.error('Fehler beim Abrufen des Lizenzstatus:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Lizenz aktivieren
  const activateLicense = useCallback(async (licenseKey: string) => {
    try {
      const success = await ipcRenderer.invoke('license:activate', licenseKey);
      if (success) {
        await fetchLicenseStatus();
      }
      return success;
    } catch (error) {
      console.error('Fehler bei der Lizenzaktivierung:', error);
      return false;
    }
  }, [fetchLicenseStatus]);

  // Lizenz deaktivieren
  const deactivateLicense = useCallback(async () => {
    try {
      const success = await ipcRenderer.invoke('license:deactivate');
      if (success) {
        await fetchLicenseStatus();
      }
      return success;
    } catch (error) {
      console.error('Fehler bei der Lizenzdeaktivierung:', error);
      return false;
    }
  }, [fetchLicenseStatus]);

  // Stripe Checkout öffnen
  const openStripeCheckout = useCallback(async (email?: string) => {
    try {
      return await ipcRenderer.invoke('license:openCheckout', email);
    } catch (error) {
      console.error('Fehler beim Öffnen des Stripe Checkouts:', error);
      return false;
    }
  }, []);
  
  // Lizenz mit Stripe Session aktivieren
  const activateLicenseFromSession = useCallback(async (sessionId: string, environment: string = 'test') => {
    try {
      console.log(`[License] Aktiviere Lizenz aus Stripe Session: ${sessionId}, Umgebung: ${environment}`);
      const success = await ipcRenderer.invoke('license:activateFromSession', { sessionId, environment });
      if (success) {
        await fetchLicenseStatus();
      }
      return success;
    } catch (error) {
      console.error('Fehler bei der Lizenzaktivierung aus Stripe Session:', error);
      return false;
    }
  }, [fetchLicenseStatus]);

  // Lizenzstatus prüfen
  const checkLicenseStatus = useCallback(async () => {
    try {
      const isValid = await ipcRenderer.invoke('license:checkStatus');
      await fetchLicenseStatus();
      return isValid;
    } catch (error) {
      console.error('Fehler bei der Lizenzprüfung:', error);
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
    refreshStatus: fetchLicenseStatus
  };
}
