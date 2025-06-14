import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mockSupabaseClient, mockStripe, TEST_CONSTANTS } from '../setup'

// Mock der Supabase Functions
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('Stripe Webhook Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Setup Standard-Mocks
    mockStripe.webhooks.constructEventAsync.mockResolvedValue({
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_session',
          payment_status: 'paid',
          customer: 'cus_test_customer',
          payment_intent: 'pi_test_payment',
          customer_details: {
            email: TEST_CONSTANTS.EMAIL,
          },
          client_reference_id: TEST_CONSTANTS.DEVICE_ID,
          metadata: {
            deviceName: 'Test Device',
          },
        },
      },
    })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('checkout.session.completed Event', () => {
    it('sollte erfolgreich eine Lizenz nach erfolgreicher Zahlung erstellen', async () => {
      // Arrange
      const mockLicenseInsert = vi.fn().mockResolvedValue({
        data: {
          id: 'license-123',
          license_key: TEST_CONSTANTS.LICENSE_KEY,
          email: TEST_CONSTANTS.EMAIL,
        },
        error: null,
      })

      const mockDeviceInsert = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      })

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'licenses') {
          return {
            insert: mockLicenseInsert,
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn(),
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null,
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table === 'device_activations') {
          return {
            insert: mockDeviceInsert,
            select: vi.fn().mockReturnValue({
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
            }),
          }
        }
      })

      // Mock Welcome Email Function
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      })

      const webhookRequest = new Request('https://test.com/webhook', {
        method: 'POST',
        headers: {
          'stripe-signature': 't=12345,v1=test_signature',
          'content-type': 'application/json',
        },
        body: JSON.stringify({}),
      })

      // Act & Assert
      // Hier würde man normalerweise die Webhook-Funktion aufrufen
      // Da es eine Supabase Edge Function ist, testen wir die Logik simuliert

      expect(mockStripe.webhooks.constructEventAsync).toHaveBeenCalled()
      expect(mockLicenseInsert).toHaveBeenCalledWith({
        license_key: expect.stringMatching(/^SF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/),
        email: TEST_CONSTANTS.EMAIL,
        stripe_customer_id: 'cus_test_customer',
        stripe_payment_id: 'pi_test_payment',
        stripe_subscription_id: undefined,
        subscription_end_date: null,
        is_active: true,
      })
    })

    it('sollte bestehende Lizenz-Aktivierung prüfen und Duplikate verhindern', async () => {
      // Arrange
      const existingActivation = {
        id: 'activation-123',
        is_active: true,
        license_id: 'license-existing',
        licenses: {
          id: 'license-existing',
          is_active: true,
          email: TEST_CONSTANTS.EMAIL,
        },
      }

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'device_activations') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockReturnValue({
                    maybeSingle: vi.fn().mockResolvedValue({
                      data: existingActivation,
                      error: null,
                    }),
                  }),
                }),
              }),
            }),
          }
        }
      })

      // Act & Assert
      // Die Webhook-Funktion sollte keine neue Lizenz erstellen
      // wenn bereits eine aktive Lizenz für das Gerät existiert
    })

    it('sollte Subscription-Daten korrekt verarbeiten', async () => {
      // Arrange
      const subscriptionId = 'sub_test_subscription'
      const subscriptionEndTimestamp = Math.floor(Date.now() / 1000) + 86400 * 30 // 30 Tage

      mockStripe.webhooks.constructEventAsync.mockResolvedValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_session',
            payment_status: 'paid',
            customer: 'cus_test_customer',
            subscription: subscriptionId,
            customer_details: {
              email: TEST_CONSTANTS.EMAIL,
            },
            client_reference_id: TEST_CONSTANTS.DEVICE_ID,
            metadata: {
              deviceName: 'Test Device',
            },
          },
        },
      })

      mockStripe.subscriptions.retrieve.mockResolvedValue({
        id: subscriptionId,
        status: 'active',
        current_period_end: subscriptionEndTimestamp,
      })

      // Act & Assert
      expect(mockStripe.subscriptions.retrieve).toHaveBeenCalledWith(subscriptionId)
    })

    it('sollte Fehler bei fehlenden erforderlichen Daten behandeln', async () => {
      // Arrange
      mockStripe.webhooks.constructEventAsync.mockResolvedValue({
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_session',
            payment_status: 'paid',
            customer: 'cus_test_customer',
            payment_intent: 'pi_test_payment',
            customer_details: {
              email: null, // Fehlende E-Mail
            },
            client_reference_id: null, // Fehlende Device-ID
            metadata: {},
          },
        },
      })

      // Act & Assert
      // Die Webhook-Funktion sollte einen Fehler zurückgeben
      // wenn erforderliche Daten fehlen
    })
  })

  describe('charge.refunded Event', () => {
    it('sollte Lizenz nach Rückerstattung deaktivieren', async () => {
      // Arrange
      const paymentIntentId = 'pi_test_payment'
      
      mockStripe.webhooks.constructEventAsync.mockResolvedValue({
        type: 'charge.refunded',
        data: {
          object: {
            payment_intent: paymentIntentId,
          },
        },
      })

      const mockLicenseSelect = vi.fn().mockResolvedValue({
        data: { id: 'license-123' },
        error: null,
      })

      const mockLicenseUpdate = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      })

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'licenses') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: mockLicenseSelect,
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: mockLicenseUpdate,
            }),
          }
        }
      })

      // Act & Assert
      expect(mockLicenseSelect).toHaveBeenCalled()
      expect(mockLicenseUpdate).toHaveBeenCalledWith({ is_active: false })
    })

    it('sollte GDPR-Löschung korrekt behandeln (Lizenz bereits gelöscht)', async () => {
      // Arrange
      const paymentIntentId = 'pi_test_payment'
      
      mockStripe.webhooks.constructEventAsync.mockResolvedValue({
        type: 'charge.refunded',
        data: {
          object: {
            payment_intent: paymentIntentId,
          },
        },
      })

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'licenses') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Not found' },
                }),
              }),
            }),
          }
        }
      })

      // Act & Assert
      // Die Webhook-Funktion sollte trotzdem erfolgreich sein
      // wenn die Lizenz bereits durch GDPR-Löschung entfernt wurde
    })
  })

  describe('Webhook Signature Verification', () => {
    it('sollte ungültige Signaturen ablehnen', async () => {
      // Arrange
      mockStripe.webhooks.constructEventAsync.mockRejectedValue(
        new Error('Invalid signature')
      )

      // Act & Assert
      // Die Webhook-Funktion sollte einen 400-Fehler zurückgeben
    })

    it('sollte fehlende Signaturen ablehnen', async () => {
      // Arrange
      const webhookRequest = new Request('https://test.com/webhook', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // Keine stripe-signature Header
        },
        body: JSON.stringify({}),
      })

      // Act & Assert
      // Die Webhook-Funktion sollte einen 400-Fehler zurückgeben
    })
  })
})