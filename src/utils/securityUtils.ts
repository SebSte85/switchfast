import * as path from "path";
import * as fs from "fs";
import { z } from "zod";

// 🛡️ SECURITY: Whitelist erlaubter Executables
const ALLOWED_EXECUTABLES = new Set([
  // System-Tools
  'notepad.exe',
  'calc.exe',
  'mspaint.exe',
  'wordpad.exe',
  
  // Browser
  'chrome.exe',
  'firefox.exe',
  'msedge.exe',
  'brave.exe',
  'opera.exe',
  
  // Office
  'winword.exe',
  'excel.exe',
  'powerpnt.exe',
  'outlook.exe',
  
  // Development
  'code.exe',
  'devenv.exe',
  'notepad++.exe',
  
  // Media
  'vlc.exe',
  'wmplayer.exe',
  'spotify.exe',
  
  // Gaming
  'steam.exe',
  'discord.exe',
  
  // Utilities
  '7zfm.exe',
  'explorer.exe',
  'taskmgr.exe'
]);

// 🛡️ SECURITY: Gefährliche Executables blacklist
const DANGEROUS_EXECUTABLES = new Set([
  'cmd.exe',
  'powershell.exe',
  'pwsh.exe',
  'wscript.exe',
  'cscript.exe',
  'rundll32.exe',
  'regsvr32.exe',
  'mshta.exe',
  'bitsadmin.exe',
  'certutil.exe',
  'sc.exe',
  'net.exe',
  'netsh.exe',
  'schtasks.exe',
  'wmic.exe'
]);

/**
 * 🛡️ SECURITY: Validiert und sanitized einen Executable-Pfad
 * Verhindert Command Injection und Path Traversal Attacks
 */
export function validateExecutablePath(executablePath: string): {
  isValid: boolean;
  sanitizedPath?: string;
  error?: string;
} {
  try {
    // 1. Null/undefined check
    if (!executablePath || typeof executablePath !== 'string') {
      return { isValid: false, error: 'Invalid executable path: null or undefined' };
    }

    // 2. Längen-Validierung
    if (executablePath.length > 260) { // MAX_PATH für Windows
      return { isValid: false, error: 'Executable path too long (>260 characters)' };
    }

    // 3. Path Traversal Prevention
    const normalizedPath = path.normalize(executablePath);
    if (normalizedPath.includes('..') || normalizedPath.includes('//')) {
      return { isValid: false, error: 'Path traversal attempt detected' };
    }

    // 4. Gefährliche Zeichen filtern
    const dangerousChars = /[<>"|?*\x00-\x1f]/;
    if (dangerousChars.test(normalizedPath)) {
      return { isValid: false, error: 'Dangerous characters in path' };
    }

    // 5. Executable-Name extrahieren
    const executableName = path.basename(normalizedPath).toLowerCase();
    
    // 6. Blacklist check (gefährliche Executables)
    if (DANGEROUS_EXECUTABLES.has(executableName)) {
      return { isValid: false, error: `Dangerous executable blocked: ${executableName}` };
    }

    // 7. Whitelist check (nur erlaubte Executables)
    if (!ALLOWED_EXECUTABLES.has(executableName)) {
      return { isValid: false, error: `Executable not in whitelist: ${executableName}` };
    }

    // 8. Datei-Existenz prüfen
    if (!fs.existsSync(normalizedPath)) {
      return { isValid: false, error: 'Executable file does not exist' };
    }

    // 9. Ist es wirklich eine ausführbare Datei?
    const stats = fs.statSync(normalizedPath);
    if (!stats.isFile()) {
      return { isValid: false, error: 'Path does not point to a file' };
    }

    // 10. Executable-Extension prüfen
    const extension = path.extname(normalizedPath).toLowerCase();
    if (extension !== '.exe') {
      return { isValid: false, error: 'Only .exe files are allowed' };
    }

    return {
      isValid: true,
      sanitizedPath: normalizedPath
    };

  } catch (error) {
    return { 
      isValid: false, 
      error: `Security validation failed: ${error instanceof Error ? error.message : 'Unknown error'}` 
    };
  }
}

/**
 * 🛡️ SECURITY: IPC Input Validation Schemas
 */
export const IpcSchemas = {
  themeUpdate: z.object({
    themeId: z.string().uuid('Invalid theme ID format'),
    updatedTheme: z.object({
      id: z.string().uuid(),
      name: z.string().min(1).max(100, 'Theme name too long'),
      shortcut: z.string().max(20, 'Shortcut too long').optional(),
      processes: z.array(z.object({
        id: z.number().int().positive(),
        name: z.string().max(255),
        title: z.string().max(1000),
        path: z.string().max(260).optional()
      })).max(100, 'Too many processes'),
      persistentProcesses: z.array(z.object({
        executableName: z.string().max(255),
        executablePath: z.string().max(260).optional()
      })).max(50, 'Too many persistent processes').optional()
    })
  }),

  minimizeApplications: z.object({
    appIds: z.array(z.number().int().positive()).max(100, 'Too many application IDs')
  }),

  registerShortcut: z.object({
    themeId: z.string().uuid('Invalid theme ID format'),
    shortcut: z.string().min(1).max(20, 'Shortcut string too long')
  }),

  deviceId: z.object({
    deviceId: z.string().min(1).max(100, 'Device ID too long')
  })
};

/**
 * 🛡️ SECURITY: Sichere IPC-Handler Wrapper Funktion
 */
export function createSecureIpcHandler<T>(
  schema: z.ZodSchema<T>,
  handler: (validatedData: T, event: any) => Promise<any> | any
) {
  return async (event: any, ...args: any[]) => {
    try {
      // Input validieren
      const validatedData = schema.parse(args.length === 1 ? args[0] : args);
      
      // Sicheren Handler aufrufen
      return await handler(validatedData, event);
      
    } catch (error) {
      if (error instanceof z.ZodError) {
        const validationErrors = error.errors.map((err: z.ZodIssue) => 
          `${err.path.join('.')}: ${err.message}`
        ).join(', ');
        
        console.error('[SECURITY] IPC Input validation failed:', validationErrors);
        throw new Error(`Input validation failed: ${validationErrors}`);
      }
      
      console.error('[SECURITY] IPC Handler error:', error);
      throw error;
    }
  };
}

/**
 * 🛡️ SECURITY: String Sanitization
 */
export function sanitizeString(input: string, maxLength = 1000): string {
  if (typeof input !== 'string') return '';
  
  return input
    .replace(/[<>'"&]/g, '') // HTML/Script injection prevention
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '') // Control characters
    .replace(/\0/g, '') // Null bytes
    .substring(0, maxLength)
    .trim();
}

/**
 * 🛡️ SECURITY: Process ID Validation
 */
export function validateProcessId(pid: number): boolean {
  return Number.isInteger(pid) && pid > 0 && pid < 2147483647; // Max 32-bit signed int
}

/**
 * 🛡️ SECURITY: Rate Limiting für IPC Calls
 */
class IpcRateLimiter {
  private callCounts = new Map<string, { count: number; resetTime: number }>();
  private readonly maxCalls: number;
  private readonly windowMs: number;

  constructor(maxCalls = 100, windowMs = 60000) { // 100 calls per minute default
    this.maxCalls = maxCalls;
    this.windowMs = windowMs;
  }

  checkLimit(identifier: string): boolean {
    const now = Date.now();
    const record = this.callCounts.get(identifier);

    if (!record || now > record.resetTime) {
      this.callCounts.set(identifier, { count: 1, resetTime: now + this.windowMs });
      return true;
    }

    if (record.count >= this.maxCalls) {
      return false;
    }

    record.count++;
    return true;
  }

  reset(identifier: string): void {
    this.callCounts.delete(identifier);
  }
}

export const ipcRateLimiter = new IpcRateLimiter();

/**
 * 🛡️ SECURITY: Logging für Security Events
 */
export function logSecurityEvent(
  event: string, 
  details: Record<string, any>, 
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' = 'MEDIUM'
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    event,
    severity,
    details,
    process: process.pid
  };

  console.warn(`[SECURITY-${severity}] ${event}:`, logEntry);
  
  // In production: send to centralized logging system
  if (process.env.NODE_ENV === 'production') {
    // TODO: Implement centralized security logging
  }
}