import { LicenseManager } from './licenseManager';
import { setupLicenseIPC } from './licenseIpc';

let licenseManager: LicenseManager | null = null;

/**
 * Initialisiert das Lizenzsystem
 */
export function initLicenseSystem() {
  if (!licenseManager) {
    licenseManager = new LicenseManager();
    setupLicenseIPC(licenseManager);
    
    // Lizenzstatus sofort prüfen
    licenseManager.checkLicenseStatus().catch(err => {
      console.error('Fehler bei der initialen Lizenzprüfung:', err);
    });
  }
  
  return licenseManager;
}

/**
 * Gibt den LicenseManager zurück
 */
export function getLicenseManager(): LicenseManager | null {
  return licenseManager;
}

/**
 * Prüft, ob die App lizenziert ist oder im Trial-Modus läuft
 */
export async function isAppAllowedToRun(): Promise<boolean> {
  if (!licenseManager) {
    throw new Error('Lizenzsystem wurde nicht initialisiert');
  }
  
  // Prüfen, ob eine gültige Lizenz vorhanden ist
  const isLicensed = licenseManager.isLicensed();
  if (isLicensed) {
    return true;
  }
  
  // Wenn keine Lizenz vorhanden ist, prüfen wir den Trial-Status
  const isInTrial = licenseManager.isInTrial();
  return isInTrial;
}

/**
 * Bereinigt Ressourcen des Lizenzsystems
 */
export function disposeLicenseSystem() {
  if (licenseManager) {
    licenseManager.dispose();
    licenseManager = null;
  }
}
