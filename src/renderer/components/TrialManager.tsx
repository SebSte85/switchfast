import React, { useEffect, useState } from 'react';
import { ipcRenderer } from 'electron';
import TrialSignupModal from './TrialSignupModal';

interface LicenseStatus {
  isLicensed: boolean;
  isInTrial: boolean;
  remainingTrialDays: number;
  licenseKey: string | null;
  email: string | null;
  purchaseDate: string | null;
}

const TrialManager: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [showTrialSignup, setShowTrialSignup] = useState<boolean>(false);
  const [licenseStatus, setLicenseStatus] = useState<LicenseStatus | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Lizenzstatus beim Laden der Komponente abrufen
  useEffect(() => {
    const checkLicenseStatus = async () => {
      try {
        const status = await ipcRenderer.invoke('license:getStatus');
        setLicenseStatus(status);
        
        // Wenn keine Lizenz und kein aktiver Trial vorhanden ist, Trial-Signup anzeigen
        if (!status.isLicensed && !status.isInTrial) {
          setShowTrialSignup(true);
        }
      } catch (error) {
        console.error('Fehler beim Abrufen des Lizenzstatus:', error);
      } finally {
        setIsLoading(false);
      }
    };

    checkLicenseStatus();
  }, []);

  // Trial-Signup abgeschlossen
  const handleTrialComplete = async () => {
    setShowTrialSignup(false);
    
    // Lizenzstatus aktualisieren
    try {
      const status = await ipcRenderer.invoke('license:getStatus');
      setLicenseStatus(status);
    } catch (error) {
      console.error('Fehler beim Aktualisieren des Lizenzstatus:', error);
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
      
      {/* Zeige die Hauptanwendung nur, wenn kein Trial-Signup angezeigt wird oder Lizenz/Trial gültig ist */}
      {(!showTrialSignup && (licenseStatus?.isLicensed || licenseStatus?.isInTrial)) && children}
      
      {/* Zeige Lizenzinformationen, wenn verfügbar */}
      {licenseStatus && !showTrialSignup && (
        <div className="license-info-footer">
          {licenseStatus.isLicensed ? (
            <span>Lizenziert für: {licenseStatus.email}</span>
          ) : licenseStatus.isInTrial ? (
            <span>Trial-Version: Noch {licenseStatus.remainingTrialDays} Tage verbleibend</span>
          ) : null}
        </div>
      )}
    </>
  );
};

export default TrialManager;
