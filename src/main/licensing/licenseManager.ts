import { app, dialog } from "electron";
import Store from "electron-store";
import { machineIdSync } from "node-machine-id";
import * as os from "os";
import * as crypto from "crypto";
import axios from "axios";
import path from "path";

// Typdefinitionen
interface LicenseInfo {
  licenseKey: string;
  isActive: boolean;
  email?: string;
  purchaseDate?: string;
  lastVerified: string;
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
}

// Konfiguration
const SUPABASE_API_URL =
  "https://foqnvgvtyluvektevlab.supabase.co/functions/v1"; // Supabase Functions URL
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZvcW52Z3Z0eWx1dmVrdGV2bGFiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDkwMTYwMzUsImV4cCI6MjA2NDU5MjAzNX0.q2A6m7bQuKPb-VZNIBoizUVXS1LsgacM6QOVIaqrN1Q";
const ACTIVE_ENVIRONMENT = process.env.ACTIVE_ENVIRONMENT || "test"; // Standard-Umgebung: 'test' oder 'prod'
const LICENSE_CHECK_INTERVAL = 4 * 60 * 60 * 1000; // 4 Stunden
const OFFLINE_GRACE_PERIOD = 7 * 24 * 60 * 60 * 1000; // 7 Tage
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
  private licenseCheckTimer: NodeJS.Timeout | null = null;
  private deviceInfo: DeviceInfo;

  constructor() {
    this.deviceInfo = this.getDeviceInfo();
    this.setupLicenseChecks();
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
    // Sofortige Prüfung beim Start
    this.checkLicenseStatus();

    // Regelmäßige Prüfungen
    this.licenseCheckTimer = setInterval(() => {
      this.checkLicenseStatus();
    }, LICENSE_CHECK_INTERVAL);

    // Zusätzliche Prüfung, wenn der Computer aus dem Ruhezustand erwacht
    const powerMonitor = require("electron").powerMonitor;
    powerMonitor.on("resume", () => {
      this.checkLicenseStatus();
    });
  }

  /**
   * Prüft den Lizenzstatus beim Server
   */
  public async checkLicenseStatus(): Promise<boolean> {
    try {
      // Immer zuerst die Edge Function aufrufen, um den Lizenzstatus zu überprüfen
      // unabhängig davon, ob lokal eine Lizenz gespeichert ist
      try {
        console.log("Rufe checkLicenseStatus Edge Function auf...");
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

        console.log("Edge Function Antwort erhalten:", response.status);
        const data = response.data;

        if (data.success && data.is_license_valid && data.is_device_activated) {
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
          });
          return true;
        } else {
          // Keine gültige Lizenz gefunden oder Gerät nicht aktiviert
          if (data.success && !data.is_license_valid) {
            console.log("Keine gültige Lizenz gefunden, prüfe Trial-Status");
            return await this.checkTrialStatus();
          } else if (
            data.success &&
            data.is_license_valid &&
            !data.is_device_activated
          ) {
            // Lizenz gefunden, aber Gerät nicht aktiviert
            console.log("Lizenz gefunden, aber Gerät nicht aktiviert");
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
   * Prüft den Trial-Status
   */
  public async checkTrialStatus(): Promise<boolean> {
    try {
      // Lokalen Trial-Status abrufen
      const localTrialInfo = this.getTrialInfo();

      // Versuchen, den Trial-Status online zu verifizieren
      try {
        console.log("Rufe checkTrialStatus Edge Function auf...");
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

        console.log("Edge Function Antwort erhalten:", response.status);
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
      // Umgebungsvariablen ausgeben (nur für Debugging)
      console.log("[License] Umgebungsvariablen:");
      console.log(`- ACTIVE_ENVIRONMENT: ${ACTIVE_ENVIRONMENT}`);

      // Stripe API-Schlüssel und Preis-ID basierend auf der aktiven Umgebung auswählen
      const isProd = ACTIVE_ENVIRONMENT === "prod";

      // Direkt die Umgebungsvariablen auslesen
      const prodKey = process.env.PROD_STRIPE_SECRET_KEY;
      const testKey = process.env.TEST_STRIPE_SECRET_KEY;
      const prodPriceId = process.env.PROD_STRIPE_PRICE_ID;
      const testPriceId = process.env.TEST_STRIPE_PRICE_ID;

      console.log(`[License] Verfügbare Schlüssel:`);
      console.log(`- PROD_KEY: ${prodKey ? "vorhanden" : "fehlt"}`);
      console.log(`- TEST_KEY: ${testKey ? "vorhanden" : "fehlt"}`);
      console.log(`- PROD_PRICE_ID: ${prodPriceId ? "vorhanden" : "fehlt"}`);
      console.log(`- TEST_PRICE_ID: ${testPriceId ? "vorhanden" : "fehlt"}`);

      const stripeSecretKey = isProd ? prodKey : testKey;
      const stripePriceId = isProd ? prodPriceId : testPriceId;

      // Verwende HTTPS-URLs für Stripe
      // Basis-URLs für Erfolg und Abbruch
      const baseSuccessUrl = isProd
        ? "https://switchfast.io/payment/success"
        : "https://test.switchfast.io/payment/success";

      const baseCancelUrl = isProd
        ? "https://switchfast.io/payment/cancel"
        : "https://test.switchfast.io/payment/cancel";

      // Füge Parameter hinzu: session_id (von Stripe), deviceId und Umgebung
      const successUrl = `${baseSuccessUrl}?session_id={CHECKOUT_SESSION_ID}&device_id=${encodeURIComponent(
        this.deviceInfo.deviceId
      )}&env=${ACTIVE_ENVIRONMENT}`;
      const cancelUrl = `${baseCancelUrl}?device_id=${encodeURIComponent(
        this.deviceInfo.deviceId
      )}&env=${ACTIVE_ENVIRONMENT}`;

      console.log(
        `[License] Öffne Stripe Checkout in ${ACTIVE_ENVIRONMENT}-Umgebung`
      );
      console.log(
        `[License] Verwende Preis-ID: ${stripePriceId || "NICHT DEFINIERT"}`
      );

      if (!stripeSecretKey) {
        throw new Error("Stripe API-Schlüssel ist nicht konfiguriert");
      }

      if (!stripePriceId) {
        throw new Error("Stripe Preis-ID ist nicht konfiguriert");
      }

      // Stripe-Instanz erstellen
      const Stripe = require("stripe");
      console.log("[License] Erstelle Stripe-Instanz...");
      const stripe = new Stripe(stripeSecretKey, {
        apiVersion: "2023-10-16", // Explizite API-Version angeben
      });

      // Checkout-Session erstellen
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        line_items: [
          {
            price: stripePriceId,
            quantity: 1,
          },
        ],
        mode: "payment",
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer_email: email || undefined,
        client_reference_id: this.deviceInfo.deviceId,
        metadata: {
          deviceName: this.deviceInfo.deviceName,
        },
      });

      if (session && session.url) {
        // URL im Standard-Browser öffnen
        const { shell } = require("electron");
        await shell.openExternal(session.url);
      } else {
        this.showCheckoutErrorDialog();
      }
    } catch (error) {
      console.error("Fehler beim Öffnen des Stripe Checkouts:", error);
      this.showCheckoutErrorDialog();
    }
  }

  /**
   * Gibt die Lizenzinformationen zurück
   */
  public getLicenseInfo(): LicenseInfo | null {
    return secureStore.get("licenseInfo") as LicenseInfo | null;
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

      if (!storedTrialInfo) return null;

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
        buttons: ["Lizenz kaufen", "Schließen"],
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
            "Ihre Lizenz wurde erfolgreich aktiviert. Vielen Dank für Ihren Kauf!",
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
  private showCheckoutErrorDialog(): void {
    dialog.showMessageBox({
      type: "error",
      title: "Checkout fehlgeschlagen",
      message:
        "Der Stripe Checkout konnte nicht geöffnet werden. Bitte versuchen Sie es später erneut oder kontaktieren Sie den Support.",
      buttons: ["OK"],
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
  }
}
