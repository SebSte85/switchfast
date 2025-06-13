import { ipcMain } from "electron";
import { LicenseManager } from "./licenseManager";

interface DeviceInfo {
  id: string;
  name: string;
  firstActivated: string;
  lastCheckIn: string;
}

export function setupLicenseIPC(licenseManager: LicenseManager) {
  // Lizenzstatus abrufen
  ipcMain.handle("license:getStatus", async () => {
    const isLicensed = licenseManager.isLicensed();
    const isInTrial = licenseManager.isInTrial();
    const remainingTrialDays = licenseManager.getRemainingTrialDays();
    const licenseInfo = licenseManager.getLicenseInfo();

    return {
      isLicensed,
      isInTrial,
      remainingTrialDays,
      licenseKey: licenseInfo?.licenseKey || null,
      email: licenseInfo?.email || null,
      purchaseDate: licenseInfo?.purchaseDate || null,
      subscriptionEndDate: licenseInfo?.subscriptionEndDate || null,
      isSubscription: licenseInfo?.isSubscription || false,
      cancelledAt: licenseInfo?.cancelledAt || null,
      cancelsAtPeriodEnd: licenseInfo?.cancelsAtPeriodEnd || false,
    };
  });

  // Lizenz aktivieren
  ipcMain.handle("license:activate", async (_, licenseKey: string) => {
    return await licenseManager.activateDevice(licenseKey);
  });

  // Lizenz deaktivieren
  ipcMain.handle("license:deactivate", async () => {
    const licenseInfo = licenseManager.getLicenseInfo();
    if (!licenseInfo) return false;

    return await licenseManager.deactivateDevice(licenseInfo.licenseKey);
  });

  // Trial aktivieren
  ipcMain.handle("activate-trial", async (_, { email }) => {
    try {
      // Validierung der E-Mail
      if (!email || typeof email !== "string" || !email.includes("@")) {
        return { success: false, error: "Ungültige E-Mail-Adresse" };
      }

      // Trial aktivieren
      const result = await licenseManager.activateTrial(email);

      return { success: true, ...result };
    } catch (error) {
      console.error("Fehler bei der Trial-Aktivierung:", error);
      return {
        success: false,
        error:
          error instanceof Error
            ? error.message
            : "Unbekannter Fehler bei der Trial-Aktivierung",
      };
    }
  });

  // Stripe Checkout öffnen
  ipcMain.handle("license:openCheckout", async (_, email?: string) => {
    await licenseManager.openStripeCheckout(email);
    return true;
  });

  // Lizenzstatus prüfen
  ipcMain.handle("license:checkStatus", async () => {
    return await licenseManager.checkLicenseStatus();
  });

  // Lizenz mit Stripe Session aktivieren
  ipcMain.handle(
    "license:activateFromSession",
    async (
      _,
      { sessionId, environment }: { sessionId: string; environment: string }
    ) => {
      console.log(
        `[LicenseIPC] Aktiviere Lizenz aus Stripe Session: ${sessionId}, Umgebung: ${environment}`
      );
      return await licenseManager.activateLicenseFromSession(
        sessionId,
        environment
      );
    }
  );

  // Trial-Status prüfen
  ipcMain.handle("license:checkTrialStatus", async () => {
    return await licenseManager.checkTrialStatus();
  });

  // Aktivierte Geräte abrufen
  ipcMain.handle("license:getDevices", async () => {
    const licenseInfo = licenseManager.getLicenseInfo();
    if (!licenseInfo) return [];

    try {
      const devices = await licenseManager.getActivatedDevices(
        licenseInfo.licenseKey
      );
      return devices.map((device: any) => ({
        id: device.device_id,
        name: device.device_name,
        firstActivated: device.first_activated_at,
        lastCheckIn: device.last_check_in,
      }));
    } catch (error) {
      console.error("Fehler beim Abrufen der aktivierten Geräte:", error);
      return [];
    }
  });

  // Bestimmtes Gerät deaktivieren
  ipcMain.handle("license:deactivateDevice", async (_, deviceId: string) => {
    const licenseInfo = licenseManager.getLicenseInfo();
    if (!licenseInfo) return false;

    try {
      return await licenseManager.deactivateSpecificDevice(
        licenseInfo.licenseKey,
        deviceId
      );
    } catch (error) {
      console.error("Fehler beim Deaktivieren des Geräts:", error);
      return false;
    }
  });

  // Aktuelles Gerät abrufen
  ipcMain.handle("license:getCurrentDevice", async () => {
    return licenseManager.getDeviceId();
  });

  // Lizenz nach erfolgreicher Stripe-Zahlung aktivieren
  ipcMain.on(
    "activate-license-from-session",
    async (_, data: { sessionId: string; environment: string }) => {
      console.log(
        `[IPC] Aktiviere Lizenz aus Stripe Session: ${data.sessionId}, Umgebung: ${data.environment}`
      );
      try {
        const success = await licenseManager.activateLicenseFromSession(
          data.sessionId,
          data.environment
        );
        if (success) {
          console.log("[IPC] Lizenzaktivierung erfolgreich");
        } else {
          console.error("[IPC] Lizenzaktivierung fehlgeschlagen");
        }
      } catch (error) {
        console.error("[IPC] Fehler bei der Lizenzaktivierung:", error);
      }
    }
  );

  // Benachrichtigung über abgebrochene Zahlung
  ipcMain.on("payment-cancelled", () => {
    console.log("[IPC] Zahlung wurde abgebrochen");
    // Optional: Hier könnte eine Benachrichtigung an den Benutzer angezeigt werden
  });

  // Privacy Consent Status abrufen
  ipcMain.handle("privacy:getConsentStatus", async () => {
    await licenseManager.waitUntilReady();
    const result = licenseManager.getPrivacyConsentStatus();
    return result;
  });

  // Privacy Consent setzen
  ipcMain.handle("privacy:setConsent", async (_, consentGiven: boolean) => {
    return await licenseManager.setPrivacyConsent(consentGiven);
  });

  // Trial-Informationen abrufen
  ipcMain.handle("license:getTrialInfo", async () => {
    return licenseManager.getTrialInfo();
  });

  // Subscription kündigen
  ipcMain.handle("license:cancelSubscription", async () => {
    return await licenseManager.cancelSubscription();
  });

  // Subscription reaktivieren (DIREKT ohne Checkout)
  ipcMain.handle("license:reactivateSubscription", async () => {
    return await licenseManager.reactivateSubscription();
  });

  // Account löschen
  ipcMain.handle("license:deleteAccount", async () => {
    return await licenseManager.deleteAccount();
  });

  // Kontaktformular senden
  ipcMain.handle("contact:sendMessage", async (_, { email, message }) => {
    try {
      const deviceId = licenseManager.getDeviceId();

      // Bestimme die Umgebung (test oder prod)
      const environment =
        process.env.NODE_ENV === "production" ? "prod" : "test";

      // Supabase URL und Key
      const supabaseUrl = process.env.SUPABASE_URL;
      const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

      if (!supabaseUrl || !supabaseAnonKey) {
        console.error("❌ [Contact] Supabase configuration missing");
        return {
          success: false,
          error: "Email service not configured",
        };
      }

      console.log("🟢 [Contact] Sending contact message:", {
        email: email || "MISSING",
        messageLength: message?.length || 0,
        deviceId: deviceId || "MISSING",
        environment,
      });

      // Aufruf der Supabase Edge Function
      const response = await fetch(
        `${supabaseUrl}/functions/v1/sendContactMessage`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${supabaseAnonKey}`,
            "x-environment": environment,
          },
          body: JSON.stringify({
            email,
            message,
            deviceId,
          }),
        }
      );

      const result = await response.json();

      if (!response.ok) {
        console.error("❌ [Contact] Supabase function error:", result);
        return {
          success: false,
          error: result.error || "Failed to send message",
        };
      }

      console.log("✅ [Contact] Message sent successfully");
      return {
        success: true,
        message: "Contact message sent successfully",
      };
    } catch (error) {
      console.error("❌ [Contact] Error sending contact message:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  });
}
