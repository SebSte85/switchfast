import { PersistentProcessIdentifier } from "../types";

interface ProcessInfo {
  id: number;
  name: string;
  title: string;
  path?: string;
}

/**
 * Escaped spezielle Steuerzeichen in einem String für sicheres JSON-Parsing
 */
function escapeControlCharacters(str: string): string {
  if (!str) return str;

  return str
    .replace(/\x00/g, "\\x00") // NULL
    .replace(/\x01/g, "\\x01") // SOH
    .replace(/\x02/g, "\\x02") // STX
    .replace(/\x03/g, "\\x03") // ETX
    .replace(/\x04/g, "\\x04") // EOT
    .replace(/\x05/g, "\\x05") // ENQ
    .replace(/\x06/g, "\\x06") // ACK
    .replace(/\x07/g, "\\x07") // BEL (Bell) - das Problem aus den Logs!
    .replace(/\x08/g, "\\x08") // BS
    .replace(/\x0B/g, "\\x0B") // VT
    .replace(/\x0C/g, "\\x0C") // FF
    .replace(/\x0E/g, "\\x0E") // SO
    .replace(/\x0F/g, "\\x0F") // SI
    .replace(/\x10/g, "\\x10") // DLE
    .replace(/\x11/g, "\\x11") // DC1
    .replace(/\x12/g, "\\x12") // DC2
    .replace(/\x13/g, "\\x13") // DC3
    .replace(/\x14/g, "\\x14") // DC4
    .replace(/\x15/g, "\\x15") // NAK
    .replace(/\x16/g, "\\x16") // SYN
    .replace(/\x17/g, "\\x17") // ETB
    .replace(/\x18/g, "\\x18") // CAN
    .replace(/\x19/g, "\\x19") // EM
    .replace(/\x1A/g, "\\x1A") // SUB
    .replace(/\x1B/g, "\\x1B") // ESC
    .replace(/\x1C/g, "\\x1C") // FS
    .replace(/\x1D/g, "\\x1D") // GS
    .replace(/\x1E/g, "\\x1E") // RS
    .replace(/\x1F/g, "\\x1F") // US
    .replace(/\x7F/g, "\\x7F"); // DEL
}

/**
 * Hilfsfunktion zum Erstellen eines persistenten Identifikators für einen Prozess
 * Diese Funktion normalisiert den executableName zu lowercase für konsistente Vergleiche
 */
export function createPersistentIdentifier(
  process: ProcessInfo
): PersistentProcessIdentifier {
  // Stelle sicher, dass der executableName normalisiert wird, um Konsistenz zu gewährleisten
  // Wir normalisieren den Namen, indem wir ihn in Kleinbuchstaben umwandeln
  const normalizedName = process.name ? process.name.toLowerCase() : "";

  // Escape Steuerzeichen im Titel für sicheres JSON-Parsing
  const safeTitlePattern = process.title
    ? escapeControlCharacters(process.title)
    : "";

  return {
    executablePath: process.path,
    executableName: normalizedName, // Normalisierter Name für konsistente Vergleiche
    titlePattern: safeTitlePattern,
  };
}
