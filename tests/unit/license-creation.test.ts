import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockSupabaseClient, TEST_CONSTANTS } from "../setup";

// Mock für createClient
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

describe("License Creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Lizenz-Generierung", () => {
    it("sollte gültigen Lizenzschlüssel im korrekten Format generieren", () => {
      const licenseKey = generateLicenseKey();
      expect(licenseKey).toMatch(/^SF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
    });

    it("sollte eindeutige Lizenzschlüssel generieren", () => {
      const licenses = Array.from({ length: 100 }, () => generateLicenseKey());
      const uniqueLicenses = [...new Set(licenses)];
      expect(uniqueLicenses).toHaveLength(licenses.length);
    });
  });

  describe("Erfolgreiche Lizenz-Erstellung", () => {
    it("sollte Lizenz mit allen erforderlichen Daten erstellen", async () => {
      // Arrange
      const mockLicenseInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "license-123",
              license_key: TEST_CONSTANTS.LICENSE_KEY,
            },
            error: null,
          }),
        }),
      });

      const mockDeviceInsert = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === "licenses") {
          return { insert: mockLicenseInsert };
        }
        if (table === "device_activations") {
          return { insert: mockDeviceInsert };
        }
      });

      mockSupabaseClient.from = mockFrom;

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });

      // Act
      const result = await createLicense({
        email: TEST_CONSTANTS.EMAIL,
        stripeCustomerId: "cus_test",
        stripePaymentId: "pi_test",
        deviceId: TEST_CONSTANTS.DEVICE_ID,
        deviceName: "Test Device",
      });

      // Assert
      expect(mockLicenseInsert).toHaveBeenCalledWith({
        license_key: expect.stringMatching(
          /^SF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
        ),
        email: TEST_CONSTANTS.EMAIL,
        stripe_customer_id: "cus_test",
        stripe_payment_id: "pi_test",
        stripe_subscription_id: undefined,
        subscription_end_date: undefined,
        is_active: true,
      });

      expect(mockDeviceInsert).toHaveBeenCalledWith({
        license_id: "license-123",
        device_id: TEST_CONSTANTS.DEVICE_ID,
        device_name: "Test Device",
        first_activated_at: expect.any(String),
        last_check_in: expect.any(String),
        is_active: true,
      });

      expect(result).toEqual({
        success: true,
        license_key: expect.stringMatching(
          /^SF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
        ),
        message: "Lizenz erfolgreich erstellt und Gerät aktiviert",
      });
    });

    it("sollte Subscription-Lizenz mit Ablaufdatum erstellen", async () => {
      // Arrange
      const subscriptionEndDate = "2025-01-01T00:00:00.000Z";

      const mockLicenseInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "license-456",
              license_key: TEST_CONSTANTS.LICENSE_KEY,
            },
            error: null,
          }),
        }),
      });

      const mockDeviceInsert = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      const mockFrom = vi.fn().mockImplementation((table: string) => {
        if (table === "licenses") {
          return { insert: mockLicenseInsert };
        }
        if (table === "device_activations") {
          return { insert: mockDeviceInsert };
        }
      });

      mockSupabaseClient.from = mockFrom;

      // Act
      const result = await createLicense({
        email: TEST_CONSTANTS.EMAIL,
        stripeCustomerId: "cus_test",
        stripeSubscriptionId: "sub_test",
        subscriptionEndDate,
        deviceId: TEST_CONSTANTS.DEVICE_ID,
      });

      // Assert
      expect(mockLicenseInsert).toHaveBeenCalledWith({
        license_key: expect.stringMatching(
          /^SF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
        ),
        email: TEST_CONSTANTS.EMAIL,
        stripe_customer_id: "cus_test",
        stripe_payment_id: undefined,
        stripe_subscription_id: "sub_test",
        subscription_end_date: subscriptionEndDate,
        is_active: true,
      });

      expect(result.success).toBe(true);
    });
  });

  describe("Fehlerbehandlung", () => {
    it("sollte Fehler bei fehlenden erforderlichen Feldern werfen", async () => {
      await expect(
        createLicense({
          email: "",
          stripeCustomerId: "cus_test",
          deviceId: TEST_CONSTANTS.DEVICE_ID,
        })
      ).rejects.toThrow("Fehlende erforderliche Felder");
    });

    it("sollte Datenbankfehler bei Lizenz-Erstellung behandeln", async () => {
      // Arrange
      const mockLicenseInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: "Database error" },
          }),
        }),
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === "licenses") {
          return { insert: mockLicenseInsert };
        }
      });

      // Act & Assert
      await expect(
        createLicense({
          email: TEST_CONSTANTS.EMAIL,
          stripeCustomerId: "cus_test",
          deviceId: TEST_CONSTANTS.DEVICE_ID,
        })
      ).rejects.toThrow("Fehler beim Erstellen der Lizenz");
    });

    it("sollte Fehler bei Device-Aktivierung behandeln", async () => {
      // Arrange
      const mockLicenseInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "license-123" },
            error: null,
          }),
        }),
      });

      const mockDeviceInsert = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Device activation failed" },
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === "licenses") {
          return { insert: mockLicenseInsert };
        }
        if (table === "device_activations") {
          return { insert: mockDeviceInsert };
        }
      });

      // Act & Assert
      await expect(
        createLicense({
          email: TEST_CONSTANTS.EMAIL,
          stripeCustomerId: "cus_test",
          deviceId: TEST_CONSTANTS.DEVICE_ID,
        })
      ).rejects.toThrow("Fehler beim Aktivieren des Geräts");
    });
  });

  describe("Duplikat-Prävention", () => {
    it("sollte bestehende Aktivierung prüfen und Duplikate verhindern", async () => {
      // Arrange
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "activation-123",
                  license_id: "license-456",
                },
                error: null,
              }),
            }),
          }),
        }),
      });

      mockSupabaseClient.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      // Act
      const result = await checkExistingActivation(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(result).toEqual({
        hasExisting: true,
        existingLicense: "license-456",
      });
    });

    it("sollte keine Duplikate bei neuer Device zurückgeben", async () => {
      // Arrange
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: null,
                error: null,
              }),
            }),
          }),
        }),
      });

      mockSupabaseClient.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      // Act
      const result = await checkExistingActivation(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(result).toEqual({
        hasExisting: false,
        existingLicense: null,
      });
    });
  });

  describe("Welcome Email Integration", () => {
    it("sollte Welcome Email nach Lizenz-Erstellung senden", async () => {
      // Arrange
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ success: true }),
      });
      global.fetch = mockFetch;

      const mockLicenseInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: "license-123" },
            error: null,
          }),
        }),
      });

      const mockDeviceInsert = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === "licenses") {
          return { insert: mockLicenseInsert };
        }
        if (table === "device_activations") {
          return { insert: mockDeviceInsert };
        }
      });

      // Act
      await createLicense({
        email: TEST_CONSTANTS.EMAIL,
        stripeCustomerId: "cus_test",
        stripePaymentId: "pi_test",
        deviceId: TEST_CONSTANTS.DEVICE_ID,
        deviceName: "Test Device",
      });

      // Assert
      expect(mockFetch).toHaveBeenCalledWith(
        "/functions/v1/sendWelcomeEmail",
        expect.objectContaining({
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
        })
      );
    });

    it("sollte bei Email-Fehler trotzdem erfolgreich sein (non-critical)", async () => {
      // Arrange
      const mockFetch = vi
        .fn()
        .mockRejectedValue(new Error("Email service unavailable"));
      global.fetch = mockFetch;

      const mockLicenseInsert = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: {
              id: "license-123",
              license_key: TEST_CONSTANTS.LICENSE_KEY,
            },
            error: null,
          }),
        }),
      });

      const mockDeviceInsert = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === "licenses") {
          return { insert: mockLicenseInsert };
        }
        if (table === "device_activations") {
          return { insert: mockDeviceInsert };
        }
      });

      // Act & Assert
      await expect(
        createLicense({
          email: TEST_CONSTANTS.EMAIL,
          stripeCustomerId: "cus_test",
          stripePaymentId: "pi_test",
          deviceId: TEST_CONSTANTS.DEVICE_ID,
        })
      ).resolves.toMatchObject({
        success: true,
        license_key: expect.stringMatching(
          /^SF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
        ),
      });
    });
  });
});

// Hilfsfunktionen
function generateLicenseKey(): string {
  const randomString = (length: number) => {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let result = "";
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  };

  return `SF-${randomString(4)}-${randomString(4)}-${randomString(4)}`;
}

async function createLicense(params: {
  email: string;
  stripeCustomerId: string;
  stripePaymentId?: string;
  stripeSubscriptionId?: string;
  subscriptionEndDate?: string;
  deviceId: string;
  deviceName?: string;
}) {
  const {
    email,
    stripeCustomerId,
    stripePaymentId,
    stripeSubscriptionId,
    subscriptionEndDate,
    deviceId,
    deviceName,
  } = params;

  // Validierung
  if (!email || !stripeCustomerId || !deviceId) {
    throw new Error("Fehlende erforderliche Felder");
  }

  // Lizenzschlüssel generieren
  const licenseKey = generateLicenseKey();

  // Lizenz erstellen
  const { data: licenseData, error: licenseError } = await mockSupabaseClient
    .from("licenses")
    .insert({
      license_key: licenseKey,
      email: email,
      stripe_customer_id: stripeCustomerId,
      stripe_payment_id: stripePaymentId,
      stripe_subscription_id: stripeSubscriptionId,
      subscription_end_date: subscriptionEndDate,
      is_active: true,
    })
    .select()
    .single();

  if (licenseError) {
    throw new Error("Fehler beim Erstellen der Lizenz");
  }

  // Gerät aktivieren
  const { error: deviceError } = await mockSupabaseClient
    .from("device_activations")
    .insert({
      license_id: licenseData.id,
      device_id: deviceId,
      device_name: deviceName || "Unbenanntes Gerät",
      first_activated_at: new Date().toISOString(),
      last_check_in: new Date().toISOString(),
      is_active: true,
    });

  if (deviceError) {
    throw new Error("Fehler beim Aktivieren des Geräts");
  }

  // Welcome Email senden (non-critical)
  try {
    await fetch("/functions/v1/sendWelcomeEmail", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: email,
        licenseKey: licenseKey,
        deviceName: deviceName,
      }),
    });
  } catch (emailError) {
    // Email-Fehler sind nicht kritisch
    console.warn("Welcome email failed (non-critical):", emailError);
  }

  return {
    success: true,
    license_key: licenseKey,
    message: "Lizenz erfolgreich erstellt und Gerät aktiviert",
  };
}

async function checkExistingActivation(deviceId: string) {
  const { data: existingActivation, error } = await mockSupabaseClient
    .from("device_activations")
    .select(
      `
      id,
      is_active,
      license_id,
      licenses!inner(
        id,
        is_active,
        email
      )
    `
    )
    .eq("device_id", deviceId)
    .eq("is_active", true)
    .eq("licenses.is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error("Fehler bei der Validierung bestehender Aktivierungen");
  }

  return {
    hasExisting: !!existingActivation,
    existingLicense: existingActivation?.license_id || null,
  };
}
