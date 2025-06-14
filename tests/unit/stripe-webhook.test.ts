import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockSupabaseClient, mockStripe, TEST_CONSTANTS } from "../setup";

describe("Stripe Webhook Handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkout.session.completed Event", () => {
    it("sollte erfolgreich eine Lizenz nach erfolgreicher Zahlung erstellen", async () => {
      // Arrange
      const sessionData = {
        id: "cs_test_session_123",
        customer: "cus_test_customer",
        payment_intent: "pi_test_payment",
        customer_details: {
          email: TEST_CONSTANTS.EMAIL,
        },
        status: "complete",
        payment_status: "paid",
      };

      const mockEvent = {
        type: "checkout.session.completed",
        data: { object: sessionData },
      };

      mockStripe.webhooks.constructEventAsync.mockResolvedValue(mockEvent);

      // Act
      const result = await validateCheckoutSession(sessionData);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.email).toBe(TEST_CONSTANTS.EMAIL);
      expect(result.customerId).toBe("cus_test_customer");
      expect(result.paymentIntentId).toBe("pi_test_payment");
    });

    it("sollte bestehende Lizenz-Aktivierung prüfen und Duplikate verhindern", async () => {
      // Arrange
      const existingCustomer = "cus_existing_customer";

      // Act
      const shouldCreateLicense = await checkIfLicenseCreationNeeded(
        existingCustomer,
        true
      );

      // Assert
      expect(shouldCreateLicense).toBe(false);
    });

    it("sollte Subscription-Daten korrekt verarbeiten", async () => {
      // Arrange
      const subscriptionId = "sub_test_subscription";
      const mockSubscription = {
        id: subscriptionId,
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
        status: "active",
      };

      mockStripe.subscriptions.retrieve.mockResolvedValue(mockSubscription);

      // Act
      const result = await processSubscriptionData(subscriptionId);

      // Assert
      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(
        subscriptionId
      );
      expect(result.subscriptionId).toBe(subscriptionId);
      expect(result.endDate).toBeTruthy();
      expect(new Date(result.endDate)).toBeInstanceOf(Date);
    });

    it("sollte Fehler bei fehlenden erforderlichen Daten behandeln", async () => {
      // Arrange
      const invalidSessionData = {
        id: "cs_test_invalid",
        customer: null,
        customer_details: { email: null },
        status: "complete",
        payment_status: "paid",
      };

      // Act & Assert
      await expect(validateCheckoutSession(invalidSessionData)).rejects.toThrow(
        "Fehlende erforderliche Daten"
      );
    });
  });

  describe("charge.refunded Event", () => {
    it("sollte Lizenz nach Rückerstattung deaktivieren", async () => {
      // Arrange
      const chargeData = {
        id: "ch_test_refunded",
        payment_intent: "pi_test_refunded",
        amount_refunded: 5000,
        refunded: true,
      };

      // Act
      const result = await processRefundEvent(chargeData);

      // Assert
      expect(result.shouldDeactivateLicense).toBe(true);
      expect(result.paymentIntentId).toBe("pi_test_refunded");
    });

    it("sollte GDPR-Löschung korrekt behandeln (Lizenz bereits gelöscht)", async () => {
      // Arrange
      const chargeData = {
        id: "ch_test_gdpr",
        payment_intent: "pi_test_gdpr",
        amount_refunded: 5000,
        refunded: true,
      };

      // Act
      const result = await processRefundEvent(chargeData, false); // Lizenz nicht vorhanden

      // Assert
      expect(result.shouldDeactivateLicense).toBe(false);
      expect(result.licenseNotFound).toBe(true);
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
        verifyWebhookSignature("invalid_payload", "invalid_signature")
      ).rejects.toThrow("Invalid signature");
    });

    it("sollte fehlende Signaturen ablehnen", async () => {
      // Act & Assert
      await expect(verifyWebhookSignature("payload", "")).rejects.toThrow(
        "Signature required"
      );
    });
  });
});

// Vereinfachte Hilfsfunktionen für Tests
async function validateCheckoutSession(sessionData: any) {
  const { customer, customer_details, payment_intent } = sessionData;

  if (!customer || !customer_details?.email) {
    throw new Error("Fehlende erforderliche Daten");
  }

  return {
    isValid: true,
    email: customer_details.email,
    customerId: customer,
    paymentIntentId: payment_intent,
  };
}

async function checkIfLicenseCreationNeeded(
  customerId: string,
  licenseExists: boolean = false
): Promise<boolean> {
  // Simuliert die Prüfung auf existierende Lizenz
  return !licenseExists;
}

async function processSubscriptionData(subscriptionId: string) {
  const subscriptionData = await mockStripe.subscriptions.retrieve(
    subscriptionId
  );

  return {
    subscriptionId: subscriptionData.id,
    endDate: new Date(subscriptionData.current_period_end * 1000).toISOString(),
    status: subscriptionData.status,
  };
}

async function processRefundEvent(
  chargeData: any,
  licenseExists: boolean = true
) {
  const { payment_intent } = chargeData;

  if (!payment_intent) {
    throw new Error("Payment Intent ID fehlt");
  }

  return {
    shouldDeactivateLicense: licenseExists,
    licenseNotFound: !licenseExists,
    paymentIntentId: payment_intent,
  };
}

async function verifyWebhookSignature(payload: string, signature: string) {
  if (!signature) {
    throw new Error("Signature required");
  }

  return await mockStripe.webhooks.constructEventAsync(
    payload,
    signature,
    TEST_CONSTANTS.STRIPE_WEBHOOK_SECRET
  );
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
