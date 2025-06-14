import { app, dialog } from "electron";
import Store from "electron-store";
import { machineIdSync } from "node-machine-id";
import * as os from "os";
import * as crypto from "crypto";
import axios from "axios";
import path from "path";
import console, { error } from "console";

// Typdefinitionen
interface LicenseInfo {
  licenseKey: string;
  isActive: boolean;
  email?: string;
  purchaseDate?: string;
  lastVerified: string;
  subscriptionEndDate?: string; // Neues Feld für Subscription-Ablauf
  isSubscription?: boolean; // Unterscheidung zwischen einmalig und Subscription
  stripeSubscriptionId?: string;
  cancelledAt?: string; // Wann wurde die Subscription gekündigt
  cancelsAtPeriodEnd?: boolean; // Wird am Ende der Periode gekündigt
}

interface DeviceInfo {
  deviceId: string;
  deviceName: string;
}

interface TrialInfo {
  trialStartDate: string;
  trialEndDate: string;
  isTrialActive: boolean;
  remainingDays: number;
  email?: string;
  privacyConsentGiven?: boolean;
}

// Konfiguration
const SUPABASE_API_URL =
  "https://foqnvgvtyluvektevlab.supabase.co/functions/v1"; // Supabase Functions URL
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvcW52Z3Z0eWx1dmVrdGV2bGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkwMTYwMzUsImV4cCI6MjA2NDU5MjAzNX0.q2A6m7bQuKPb-VZNIBoizUVXS1LsgacM6QOVIaqrN1Q";

// Environment Configuration - zur Build-Zeit aus package.json injiziert
const ACTIVE_ENVIRONMENT = (() => {
  try {
    // In Electron können wir package.json auch aus dem ASAR-Archive lesen
    const packageJson = require("../../../package.json");
    const environment = packageJson.environment || "test";
    console.log(
      "[LicenseManager] Umgebung aus package.json extraMetadata:",
      environment
    );
    console.log(
      "[LicenseManager] package.json.environment raw value:",
      packageJson.environment
    );
    console.log(
      "[LicenseManager] package.json keys:",
      Object.keys(packageJson)
    );
    if (packageJson.environment) {
      console.log(
        "[LicenseManager] ✅ environment found in package.json:",
        packageJson.environment
      );
    } else {
      console.log(
        "[LicenseManager] ❌ environment NOT found in package.json, using fallback 'test'"
      );
    }
    return environment;
  } catch (error) {
    console.log(
      "[LicenseManager] Fallback auf 'test' - package.json.environment nicht gefunden"
    );
    console.log(
      "[LicenseManager] Error:",
      error instanceof Error ? error.message : String(error)
    );
    return "test";
  }
})();

const LICENSE_CHECK_INTERVAL = 30 * 60 * 1000; // 30 Minuten (vorher 4 Stunden)
const OFFLINE_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 Tage in Millisekunden
const TRIAL_CHECK_INTERVAL = 15 * 60 * 1000; // 15 Minuten für Trial-Checks
const APP_SALT =
  process.env.DEVICE_ID_SALT || "72a491de66fd8e66ea4eff96cd299dbc";

// Verschlüsselter Store für sensible Daten
const secureStore = new Store({
  name: "workfocus-license",
  encryptionKey:
    process.env.LICENSE_ENCRYPTION_KEY ||
    "6d24f9b2d334e2095f93b7de9b63df751650956b9e74378d727d163216b673fd",
});

// Regulärer Store für nicht-sensible Daten
const store = new Store({ name: "workfocus-config" });

export class LicenseManager {
  private static instance: LicenseManager | null = null;
  private isDevelopmentMode: boolean;
  private isReady: boolean = false;
  private licenseCheckTimer: NodeJS.Timeout | null = null;
  private trialCheckTimer: NodeJS.Timeout | null = null; // Neuer Timer für Trial-Checks
  private deviceInfo: DeviceInfo;

  private constructor() {
    this.isDevelopmentMode = process.env.NODE_ENV === "development";
    this.deviceInfo = this.getDeviceInfo();

    console.log(`[LicenseManager] Device ID: ${this.getDeviceId()}`);
    console.log(`[LicenseManager] ACTIVE_ENVIRONMENT: ${ACTIVE_ENVIRONMENT}`);
    console.log(`[LicenseManager] NODE_ENV: ${process.env.NODE_ENV}`);
    console.log(
      `[LicenseManager] process.env.ACTIVE_ENVIRONMENT: ${process.env.ACTIVE_ENVIRONMENT}`
    );

    if (this.isDevelopmentMode) {
      console.log("[LicenseManager] Development mode: Clearing local data");
      this.clearLocalData();
    }

    this.setupLicenseChecks();

    // Initialize async - load privacy consent from database
    this.initializeAsync();
  }

  public static getInstance(): LicenseManager {
    if (!this.instance) {
      this.instance = new LicenseManager();
    }
    return this.instance;
  }

  private clearLocalData(): void {
    secureStore.clear();
    store.clear();
  }

  private async initializeAsync(): Promise<void> {
    try {
      // Load privacy consent with shorter timeout to prevent app hanging
      // But still preserve license logic - if this fails, we fall back to local data
      const timeout = new Promise((_, reject) => {
        setTimeout(
          () => reject(new Error("Privacy consent loading timeout")),
          5000
        ); // 5 seconds timeout
      });

      await Promise.race([this.loadPrivacyConsentFromDatabase(), timeout]);

      this.isReady = true;
      console.log("[LicenseManager] Initialization completed successfully");
    } catch (error) {
      console.warn(
        "[LicenseManager] Privacy consent loading failed, falling back to local data:",
        error
      );

      // Send error to frontend with specific error type
      this.sendErrorToFrontend(error);

      // Still mark as ready - the license/trial checks will work with local data
      // The app will still enforce proper license/trial restrictions
      this.isReady = true;
    }
  }

  private sendErrorToFrontend(error: any): void {
    try {
      const { BrowserWindow } = require("electron");
      const mainWindow =
        BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];

      if (mainWindow) {
        let errorMessage = "Unknown initialization error";
        let canWorkOffline = false;

        if (
          error.message.includes("timeout") ||
          error.message.includes("network") ||
          error.code === "ENOTFOUND"
        ) {
          errorMessage =
            "Network connection timeout - unable to verify license online";
          canWorkOffline = this.hasLocalLicenseOrTrial();
        } else if (error.code === "ECONNREFUSED") {
          errorMessage = "License server unavailable - working with local data";
          canWorkOffline = this.hasLocalLicenseOrTrial();
        } else {
          errorMessage = error.message || "License verification failed";
          canWorkOffline = this.hasLocalLicenseOrTrial();
        }

        mainWindow.webContents.send("initialization-error", errorMessage);

        if (canWorkOffline) {
          mainWindow.webContents.send("offline-mode", true);
        }
      }
    } catch (e) {
      console.error("[LicenseManager] Failed to send error to frontend:", e);
    }
  }

  private hasLocalLicenseOrTrial(): boolean {
    const licenseInfo = this.getLicenseInfo();
    const trialInfo = this.getTrialInfo();

    // Check if we have valid local license data
    if (licenseInfo && licenseInfo.isActive) {
      const lastVerified = new Date(licenseInfo.lastVerified).getTime();
      const now = new Date().getTime();
      // If verified within grace period, we can work offline
      if (now - lastVerified < OFFLINE_GRACE_PERIOD) {
        return true;
      }
    }

    // Check if we have valid local trial data
    if (trialInfo && trialInfo.isTrialActive && trialInfo.remainingDays > 0) {
      return true;
    }

    return false;
  }

  /**
   * Wartet, bis der LicenseManager vollständig initialisiert ist
   */
  public async waitUntilReady(): Promise<void> {
    while (!this.isReady) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  /**
   * Gibt die Geräte-Informationen zurück
   */
  private getDeviceInfo(): DeviceInfo {
    try {
      const deviceId = this.getDeviceId();
      const deviceName = os.hostname();
      return { deviceId, deviceName };
    } catch (error) {
      console.error("Fehler beim Abrufen der Geräte-Informationen:", error);
      return { deviceId: "unknown", deviceName: "unknown" };
    }
  }

  /**
   * Generiert eine eindeutige, gehashte Geräte-ID
   */
  public getDeviceId(): string {
    try {
      // Verwende node-machine-id für eine eindeutige ID
      const rawId = machineIdSync();

      // Hash die ID mit einem App-spezifischen Salt
      const hashedId = crypto
        .createHash("sha256")
        .update(rawId + APP_SALT)
        .digest("hex");

      return hashedId;
    } catch (error) {
      console.error("Fehler beim Generieren der Geräte-ID:", error);

      // Fallback: Verwende Systeminformationen, wenn node-machine-id fehlschlägt
      const fallbackId = crypto
        .createHash("sha256")
        .update(
          os.hostname() +
            os.platform() +
            os.arch() +
            os.cpus()[0].model +
            APP_SALT
        )
        .digest("hex");

      return fallbackId;
    }
  }

  /**
   * Richtet regelmäßige Lizenzprüfungen ein
   */
  private setupLicenseChecks() {
    // Delay initial license check to prevent blocking app startup
    // But still ensure license validation happens
    setTimeout(() => {
      this.checkLicenseStatus().catch((error) => {
        console.warn(
          "[LicenseManager] Initial license check failed (non-blocking):",
          error
        );
      });
    }, 2000); // 2 second delay

    // Regelmäßige Prüfungen
    this.licenseCheckTimer = setInterval(() => {
      this.checkLicenseStatus().catch((error) => {
        console.warn("[LicenseManager] Periodic license check failed:", error);
      });
    }, LICENSE_CHECK_INTERVAL);

    // Separater Timer für Trial-Checks (häufiger)
    this.trialCheckTimer = setInterval(() => {
      this.performTrialCheck().catch((error) => {
        console.warn("[LicenseManager] Periodic trial check failed:", error);
      });
    }, TRIAL_CHECK_INTERVAL);

    // Zusätzliche Prüfung, wenn der Computer aus dem Ruhezustand erwacht
    try {
      const powerMonitor = require("electron").powerMonitor;
      powerMonitor.on("resume", () => {
        this.checkLicenseStatus().catch((error) => {
          console.warn("[LicenseManager] Resume license check failed:", error);
        });
      });
    } catch (error) {
      console.warn("[LicenseManager] PowerMonitor setup failed:", error);
    }
  }

  /**
   * Prüft den Lizenzstatus beim Server
   */
  public async checkLicenseStatus(): Promise<boolean> {
    try {
      // Immer zuerst die Edge Function aufrufen, um den Lizenzstatus zu überprüfen
      // unabhängig davon, ob lokal eine Lizenz gespeichert ist
      try {
        const response = await axios.post(
          `${SUPABASE_API_URL}/checkLicenseStatus`,
          {
            deviceId: this.deviceInfo.deviceId,
          },
          {
            headers: {
              "x-environment": ACTIVE_ENVIRONMENT,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
            timeout: 5000, // Timeout nach 5 Sekunden
          }
        );

        const data = response.data;
        // Debug: Edge Function Response Data

        if (data.success && data.is_license_valid && data.is_device_activated) {
          // Subscription-Ablauf prüfen falls vorhanden
          const subscriptionEndDate = data.subscription_end_date;
          const isSubscription = data.is_subscription || !!subscriptionEndDate;

          // Prüfe ob Subscription abgelaufen ist
          if (isSubscription && subscriptionEndDate) {
            const endDate = new Date(subscriptionEndDate);
            const now = new Date();

            if (now > endDate) {
              console.log("Subscription ist abgelaufen:", subscriptionEndDate);
              this.showSubscriptionExpiredDialog();
              return false;
            }
          }

          // Lizenz ist gültig und Gerät ist aktiviert
          // Lokale Lizenzinformationen aktualisieren oder erstellen
          const licenseInfo = this.getLicenseInfo() || {
            licenseKey: data.license_key,
            isActive: true,
            lastVerified: new Date().toISOString(),
          };

          this.updateLicenseInfo({
            ...licenseInfo,
            isActive: true,
            lastVerified: new Date().toISOString(),
            subscriptionEndDate,
            isSubscription,
            stripeSubscriptionId: data.stripe_subscription_id,
            email: data.email,
            cancelledAt: data.cancelled_at,
            cancelsAtPeriodEnd: data.cancels_at_period_end,
          });
          return true;
        } else {
          // Auch für inaktive Lizenzen/Geräte die Subscription-Info speichern
          // (wichtig für gecancelte Subscriptions)
          if (
            data.success &&
            (data.cancelled_at || data.cancels_at_period_end)
          ) {
            // Lokale Lizenzinformationen mit Cancellation-Daten aktualisieren
            const existingLicenseInfo = this.getLicenseInfo();

            // Prüfe ob Subscription noch gültig ist (auch wenn gecancelt)
            const subscriptionEndDate = data.subscription_end_date;
            const now = new Date();
            const endDate = subscriptionEndDate
              ? new Date(subscriptionEndDate)
              : null;
            const isStillValid = endDate ? now <= endDate : false;

            const updatedLicenseInfo = {
              ...existingLicenseInfo,
              licenseKey:
                data.license_key || existingLicenseInfo?.licenseKey || "",
              isActive: isStillValid, // Subscription ist aktiv bis zum Ende der Billing Period
              lastVerified: new Date().toISOString(),
              subscriptionEndDate: data.subscription_end_date,
              isSubscription:
                data.is_subscription || !!data.subscription_end_date,
              stripeSubscriptionId: data.stripe_subscription_id,
              email: data.email,
              cancelledAt: data.cancelled_at,
              cancelsAtPeriodEnd: data.cancels_at_period_end,
            };

            this.updateLicenseInfo(updatedLicenseInfo);
          }

          // Keine gültige Lizenz gefunden oder Gerät nicht aktiviert
          if (data.success && !data.is_license_valid) {
            return await this.checkTrialStatus();
          } else if (
            data.success &&
            data.is_license_valid &&
            !data.is_device_activated
          ) {
            // Lizenz gefunden, aber Gerät nicht aktiviert
            if (data.license_key) {
              const activated = await this.activateDevice(data.license_key);
              return activated;
            }
          }

          // Fallback auf Trial-Status
          return await this.checkTrialStatus();
        }
      } catch (error) {
        console.error("Fehler bei der Online-Lizenzverifizierung:", error);

        // Bei Serverfehler oder Offline-Zustand lokale Daten verwenden
        const licenseInfo = this.getLicenseInfo();

        if (!licenseInfo) {
          return await this.checkTrialStatus();
        }

        // Offline-Gnadenfrist prüfen
        const lastVerified = new Date(licenseInfo.lastVerified).getTime();
        const now = new Date().getTime();

        if (now - lastVerified < OFFLINE_GRACE_PERIOD) {
          console.log("Offline-Gnadenfrist aktiv, Lizenz temporär gültig");
          return true;
        } else {
          console.log("Offline-Gnadenfrist abgelaufen");
          this.showOfflineGracePeriodExpiredDialog();
          return false;
        }
      }
    } catch (error) {
      console.error("Unerwarteter Fehler bei der Lizenzprüfung:", error);
      return false;
    }

    return false;
  }

  /**
   * Führt eine periodische Trial-Überprüfung durch
   * Diese Methode wird von einem Timer aufgerufen und beendet die App wenn der Trial abgelaufen ist
   */
  private async performTrialCheck(): Promise<void> {
    try {
      // Nur Trial-Check wenn keine aktive Lizenz vorhanden ist
      if (this.isLicensed()) {
        return; // Lizenz vorhanden, Trial-Check nicht nötig
      }

      console.log(
        "[LicenseManager] 🔍 Periodic trial check - prüfe Trial-Status..."
      );

      const isTrialValid = await this.checkTrialStatus();

      if (!isTrialValid) {
        console.log("[LicenseManager] ⚠️ Trial abgelaufen - App wird beendet");

        // Zeige Benachrichtigung und beende die App
        const { dialog, app } = require("electron");

        const response = await dialog.showMessageBox({
          type: "warning",
          title: "Trial-Version abgelaufen",
          message: "Ihre 7-tägige Testversion ist abgelaufen.",
          detail:
            "Die Anwendung wird jetzt beendet. Bitte erwerben Sie eine Lizenz, um SwitchFast weiterhin zu verwenden.",
          buttons: ["Lizenz kaufen", "App beenden"],
          defaultId: 0,
          cancelId: 1,
        });

        if (response.response === 0) {
          // Benutzer möchte Lizenz kaufen
          await this.openStripeCheckout();
        }

        // App beenden nach 3 Sekunden (Zeit für Stripe-Checkout-Öffnung)
        setTimeout(() => {
          app.quit();
        }, 3000);
      }
    } catch (error) {
      console.error(
        "[LicenseManager] Fehler bei periodischer Trial-Prüfung:",
        error
      );
    }
  }

  /**
   * Prüft den Trial-Status
   */
  public async checkTrialStatus(): Promise<boolean> {
    try {
      // Lokalen Trial-Status abrufen
      const localTrialInfo = this.getTrialInfo();

      // Versuchen, den Trial-Status online zu verifizieren
      try {
        const response = await axios.post(
          `${SUPABASE_API_URL}/checkTrialStatus`,
          {
            deviceId: this.deviceInfo.deviceId,
          },
          {
            headers: {
              "x-environment": ACTIVE_ENVIRONMENT,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
            // Timeout nach 5 Sekunden
            timeout: 5000,
          }
        );

        const data = response.data;

        if (data && data.success) {
          // Trial-Informationen aktualisieren
          const trialInfo: TrialInfo = {
            trialStartDate: data.trial_start_date,
            trialEndDate: data.trial_end_date,
            isTrialActive: data.is_trial_active,
            remainingDays: data.remaining_days,
          };

          this.updateTrialInfo(trialInfo);

          if (!data.is_trial_active) {
            this.showTrialExpiredDialog();
            return false;
          }

          return true;
        } else {
          console.warn("Unerwartete Antwort vom Server:", data);
          // Auf lokale Daten zurückgreifen
          return this.handleLocalTrialCheck(localTrialInfo);
        }
      } catch (error) {
        console.error("Fehler bei der Online-Trial-Verifizierung:", error);

        // Bei Serverfehler oder Offline-Zustand lokale Daten verwenden
        return this.handleLocalTrialCheck(localTrialInfo);
      }
    } catch (error) {
      console.error("Unerwarteter Fehler bei der Trial-Prüfung:", error);
      return false;
    }
  }

  /**
   * Verarbeitet die Trial-Prüfung mit lokalen Daten
   */
  private handleLocalTrialCheck(localTrialInfo: TrialInfo | null): boolean {
    try {
      // Wenn wir keine Trial-Informationen haben, KEINEN neuen Trial mehr starten!
      if (!localTrialInfo) {
        // Schreibe explizit eine abgelaufene Trial-Info in den Store
        const now = new Date();
        const expiredTrialInfo: TrialInfo = {
          trialStartDate: now.toISOString(),
          trialEndDate: now.toISOString(),
          isTrialActive: false,
          remainingDays: 0,
        };
        this.updateTrialInfo(expiredTrialInfo);
        return false;
      }

      // Prüfen, ob der Trial noch aktiv ist
      const now = new Date();
      const trialEndDate = new Date(localTrialInfo.trialEndDate);

      if (now > trialEndDate || localTrialInfo.isTrialActive === false) {
        // Trial ist abgelaufen oder explizit deaktiviert
        const expiredTrialInfo: TrialInfo = {
          ...localTrialInfo,
          isTrialActive: false,
          remainingDays: 0,
        };
        this.updateTrialInfo(expiredTrialInfo);
        this.showTrialExpiredDialog();
        return false;
      }

      // Trial ist noch aktiv, verbleibende Tage berechnen
      const remainingDays = Math.ceil(
        (trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
      );
      const updatedTrialInfo: TrialInfo = {
        ...localTrialInfo,
        isTrialActive: true,
        remainingDays,
      };
      this.updateTrialInfo(updatedTrialInfo);
      return true;
    } catch (error) {
      console.error("Unerwarteter Fehler bei der Trial-Prüfung:", error);
      return false;
    }
  }

  /**
   * Aktiviert ein Gerät für eine Lizenz
   */
  public async activateDevice(licenseKey: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${SUPABASE_API_URL}/activateDevice`,
        {
          licenseKey,
          deviceId: this.deviceInfo.deviceId,
          deviceName: this.deviceInfo.deviceName,
        },
        {
          headers: {
            "x-environment": ACTIVE_ENVIRONMENT,
          },
        }
      );

      const data = response.data;

      if (data.success) {
        // Lizenzinformationen speichern
        this.updateLicenseInfo({
          licenseKey,
          isActive: true,
          lastVerified: new Date().toISOString(),
        });

        return true;
      } else {
        if (data.error && data.error.includes("Maximale Anzahl an Geräten")) {
          this.showMaxDevicesReachedDialog();
        } else {
          this.showActivationFailedDialog();
        }
        return false;
      }
    } catch (error) {
      console.error("Fehler bei der Geräteaktivierung:", error);
      this.showActivationFailedDialog();
      return false;
    }
  }

  /**
   * Deaktiviert ein Gerät für eine Lizenz
   */
  public async deactivateDevice(licenseKey: string): Promise<boolean> {
    try {
      const deviceId = this.getDeviceId();
      const deviceName = os.hostname();

      const response = await axios.post(
        `${SUPABASE_API_URL}/deactivateDevice`,
        {
          licenseKey,
          deviceId,
          deviceName,
        },
        {
          headers: {
            "x-environment": ACTIVE_ENVIRONMENT,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );

      const data = response.data;

      if (data.success) {
        // Lizenzinformationen aus dem lokalen Speicher entfernen
        secureStore.delete("licenseInfo");
        return true;
      }

      return false;
    } catch (error) {
      console.error("Fehler bei der Deaktivierung:", error);
      return false;
    }
  }

  /**
   * Deaktiviert ein bestimmtes Gerät für eine Lizenz
   */
  public async deactivateSpecificDevice(
    licenseKey: string,
    deviceId: string
  ): Promise<boolean> {
    try {
      const response = await axios.post(
        `${SUPABASE_API_URL}/deactivateDevice`,
        {
          licenseKey,
          deviceId,
        },
        {
          headers: {
            "x-environment": ACTIVE_ENVIRONMENT,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );

      const data = response.data;

      if (data.success) {
        return true;
      }

      return false;
    } catch (error) {
      console.error("Fehler bei der Deaktivierung des Geräts:", error);
      return false;
    }
  }

  /**
   * Ruft alle aktivierten Geräte für eine Lizenz ab
   */
  public async getActivatedDevices(licenseKey: string): Promise<any[]> {
    try {
      const response = await axios.post(
        `${SUPABASE_API_URL}/getActivatedDevices`,
        {
          licenseKey,
        },
        {
          headers: {
            "x-environment": ACTIVE_ENVIRONMENT,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );

      const data = response.data;

      if (data.success) {
        return data.devices || [];
      }

      return [];
    } catch (error) {
      console.error("Fehler beim Abrufen der aktivierten Geräte:", error);
      return [];
    }
  }

  /**
   * Öffnet den Stripe Checkout im Browser
   */
  public async openStripeCheckout(email?: string): Promise<void> {
    try {
      console.log(
        "🚀 [License] openStripeCheckout aufgerufen mit email:",
        email
      );

      // Umgebungsvariablen ausgeben (nur für Debugging)
      console.log("[License] Umgebungsvariablen:");
      console.log(`- ACTIVE_ENVIRONMENT: ${ACTIVE_ENVIRONMENT}`);

      console.log(
        `[License] 🔒 Verwende sichere Server-Side Checkout über Edge Function`
      );
      console.log(`[License] Environment: ${ACTIVE_ENVIRONMENT}`);

      // **NEU: Prüfung vor Checkout-Erstellung, ob bereits eine Lizenz existiert**
      try {
        const payload = {
          deviceId: this.deviceInfo.deviceId,
          deviceName: this.deviceInfo.deviceName,
          email: email,
          // Preis-ID wird server-seitig basierend auf Environment bestimmt
        };

        const headers = {
          "x-environment": ACTIVE_ENVIRONMENT,
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          "Content-Type": "application/json",
        };

        console.log("[License] 📤 Sende Request an createCheckoutSession:");
        console.log("- URL:", `${SUPABASE_API_URL}/createCheckoutSession`);
        console.log("- Payload:", JSON.stringify(payload, null, 2));
        console.log("- Headers:", JSON.stringify(headers, null, 2));

        const preCheckResponse = await axios.post(
          `${SUPABASE_API_URL}/createCheckoutSession`,
          payload,
          { headers }
        );

        console.log(
          "[License] 📥 Response von createCheckoutSession:",
          preCheckResponse.data
        );

        // Prüfe, ob Subscription reaktiviert wurde
        if (preCheckResponse.data.reactivated) {
          console.log("✅ Subscription wurde erfolgreich reaktiviert!");

          // Zeige Erfolg-Dialog
          const { dialog } = require("electron");
          dialog.showMessageBox({
            type: "info",
            title: "Subscription Reaktiviert",
            message: "Ihre Subscription wurde erfolgreich reaktiviert!",
            detail: "Sie haben wieder vollen Zugriff auf SwitchFast.",
            buttons: ["OK"],
          });

          // Aktualisiere Lizenzstatus
          await this.checkLicenseStatus();
          return;
        }

        if (preCheckResponse.data.success && preCheckResponse.data.url) {
          // Checkout-URL im Browser öffnen
          console.log(
            "[License] ✅ Öffne Stripe Checkout URL:",
            preCheckResponse.data.url
          );
          const { shell } = require("electron");
          await shell.openExternal(preCheckResponse.data.url);
          return;
        }
      } catch (error: any) {
        // Spezielle Behandlung für bereits lizenzierte Geräte
        if (error.response && error.response.status === 409) {
          const errorData = error.response.data;
          if (errorData.error === "DEVICE_ALREADY_LICENSED") {
            this.showDeviceAlreadyLicensedDialog(
              errorData.userMessage,
              errorData.existingLicenseEmail,
              errorData.suggestions || []
            );
            return;
          }
        }

        // Andere Fehler werfen, um sie unten zu behandeln
        throw error;
      }

      // Falls Edge Function fehlschlägt, zeige Fehler
      console.error(
        "[License] 🔴 Edge Function konnte keine Checkout-URL erstellen"
      );
      const errorDetails = {
        errorMessage: "Edge Function failed to create checkout session",
        errorCode: "EDGE_FUNCTION_NO_URL",
        environment: ACTIVE_ENVIRONMENT,
        deviceId: this.deviceInfo.deviceId,
        timestamp: new Date().toISOString(),
      };
      this.showCheckoutErrorDialog(errorDetails);
    } catch (error: any) {
      console.error(
        "🔴 [License] FEHLER beim Öffnen des Stripe Checkouts:",
        error
      );

      // Detailliertes Error-Logging
      const errorDetails = {
        errorMessage: error?.message || "Unknown error",
        errorCode: error?.code || "NO_CODE",
        errorStack: error?.stack || "No stack trace",
        axiosError: error?.response?.data || null,
        axiosStatus: error?.response?.status || null,
        stripeError: error?.type || null,
        environment: ACTIVE_ENVIRONMENT,
        deviceId: this.deviceInfo.deviceId,
        timestamp: new Date().toISOString(),
      };

      console.error(
        "🔴 [License] Error Details:",
        JSON.stringify(errorDetails, null, 2)
      );

      // PostHog Event für diesen spezifischen Fehler
      const { captureException } = require("../analytics");
      captureException(
        new Error(`Stripe Checkout Failed: ${error?.message}`),
        errorDetails
      );

      this.showCheckoutErrorDialog(errorDetails);
    }
  }

  /**
   * Gibt die Lizenzinformationen zurück
   */
  public getLicenseInfo(): LicenseInfo | null {
    const licenseInfo = secureStore.get("licenseInfo") as LicenseInfo | null;
    // Debug: Lokale License Info
    return licenseInfo;
  }

  /**
   * Aktualisiert die Lizenzinformationen
   */
  private updateLicenseInfo(licenseInfo: LicenseInfo): void {
    secureStore.set("licenseInfo", licenseInfo);
  }

  /**
   * Aktualisiert die Trial-Informationen
   */
  private updateTrialInfo(trialInfo: TrialInfo): void {
    secureStore.set("trialInfo", trialInfo);
  }

  /**
   * Gibt zurück, ob die App lizenziert ist
   */
  public isLicensed(): boolean {
    const licenseInfo = this.getLicenseInfo();
    if (!licenseInfo) return false;

    // Wenn die Lizenz als aktiv markiert ist und in den letzten 7 Tagen verifiziert wurde
    if (licenseInfo.isActive) {
      const lastVerified = new Date(licenseInfo.lastVerified);
      const now = new Date();
      const diffTime = Math.abs(now.getTime() - lastVerified.getTime());

      // Offline-Gnadenfrist: 7 Tage
      if (diffTime <= OFFLINE_GRACE_PERIOD) {
        return true;
      }
    }

    return false;
  }

  /**
   * Gibt zurück, ob die App im Trial-Modus läuft
   */
  public isInTrial(): boolean {
    const trialInfo = this.getTrialInfo();
    // Trial ist nur aktiv, wenn isTrialActive true und remainingDays > 0
    return trialInfo
      ? trialInfo.isTrialActive === true && trialInfo.remainingDays > 0
      : false;
  }

  /**
   * Gibt die verbleibenden Trial-Tage zurück
   */
  public getRemainingTrialDays(): number {
    const trialInfo = this.getTrialInfo();
    return trialInfo ? trialInfo.remainingDays : 0;
  }

  /**
   * Gibt die Trial-Informationen zurück
   */
  public getTrialInfo(): TrialInfo | null {
    try {
      const storedTrialInfo = secureStore.get("trialInfo") as
        | TrialInfo
        | undefined;

      if (!storedTrialInfo) {
        return null;
      }

      const now = new Date();
      const trialEndDate = new Date(storedTrialInfo.trialEndDate);

      // Berechne verbleibende Tage
      const diffTime = Math.max(0, trialEndDate.getTime() - now.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      // Aktualisiere Trial-Status
      const isTrialActive = now < trialEndDate;

      const updatedTrialInfo: TrialInfo = {
        ...storedTrialInfo,
        isTrialActive,
        remainingDays: diffDays,
      };

      // Speichere aktualisierte Informationen
      secureStore.set("trialInfo", updatedTrialInfo);

      return updatedTrialInfo;
    } catch (error) {
      console.error("Fehler beim Abrufen der Trial-Informationen:", error);
      return null;
    }
  }

  /**
   * Aktiviert den Trial-Modus für die aktuelle Geräte-ID
   */
  public async activateTrial(email: string): Promise<any> {
    try {
      // Prüfen, ob bereits ein Trial aktiv ist
      const existingTrialInfo = this.getTrialInfo();
      if (existingTrialInfo && existingTrialInfo.isTrialActive) {
        return {
          success: true,
          message: "Trial bereits aktiv",
          trialInfo: existingTrialInfo,
        };
      }

      // Trial über die Supabase Edge Function aktivieren
      const response = await axios.post(
        `${SUPABASE_API_URL}/checkTrialStatus`,
        { deviceId: this.deviceInfo.deviceId, email },
        {
          headers: {
            "Content-Type": "application/json",
            "x-environment": ACTIVE_ENVIRONMENT,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
        }
      );

      if (response.data && response.data.success) {
        // Trial-Informationen speichern
        const trialInfo: TrialInfo = {
          trialStartDate: response.data.trial_start_date,
          trialEndDate: response.data.trial_end_date,
          isTrialActive: response.data.is_trial_active,
          remainingDays: this.calculateRemainingDays(
            response.data.trial_end_date
          ),
          email: email,
        };

        secureStore.set("trialInfo", trialInfo);

        // Erfolgsdialog anzeigen
        dialog.showMessageBox({
          type: "info",
          title: "Trial aktiviert",
          message: `Ihre 7-tägige Testversion wurde erfolgreich aktiviert und läuft bis zum ${new Date(
            trialInfo.trialEndDate
          ).toLocaleDateString()}.`,
          buttons: ["OK"],
        });

        return {
          success: true,
          message: "Trial erfolgreich aktiviert",
          trialInfo,
        };
      } else {
        throw new Error(
          response.data?.error || "Unbekannter Fehler bei der Trial-Aktivierung"
        );
      }
    } catch (error) {
      console.error("Fehler bei der Trial-Aktivierung:", error);

      // Fehlerdialog anzeigen
      dialog.showMessageBox({
        type: "error",
        title: "Fehler bei der Trial-Aktivierung",
        message:
          error instanceof Error
            ? error.message
            : "Ein unbekannter Fehler ist aufgetreten.",
        buttons: ["OK"],
      });

      throw error;
    }
  }

  /**
   * Berechnet die verbleibenden Tage bis zu einem bestimmten Datum
   */
  private calculateRemainingDays(endDateStr: string): number {
    const now = new Date();
    const endDate = new Date(endDateStr);
    const diffTime = Math.max(0, endDate.getTime() - now.getTime());
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Zeigt einen Dialog an, wenn die Lizenz ungültig ist
   */
  private showLicenseInvalidDialog(): void {
    dialog
      .showMessageBox({
        type: "error",
        title: "Ungültige Lizenz",
        message: "Ihre Lizenz ist ungültig oder wurde deaktiviert.",
        buttons: ["Buy Annual Subscription", "Close"],
        defaultId: 0,
      })
      .then((result) => {
        if (result.response === 0) {
          this.openStripeCheckout();
        }
      });
  }

  /**
   * Zeigt einen Dialog an, wenn die Offline-Gnadenfrist abgelaufen ist
   */
  private showOfflineGracePeriodExpiredDialog(): void {
    dialog.showMessageBox({
      type: "error",
      title: "Offline-Gnadenfrist abgelaufen",
      message:
        "Die Offline-Gnadenfrist ist abgelaufen. Bitte stellen Sie eine Internetverbindung her, um Ihre Lizenz zu verifizieren.",
      buttons: ["OK"],
    });
  }

  /**
   * Zeigt einen Dialog an, wenn der Trial abgelaufen ist
   * (Deaktiviert, da der Dialog nicht mehr angezeigt werden soll)
   */
  private showTrialExpiredDialog(): void {
    // Dialog deaktiviert, da er nicht mehr angezeigt werden soll
    // Stattdessen wird der Benutzer direkt zur Lizenzseite weitergeleitet
    console.log("[LicenseManager] Trial abgelaufen - Dialog deaktiviert");
    // this.openStripeCheckout(); // Automatisches Öffnen des Checkouts auch deaktiviert
  }

  /**
   * Zeigt einen Dialog an, wenn die Subscription abgelaufen ist
   */
  private showSubscriptionExpiredDialog(): void {
    dialog
      .showMessageBox({
        type: "warning",
        title: "Subscription Expired",
        message:
          "Your annual switchfast subscription has expired. Please renew your subscription to continue using all features.",
        buttons: ["Renew Now", "Later"],
      })
      .then((result) => {
        if (result.response === 0) {
          // "Renew Now" was clicked
          this.openStripeCheckout();
        }
      });
  }

  /**
   * Gibt den Privacy Consent Status zurück
   */
  public getPrivacyConsentStatus(): boolean {
    try {
      const trialInfo = this.getTrialInfo();

      if (trialInfo && trialInfo.privacyConsentGiven !== undefined) {
        return trialInfo.privacyConsentGiven;
      }

      // Prüfen, ob es einen separaten Consent-Eintrag gibt
      const consentStatus = secureStore.get("privacyConsentGiven") as
        | boolean
        | undefined;
      const finalStatus = consentStatus ?? false;
      return finalStatus;
    } catch (error) {
      console.error(
        "[LicenseManager] Fehler beim Abrufen des Privacy Consent Status:",
        error
      );
      return false;
    }
  }

  /**
   * Lädt den Privacy Consent Status aus der Datenbank
   */
  public async loadPrivacyConsentFromDatabase(): Promise<boolean> {
    try {
      const response = await axios.post(
        `${SUPABASE_API_URL}/checkTrialStatus`,
        {
          deviceId: this.deviceInfo.deviceId,
        },
        {
          headers: {
            "x-environment": ACTIVE_ENVIRONMENT,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          },
          timeout: 5000,
        }
      );

      const data = response.data;

      if (data && data.success && data.privacy_consent_given !== undefined) {
        // Lokalen Speicher aktualisieren
        secureStore.set("privacyConsentGiven", data.privacy_consent_given);

        // Trial Info aktualisieren falls vorhanden
        const trialInfo = this.getTrialInfo();
        if (trialInfo) {
          const updatedTrialInfo: TrialInfo = {
            ...trialInfo,
            privacyConsentGiven: data.privacy_consent_given,
          };
          this.updateTrialInfo(updatedTrialInfo);
        } else {
          // Trial Info erstellen falls nicht vorhanden
          const newTrialInfo: TrialInfo = {
            trialStartDate: new Date().toISOString(),
            trialEndDate: new Date().toISOString(),
            isTrialActive: false,
            remainingDays: 0,
            privacyConsentGiven: data.privacy_consent_given,
          };
          this.updateTrialInfo(newTrialInfo);
        }

        return data.privacy_consent_given;
      }

      return false;
    } catch (error) {
      console.error(
        "[LicenseManager] Fehler beim Laden des Privacy Consents aus DB:",
        error
      );
      return false;
    }
  }

  /**
   * Setzt den Privacy Consent Status
   */
  public async setPrivacyConsent(consentGiven: boolean): Promise<boolean> {
    try {
      // In lokaler Speicherung setzen
      secureStore.set("privacyConsentGiven", consentGiven);

      // Auch in Trial-Informationen aktualisieren, falls vorhanden
      const trialInfo = this.getTrialInfo();

      if (trialInfo) {
        const updatedTrialInfo: TrialInfo = {
          ...trialInfo,
          privacyConsentGiven: consentGiven,
        };
        this.updateTrialInfo(updatedTrialInfo);
      }

      // Auch in der Datenbank aktualisieren

      try {
        const response = await axios.post(
          `${SUPABASE_API_URL}/updatePrivacyConsent`,
          {
            deviceId: this.deviceInfo.deviceId,
            consentGiven: consentGiven,
          },
          {
            headers: {
              "Content-Type": "application/json",
              "x-environment": ACTIVE_ENVIRONMENT,
              Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
            },
          }
        );
      } catch (dbError) {
        console.error(
          "💥 [LicenseManager DEBUG] Fehler beim Aktualisieren des Privacy Consents in der Datenbank:",
          dbError
        );
        // Lokaler Consent bleibt bestehen, auch wenn Datenbank-Update fehlschlägt
      }

      return true;
    } catch (error) {
      console.error(
        "💥 [LicenseManager DEBUG] Fehler beim Setzen des Privacy Consents:",
        error
      );
      return false;
    }
  }

  /**
   * Zeigt einen Dialog an, wenn die maximale Anzahl an Geräten erreicht ist
   */
  private showMaxDevicesReachedDialog(): void {
    dialog.showMessageBox({
      type: "error",
      title: "Maximale Anzahl an Geräten erreicht",
      message:
        "Sie haben die maximale Anzahl an Geräten (3) für diese Lizenz erreicht. Bitte deaktivieren Sie ein anderes Gerät, um dieses Gerät zu aktivieren.",
      buttons: ["OK"],
    });
  }

  /**
   * Zeigt einen Dialog an, wenn die Aktivierung fehlgeschlagen ist
   */
  private showActivationFailedDialog(): void {
    dialog.showMessageBox({
      type: "error",
      title: "Aktivierung fehlgeschlagen",
      message:
        "Die Aktivierung Ihres Geräts ist fehlgeschlagen. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.",
      buttons: ["OK"],
    });
  }

  /**
   * Aktiviert eine Lizenz nach erfolgreicher Zahlung mit der Stripe Session ID
   * @param sessionId Die Stripe Checkout Session ID
   * @param environment Die Umgebung ('test' oder 'prod')
   * @returns true, wenn die Aktivierung erfolgreich war, sonst false
   */
  public async activateLicenseFromSession(
    sessionId: string,
    environment: string = ACTIVE_ENVIRONMENT
  ): Promise<boolean> {
    try {
      console.log(
        `[License] Aktiviere Lizenz aus Stripe Session: ${sessionId}`
      );

      // Anfrage an den Server senden, um die Lizenz zu aktivieren
      const response = await axios.post(
        `${SUPABASE_API_URL}/activateLicenseFromSession`,
        {
          sessionId,
          deviceId: this.deviceInfo.deviceId,
          deviceName: this.deviceInfo.deviceName,
        },
        {
          headers: {
            "x-environment": environment,
          },
        }
      );

      const data = response.data;

      if (data.success && data.licenseKey) {
        // Lizenzinformationen speichern
        this.updateLicenseInfo({
          licenseKey: data.licenseKey,
          isActive: true,
          email: data.email,
          purchaseDate: data.purchaseDate || new Date().toISOString(),
          lastVerified: new Date().toISOString(),
        });

        // Erfolgsdialog anzeigen
        dialog.showMessageBox({
          type: "info",
          title: "Lizenz aktiviert",
          message:
            "Your annual subscription has been successfully activated. Thank you!",
          buttons: ["OK"],
        });

        return true;
      } else {
        console.error(
          "[License] Fehler bei der Lizenzaktivierung:",
          data.message || "Unbekannter Fehler"
        );
        this.showActivationFailedDialog();
        return false;
      }
    } catch (error) {
      console.error("[License] Fehler bei der Lizenzaktivierung:", error);
      this.showActivationFailedDialog();
      return false;
    }
  }

  /**
   * Zeigt einen Dialog an, wenn der Checkout fehlgeschlagen ist
   */
  private showCheckoutErrorDialog(errorDetails?: any): void {
    let detailMessage =
      "Der Stripe Checkout konnte nicht geöffnet werden. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.";

    if (errorDetails) {
      // Erstelle eine detaillierte Fehlermeldung für den User
      detailMessage += "\n\nTechnische Details:";

      if (errorDetails.axiosStatus) {
        detailMessage += `\n• HTTP Status: ${errorDetails.axiosStatus}`;
      }

      if (errorDetails.axiosError?.message) {
        detailMessage += `\n• Server Fehler: ${errorDetails.axiosError.message}`;
      }

      if (errorDetails.errorMessage && !errorDetails.axiosError) {
        detailMessage += `\n• Lokaler Fehler: ${errorDetails.errorMessage}`;
      }

      if (errorDetails.environment) {
        detailMessage += `\n• Umgebung: ${errorDetails.environment}`;
      }

      // Copy Error Details to Clipboard Button würde hier Sinn machen
      detailMessage += "\n\nFür Support bitte diese Details mitteilen:";
      detailMessage += `\nTimestamp: ${errorDetails.timestamp}`;
      detailMessage += `\nDevice ID: ${errorDetails.deviceId?.substring(
        0,
        8
      )}...`;
    }

    dialog
      .showMessageBox({
        type: "error",
        title: "Checkout fehlgeschlagen",
        message: detailMessage,
        buttons: ["OK", "Fehlerdetails kopieren"],
      })
      .then((result) => {
        if (result.response === 1 && errorDetails) {
          // Copy to clipboard
          const { clipboard } = require("electron");
          clipboard.writeText(JSON.stringify(errorDetails, null, 2));

          dialog.showMessageBox({
            type: "info",
            title: "Kopiert",
            message: "Fehlerdetails wurden in die Zwischenablage kopiert.",
            buttons: ["OK"],
          });
        }
      });
  }

  /**
   * Zeigt einen Dialog an, wenn das Gerät bereits lizenziert ist
   */
  private showDeviceAlreadyLicensedDialog(
    message: string,
    existingEmail?: string,
    suggestions: string[] = []
  ): void {
    const suggestionText =
      suggestions.length > 0
        ? "\n\nMögliche Lösungen:\n• " + suggestions.join("\n• ")
        : "";

    dialog
      .showMessageBox({
        type: "warning",
        title: "Gerät bereits lizenziert",
        message: message + suggestionText,
        detail: existingEmail
          ? `Die bestehende Lizenz ist mit der E-Mail-Adresse "${existingEmail}" verknüpft.`
          : "Falls Sie Probleme mit Ihrer Lizenz haben, kontaktieren Sie bitte unseren Support.",
        buttons: ["Support kontaktieren", "OK"],
        defaultId: 1,
      })
      .then((result) => {
        if (result.response === 0) {
          // Support-URL öffnen
          const { shell } = require("electron");
          shell.openExternal(
            "mailto:support@switchfast.io?subject=Lizenz-Problem&body=Ich%20habe%20ein%20Problem%20mit%20meiner%20Lizenz."
          );
        }
      });
  }

  /**
   * Bereinigt Ressourcen
   */
  public dispose(): void {
    if (this.licenseCheckTimer) {
      clearInterval(this.licenseCheckTimer);
      this.licenseCheckTimer = null;
    }

    if (this.trialCheckTimer) {
      clearInterval(this.trialCheckTimer);
      this.trialCheckTimer = null;
    }
  }

  /**
   * Kündigt die Stripe Subscription REAKTIVIERBAR (cancel_at_period_end: true)
   * Dadurch kann der Kunde die Subscription bis zum Ende der bezahlten Periode reaktivieren
   */
  public async cancelSubscription(): Promise<boolean> {
    try {
      const licenseInfo = this.getLicenseInfo();
      if (!licenseInfo?.isSubscription || !licenseInfo.subscriptionEndDate)
        return false;

      const response = await axios.post(
        `${SUPABASE_API_URL}/cancelSubscription`,
        {
          subscriptionId: licenseInfo.stripeSubscriptionId,
          email: licenseInfo.email,
          // WICHTIG: Immer reaktivierbar kündigen (cancel_at_period_end: true)
          cancelAtPeriodEnd: true,
        },
        {
          headers: {
            "x-environment": ACTIVE_ENVIRONMENT,
          },
        }
      );
      return response.data?.success === true;
    } catch (error) {
      console.error("Fehler beim Kündigen der Subscription:", error);
      return false;
    }
  }

  /**
   * Reaktiviert eine gekündigte Subscription DIREKT ohne Checkout
   * Nur möglich für Subscriptions mit cancel_at_period_end: true
   */
  public async reactivateSubscription(): Promise<{
    success: boolean;
    message?: string;
    subscription_end_date?: string;
  }> {
    try {
      const licenseInfo = this.getLicenseInfo();
      if (!licenseInfo?.isSubscription || !licenseInfo.cancelsAtPeriodEnd) {
        return {
          success: false,
          message: "No reactivatable subscription found",
        };
      }

      const response = await axios.post(
        `${SUPABASE_API_URL}/createCheckoutSession`,
        {
          deviceId: this.deviceInfo.deviceId,
          // Wichtig: Wir verwenden die ursprüngliche E-Mail für direkte Reaktivierung
          email: licenseInfo.email,
        },
        {
          headers: {
            "x-environment": ACTIVE_ENVIRONMENT,
          },
        }
      );

      const data = response.data;

      if (data.success && data.reactivated) {
        // Lizenz-Status sofort aktualisieren
        await this.checkLicenseStatus();

        // Erfolgs-Dialog anzeigen
        dialog.showMessageBox({
          type: "info",
          title: "Subscription Reactivated",
          message:
            data.message ||
            "Your subscription has been successfully reactivated!",
          detail: `Your subscription is now active until ${
            data.subscription_end_date
              ? new Date(data.subscription_end_date).toLocaleDateString()
              : "the end of your billing period"
          }.`,
          buttons: ["OK"],
        });

        return {
          success: true,
          message: data.message,
          subscription_end_date: data.subscription_end_date,
        };
      } else {
        console.error(
          "Fehler bei der Reaktivierung:",
          data.message || "Unbekannter Fehler"
        );
        return {
          success: false,
          message: data.message || "Reactivation failed",
        };
      }
    } catch (error) {
      console.error("Fehler bei der Subscription-Reaktivierung:", error);

      // Fehler-Dialog anzeigen
      dialog.showMessageBox({
        type: "error",
        title: "Reactivation Failed",
        message:
          "Failed to reactivate your subscription. Please try again later.",
        buttons: ["OK"],
      });

      return {
        success: false,
        message: "Network error or service unavailable",
      };
    }
  }

  /**
   * Löscht den Account (unterschiedliche Logik für Trial vs. bezahlte User)
   */
  public async deleteAccount(): Promise<boolean> {
    try {
      console.log("🟡 [LicenseManager] deleteAccount: Starting");
      const licenseInfo = this.getLicenseInfo();
      console.log("🟡 [LicenseManager] licenseInfo:", licenseInfo);

      // Prüfe zuerst, ob wir eine E-Mail haben (bezahlter User)
      if (licenseInfo?.email) {
        console.log(
          "🟢 [LicenseManager] Found email - using full account deletion"
        );
        return await this.deleteAccountWithEmail(licenseInfo.email);
      }

      // Fallback: E-Mail aus Trial-Informationen prüfen
      const trialInfo = this.getTrialInfo();
      console.log("🟡 [LicenseManager] trialInfo:", trialInfo);

      if (trialInfo?.email) {
        console.log(
          "🟢 [LicenseManager] Found email in trial info - using full account deletion"
        );
        return await this.deleteAccountWithEmail(trialInfo.email);
      }

      // Kein E-Mail gefunden -> Trial User ohne Stripe-Interaktion
      console.log(
        "🟡 [LicenseManager] No email found - using trial-only deletion"
      );
      return await this.deleteTrialAccount();
    } catch (error) {
      console.error(
        "🔴 [LicenseManager] Fehler beim Löschen des Accounts:",
        error
      );
      return false;
    }
  }

  /**
   * Löscht Account mit E-Mail (vollständige Löschung inkl. Stripe)
   */
  private async deleteAccountWithEmail(email: string): Promise<boolean> {
    try {
      console.log("🟢 [LicenseManager] Using email-based deletion:", email);
      const response = await axios.post(
        `${SUPABASE_API_URL}/deleteAccount`,
        {
          email: email,
        },
        {
          headers: {
            "x-environment": ACTIVE_ENVIRONMENT,
          },
        }
      );
      console.log(
        "🟡 [LicenseManager] Full deletion API response:",
        response.data
      );
      return response.data?.success === true;
    } catch (error) {
      console.error(
        "🔴 [LicenseManager] Fehler bei E-Mail-basierter Löschung:",
        error
      );
      return false;
    }
  }

  /**
   * Löscht nur Trial-Account (ohne E-Mail, nur Device-ID basiert)
   */
  private async deleteTrialAccount(): Promise<boolean> {
    try {
      console.log("🟢 [LicenseManager] Using device-ID based trial deletion");
      const response = await axios.post(
        `${SUPABASE_API_URL}/deleteTrialAccount`,
        {
          deviceId: this.deviceInfo.deviceId,
        },
        {
          headers: {
            "x-environment": ACTIVE_ENVIRONMENT,
          },
        }
      );
      console.log(
        "🟡 [LicenseManager] Trial deletion API response:",
        response.data
      );
      return response.data?.success === true;
    } catch (error) {
      console.error("🔴 [LicenseManager] Fehler bei Trial-Löschung:", error);
      return false;
    }
  }
}
