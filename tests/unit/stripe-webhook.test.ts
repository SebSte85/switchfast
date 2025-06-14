import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockSupabaseClient, mockStripe, TEST_CONSTANTS } from "../setup";

// Mock für createClient
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

// Mock für Stripe
vi.mock("stripe", () => ({
  default: vi.fn(() => mockStripe),
}));

describe("Stripe Webhook Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkout.session.completed Event", () => {
    it("sollte erfolgreich eine Lizenz nach erfolgreicher Zahlung erstellen", async () => {
      // Arrange
      const webhookEvent = {
        type: "checkout.session.completed",
        data: {
          object: {
            id: "cs_test_session",
            customer: "cus_test_customer",
            payment_intent: "pi_test_payment",
            metadata: {
              device_id: TEST_CONSTANTS.DEVICE_ID,
              device_name: "Test Device",
            },
            customer_details: {
              email: TEST_CONSTANTS.EMAIL,
            },
            payment_status: "paid",
          },
        },
      };

      mockStripe.webhooks.constructEventAsync.mockResolvedValue(webhookEvent);

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

      // Act
      const result = await handleStripeWebhook(
        JSON.stringify(webhookEvent),
        TEST_CONSTANTS.STRIPE_WEBHOOK_SECRET
      );

      // Assert
      expect(mockStripe.webhooks.constructEventAsync).toHaveBeenCalled();
      expect(mockLicenseInsert).toHaveBeenCalledWith({
        license_key: expect.stringMatching(
          /^SF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
        ),
        email: TEST_CONSTANTS.EMAIL,
        stripe_customer_id: "cus_test_customer",
        stripe_payment_id: "pi_test_payment",
        is_active: true,
      });

      expect(result.success).toBe(true);
    });

    it("sollte bestehende Lizenz-Aktivierung prüfen und Duplikate verhindern", async () => {
      // Arrange
      const existingLicense = {
        id: "existing-123",
        license_key: "SF-EXIST-1234-5678",
        is_active: true,
      };

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: "activation-existing",
                  license_id: existingLicense.id,
                  licenses: existingLicense,
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
      expect(result.hasExisting).toBe(true);
      expect(result.existingLicense).toBe(existingLicense.id);
    });

    it("sollte Subscription-Daten korrekt verarbeiten", async () => {
      // Arrange
      const subscriptionId = "sub_test_subscription";
      const subscriptionData = {
        id: subscriptionId,
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 Tage
        status: "active",
      };

      mockStripe.subscriptions.retrieve.mockResolvedValue(subscriptionData);

      const webhookEvent = {
        type: "checkout.session.completed",
        data: {
          object: {
            subscription: subscriptionId,
            customer: "cus_test_customer",
            customer_details: { email: TEST_CONSTANTS.EMAIL },
            metadata: { device_id: TEST_CONSTANTS.DEVICE_ID },
          },
        },
      };

      // Act
      await processSubscriptionData(webhookEvent.data.object);

      // Assert
      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
        subscriptionId
      );
    });

    it("sollte Fehler bei fehlenden erforderlichen Daten behandeln", async () => {
      // Arrange
      const invalidEvent = {
        type: "checkout.session.completed",
        data: {
          object: {
            // Fehlende customer_details.email
            customer: "cus_test",
            metadata: {},
          },
        },
      };

      // Act & Assert
      await expect(
        processCheckoutSession(invalidEvent.data.object)
      ).rejects.toThrow("Fehlende erforderliche Daten");
    });
  });

  describe("charge.refunded Event", () => {
    it("sollte Lizenz nach Rückerstattung deaktivieren", async () => {
      // Arrange
      const webhookEvent = {
        type: "charge.refunded",
        data: {
          object: {
            payment_intent: "pi_test_payment",
            amount_refunded: 5000,
          },
        },
      };

      const mockLicenseSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "license-refund",
              license_key: "SF-REFUND-1234",
              is_active: true,
            },
            error: null,
          }),
        }),
      });

      const mockLicenseUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({
          data: null,
          error: null,
        }),
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === "licenses") {
          return {
            select: mockLicenseSelect,
            update: mockLicenseUpdate,
          };
        }
      });

      // Act
      await processRefundEvent(webhookEvent.data.object);

      // Assert
      expect(mockLicenseSelect).toHaveBeenCalled();
      expect(mockLicenseUpdate).toHaveBeenCalledWith({ is_active: false });
    });

    it("sollte GDPR-Löschung korrekt behandeln (Lizenz bereits gelöscht)", async () => {
      // Arrange
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null, // Lizenz nicht gefunden (bereits gelöscht)
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      // Act & Assert
      // Sollte keine Fehler werfen, auch wenn Lizenz nicht gefunden wird
      const result = await processRefundEvent({
        payment_intent: "pi_deleted_license",
        amount_refunded: 5000,
      });

      expect(result).toEqual({
        success: true,
        message: "Lizenz bereits entfernt oder nicht gefunden",
      });
    });
  });

  describe("Webhook Signature Verification", () => {
    it("sollte ungültige Signaturen ablehnen", async () => {
      // Arrange
      mockStripe.webhooks.constructEventAsync.mockRejectedValue(
        new Error("Invalid signature")
      );

      // Act & Assert
      await expect(
        handleStripeWebhook("invalid_payload", "invalid_signature")
      ).rejects.toThrow("Invalid signature");
    });

    it("sollte fehlende Signaturen ablehnen", async () => {
      // Act & Assert
      await expect(handleStripeWebhook("payload", "")).rejects.toThrow(
        "Webhook signature missing"
      );
    });
  });
});

// Hilfsfunktionen
async function handleStripeWebhook(payload: string, signature: string) {
  if (!signature) {
    throw new Error("Webhook signature missing");
  }

  try {
    const event = await mockStripe.webhooks.constructEventAsync(
      payload,
      signature,
      TEST_CONSTANTS.STRIPE_WEBHOOK_SECRET
    );

    switch (event.type) {
      case "checkout.session.completed":
        return await processCheckoutSession(event.data.object);
      case "charge.refunded":
        return await processRefundEvent(event.data.object);
      default:
        return { success: true, message: "Event type not handled" };
    }
  } catch (error) {
    throw error;
  }
}

async function processCheckoutSession(session: any) {
  const { customer_details, customer, payment_intent, subscription, metadata } =
    session;

  if (!customer_details?.email || !customer || !metadata?.device_id) {
    throw new Error("Fehlende erforderliche Daten");
  }

  const licenseKey = generateLicenseKey();

  // Lizenz erstellen
  const { data: licenseData } = await mockSupabaseClient
    .from("licenses")
    .insert({
      license_key: licenseKey,
      email: customer_details.email,
      stripe_customer_id: customer,
      stripe_payment_id: payment_intent,
      stripe_subscription_id: subscription,
      is_active: true,
    })
    .select()
    .single();

  // Gerät aktivieren
  await mockSupabaseClient.from("device_activations").insert({
    license_id: licenseData.id,
    device_id: metadata.device_id,
    device_name: metadata.device_name || "Unbenanntes Gerät",
    is_active: true,
  });

  return {
    success: true,
    license_key: licenseKey,
    message: "Lizenz erfolgreich erstellt",
  };
}

async function processSubscriptionData(session: any) {
  if (session.subscription) {
    const subscription = await mockStripe.subscriptions.retrieve(
      session.subscription
    );
    return subscription;
  }
  return null;
}

async function processRefundEvent(charge: any) {
  const { data: license } = await mockSupabaseClient
    .from("licenses")
    .select("*")
    .eq("stripe_payment_id", charge.payment_intent)
    .maybeSingle();

  if (!license) {
    return {
      success: true,
      message: "Lizenz bereits entfernt oder nicht gefunden",
    };
  }

  // Lizenz deaktivieren
  await mockSupabaseClient
    .from("licenses")
    .update({ is_active: false })
    .eq("id", license.id);

  return {
    success: true,
    message: "Lizenz nach Rückerstattung deaktiviert",
  };
}

async function checkExistingActivation(deviceId: string) {
  const { data: existingActivation } = await mockSupabaseClient
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

  return {
    hasExisting: !!existingActivation,
    existingLicense: existingActivation?.license_id || null,
  };
}

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
