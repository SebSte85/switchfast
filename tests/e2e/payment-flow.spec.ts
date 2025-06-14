import { test, expect } from '@playwright/test'

test.describe('Payment Flow End-to-End', () => {
  test.beforeEach(async ({ page }) => {
    // Setup test environment
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('Vollständiger Zahlungsablauf: Trial → Checkout → Lizenz-Aktivierung', async ({ page }) => {
    // 1. App-Start und Trial-Check
    await test.step('App startet und zeigt Trial-Status', async () => {
      await expect(page.locator('[data-testid="trial-status"]')).toBeVisible()
      await expect(page.locator('[data-testid="trial-days-remaining"]')).toContainText('7')
    })

    // 2. Upgrade-Button klicken
    await test.step('Upgrade-Button führt zu Checkout', async () => {
      await page.click('[data-testid="upgrade-button"]')
      
      // Warten auf Stripe Checkout redirect
      await page.waitForURL(/checkout\.stripe\.com/)
      
      // Überprüfen dass Checkout-Seite geladen wurde
      await expect(page.locator('[data-testid="checkout-form"]')).toBeVisible()
    })

    // 3. Testdaten für Stripe Checkout eingeben
    await test.step('Stripe Checkout ausfüllen', async () => {
      // E-Mail eingeben
      await page.fill('[data-testid="email"]', 'test@example.com')
      
      // Kreditkarten-Testdaten (Stripe Test Card)
      await page.fill('[data-testid="cardNumber"]', '4242424242424242')
      await page.fill('[data-testid="cardExpiry"]', '12/25')
      await page.fill('[data-testid="cardCvc"]', '123')
      
      // Zahlung abschließen
      await page.click('[data-testid="submit-payment"]')
    })

    // 4. Erfolgreiche Zahlung und Redirect zurück zur App
    await test.step('Erfolgreiche Zahlung führt zurück zur App', async () => {
      // Warten auf Success-Redirect
      await page.waitForURL(/localhost.*success/)
      
      // Überprüfen dass Success-Seite angezeigt wird
      await expect(page.locator('[data-testid="payment-success"]')).toBeVisible()
      await expect(page.locator('[data-testid="license-key"]')).toBeVisible()
    })

    // 5. App-Neustart simulieren und Lizenz-Aktivierung prüfen
    await test.step('App-Neustart zeigt aktivierte Lizenz', async () => {
      // Seite neu laden um App-Neustart zu simulieren
      await page.reload()
      await page.waitForLoadState('networkidle')
      
      // Überprüfen dass Trial-Banner verschwunden ist
      await expect(page.locator('[data-testid="trial-status"]')).not.toBeVisible()
      
      // Überprüfen dass Pro-Version aktiv ist
      await expect(page.locator('[data-testid="pro-status"]')).toBeVisible()
      await expect(page.locator('[data-testid="pro-status"]')).toContainText('Pro Version aktiviert')
    })
  })

  test('Trial-Ablauf nach 7 Tagen blockiert App-Nutzung', async ({ page }) => {
    // Mock der Trial-Ablauf durch API-Manipulation
    await page.route('**/functions/v1/checkTrialStatus', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          is_trial_active: false,
          remaining_days: 0,
          message: 'Trial ist abgelaufen'
        })
      })
    })

    await test.step('Abgelaufener Trial zeigt Blockierungs-Screen', async () => {
      await page.reload()
      await page.waitForLoadState('networkidle')
      
      // Überprüfen dass Trial-Expired-Screen angezeigt wird
      await expect(page.locator('[data-testid="trial-expired"]')).toBeVisible()
      await expect(page.locator('[data-testid="trial-expired-message"]')).toContainText('Trial abgelaufen')
      
      // App-Funktionen sollten blockiert sein
      await expect(page.locator('[data-testid="main-app-content"]')).not.toBeVisible()
    })

    await test.step('Upgrade-Button im Trial-Expired-Screen funktioniert', async () => {
      await page.click('[data-testid="upgrade-from-expired"]')
      
      // Sollte zu Stripe Checkout weiterleiten
      await page.waitForURL(/checkout\.stripe\.com/)
    })
  })

  test('Fehlgeschlagene Zahlung zeigt Fehler-Meldung', async ({ page }) => {
    await test.step('Upgrade-Button klicken', async () => {
      await page.click('[data-testid="upgrade-button"]')
      await page.waitForURL(/checkout\.stripe\.com/)
    })

    await test.step('Fehlgeschlagene Zahlung mit Test-Karte', async () => {
      await page.fill('[data-testid="email"]', 'test@example.com')
      
      // Stripe Test Card die fehlschlägt
      await page.fill('[data-testid="cardNumber"]', '4000000000000002')
      await page.fill('[data-testid="cardExpiry"]', '12/25')
      await page.fill('[data-testid="cardCvc"]', '123')
      
      await page.click('[data-testid="submit-payment"]')
      
      // Fehler-Meldung sollte angezeigt werden
      await expect(page.locator('[data-testid="payment-error"]')).toBeVisible()
      await expect(page.locator('[data-testid="payment-error"]')).toContainText('Zahlung fehlgeschlagen')
    })
  })

  test('Lizenz-Validierung bei App-Start', async ({ page }) => {
    // Mock einer aktiven Lizenz
    await page.route('**/functions/v1/checkLicenseStatus', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          is_licensed: true,
          license_key: 'SF-TEST-1234-5678',
          expires_at: null // Perpetual license
        })
      })
    })

    await test.step('App startet mit gültiger Lizenz', async () => {
      await page.reload()
      await page.waitForLoadState('networkidle')
      
      // Sollte direkt in Pro-Modus starten
      await expect(page.locator('[data-testid="pro-status"]')).toBeVisible()
      await expect(page.locator('[data-testid="trial-status"]')).not.toBeVisible()
      
      // Alle App-Funktionen sollten verfügbar sein
      await expect(page.locator('[data-testid="main-app-content"]')).toBeVisible()
      await expect(page.locator('[data-testid="theme-management"]')).toBeVisible()
    })
  })

  test('Subscription-Ablauf zeigt Renewal-Hinweis', async ({ page }) => {
    // Mock einer ablaufenden Subscription
    const expiryDate = new Date()
    expiryDate.setDate(expiryDate.getDate() + 3) // Läuft in 3 Tagen ab

    await page.route('**/functions/v1/checkLicenseStatus', (route) => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          is_licensed: true,
          license_key: 'SF-TEST-1234-5678',
          expires_at: expiryDate.toISOString(),
          days_until_expiry: 3
        })
      })
    })

    await test.step('App zeigt Renewal-Warnung bei ablaufender Subscription', async () => {
      await page.reload()
      await page.waitForLoadState('networkidle')
      
      // Renewal-Banner sollte angezeigt werden
      await expect(page.locator('[data-testid="renewal-warning"]')).toBeVisible()
      await expect(page.locator('[data-testid="renewal-warning"]')).toContainText('3 Tage')
      
      // Renew-Button sollte funktionieren
      await page.click('[data-testid="renew-subscription"]')
      await page.waitForURL(/checkout\.stripe\.com/)
    })
  })
})

test.describe('Webhook-Integration Tests', () => {
  test('Webhook löst Lizenz-Aktivierung aus', async ({ page, request }) => {
    // Simuliere einen Stripe Webhook-Call
    const webhookPayload = {
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_session',
          payment_status: 'paid',
          customer: 'cus_test_customer',
          payment_intent: 'pi_test_payment',
          customer_details: {
            email: 'test@example.com'
          },
          client_reference_id: 'test-device-12345',
          metadata: {
            deviceName: 'Test Device'
          }
        }
      }
    }

    await test.step('Webhook-Call triggert Lizenz-Erstellung', async () => {
      const response = await request.post('/functions/v1/handleStripeWebhook', {
        headers: {
          'stripe-signature': 't=12345,v1=test_signature',
          'content-type': 'application/json'
        },
        data: webhookPayload
      })

      expect(response.status()).toBe(200)
      
      const responseBody = await response.json()
      expect(responseBody.success).toBe(true)
      expect(responseBody.license_key).toMatch(/^SF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    })

    await test.step('App reflektiert neue Lizenz nach Webhook', async () => {
      // Mock der neuen Lizenz-Status
      await page.route('**/functions/v1/checkLicenseStatus', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            is_licensed: true,
            license_key: 'SF-TEST-1234-5678'
          })
        })
      })

      await page.reload()
      await page.waitForLoadState('networkidle')
      
      // App sollte jetzt Pro-Status zeigen
      await expect(page.locator('[data-testid="pro-status"]')).toBeVisible()
    })
  })

  test('Refund-Webhook deaktiviert Lizenz', async ({ page, request }) => {
    const refundWebhookPayload = {
      type: 'charge.refunded',
      data: {
        object: {
          payment_intent: 'pi_test_payment'
        }
      }
    }

    await test.step('Refund-Webhook deaktiviert Lizenz', async () => {
      const response = await request.post('/functions/v1/handleStripeWebhook', {
        headers: {
          'stripe-signature': 't=12345,v1=test_signature',
          'content-type': 'application/json'
        },
        data: refundWebhookPayload
      })

      expect(response.status()).toBe(200)
    })

    await test.step('App zeigt deaktivierte Lizenz nach Refund', async () => {
      // Mock der deaktivierten Lizenz
      await page.route('**/functions/v1/checkLicenseStatus', (route) => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({
            success: true,
            is_licensed: false,
            message: 'Lizenz wurde deaktiviert'
          })
        })
      })

      await page.reload()
      await page.waitForLoadState('networkidle')
      
      // Sollte zurück zum Trial-Modus fallen
      await expect(page.locator('[data-testid="trial-status"]')).toBeVisible()
      await expect(page.locator('[data-testid="pro-status"]')).not.toBeVisible()
    })
  })
})