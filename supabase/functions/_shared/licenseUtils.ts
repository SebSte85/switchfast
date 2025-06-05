/**
 * Hilfsfunktionen für die Lizenzverwaltung
 */

/**
 * Generiert einen eindeutigen Lizenzschlüssel im Format XXXX-XXXX-XXXX-XXXX
 * @returns Generierter Lizenzschlüssel
 */
export function generateLicenseKey(): string {
  const segments = 4;
  const segmentLength = 4;
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Ohne I, O, 0, 1 zur Vermeidung von Verwechslungen
  
  let key = '';
  
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < segmentLength; j++) {
      const randomIndex = Math.floor(Math.random() * chars.length);
      key += chars[randomIndex];
    }
    
    if (i < segments - 1) {
      key += '-';
    }
  }
  
  return key;
}

/**
 * Validiert einen Lizenzschlüssel
 * @param licenseKey Der zu validierende Lizenzschlüssel
 * @returns true, wenn der Lizenzschlüssel gültig ist, sonst false
 */
export function validateLicenseKey(licenseKey: string): boolean {
  // Prüfen, ob der Lizenzschlüssel dem Format XXXX-XXXX-XXXX-XXXX entspricht
  const regex = /^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
  return regex.test(licenseKey);
}
