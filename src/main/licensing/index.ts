import { LicenseManager } from "./licenseManager";
import { setupLicenseIPC } from "./licenseIpc";

/**
 * Initialisiert das Lizenzsystem
 */
export function initLicenseSystem() {
  const licenseManager = LicenseManager.getInstance();
  setupLicenseIPC(licenseManager);

  // Lizenzstatus sofort prüfen
  licenseManager.checkLicenseStatus().catch((err) => {
    console.error("Fehler bei der initialen Lizenzprüfung:", err);
  });

  return licenseManager;
}

/**
 * Gibt den LicenseManager zurück
 */
export function getLicenseManager(): LicenseManager {
  return LicenseManager.getInstance();
}

/**
 * Prüft, ob die App lizenziert ist oder im Trial-Modus läuft
 */
export async function isAppAllowedToRun(): Promise<boolean> {
  const licenseManager = LicenseManager.getInstance();
  await licenseManager.waitUntilReady();

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
  const licenseManager = LicenseManager.getInstance();
  licenseManager.dispose();
}
