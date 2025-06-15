// @deno-types="npm:@types/stripe"
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment, stripe-signature",
};

// ✅ SICHERHEIT: Stripe IP-Adressen für Validierung
const STRIPE_WEBHOOK_IPS = [
  '3.18.12.63/32',
  '3.130.192.231/32',
  '13.235.14.237/32',
  '13.235.122.149/32',
  '18.211.135.69/32',
  '35.154.171.200/32',
  '52.15.183.38/32',
  '54.88.130.119/32',
  '54.88.130.237/32',
  '54.187.174.169/32',
  '54.187.205.235/32',
  '54.187.216.72/32'
];

// ✅ SICHERHEIT: IP-Adresse validieren
function isValidStripeIP(request: Request): boolean {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const clientIP = forwardedFor?.split(',')[0].trim();
  
  if (!clientIP) {
    console.log('🔴 No client IP found in headers');
    return false;
  }

  console.log(`🔍 Validating client IP: ${clientIP}`);
  
  // In Development: Skip IP validation
  if (Deno.env.get('ACTIVE_ENVIRONMENT') === 'test') {
    console.log('🟡 Development mode: Skipping IP validation');
    return true;
  }

  // Production: Validate against Stripe IPs
  const isValid = STRIPE_WEBHOOK_IPS.some(ip => {
    const [network, mask] = ip.split('/');
    return ipInRange(clientIP, network, parseInt(mask));
  });

  if (!isValid) {
    console.log(`🔴 Invalid IP: ${clientIP} not in Stripe IP ranges`);
  }

  return isValid;
}

// ✅ HILFSFUNKTION: IP-Range Validierung
function ipInRange(ip: string, network: string, mask: number): boolean {
  const ipNum = ipToNumber(ip);
  const netNum = ipToNumber(network);
  const maskNum = (0xffffffff << (32 - mask)) >>> 0;
  
  return (ipNum & maskNum) === (netNum & maskNum);
}

function ipToNumber(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
}

// Funktion zum Ermitteln der aktiven Umgebung
function getEnvironment(req: Request): string {
  // 1. Prüfen des x-environment Headers
  const envHeader = req.headers.get("x-environment");
  if (envHeader === "test" || envHeader === "prod") {
    return envHeader;
  }

  // 2. Prüfen des env Query-Parameters
  const url = new URL(req.url);
  const envParam = url.searchParams.get("env");
  if (envParam === "test" || envParam === "prod") {
    return envParam;
  }

  // 3. Prüfen des Referer-Headers (für Stripe-Webhooks)
  const referer = req.headers.get("referer") || "";
  if (referer.includes("stripe.com")) {
    console.log("🟢 Webhook call from Stripe detected, using test environment");
    return "test";
  }

  // 4. Fallback auf die Standardumgebung aus den Umgebungsvariablen
  const defaultEnv = Deno.env.get("ACTIVE_ENVIRONMENT") || "test";
  console.log(`🟢 Fallback to environment variable: ${defaultEnv}`);
  return defaultEnv;
}

serve(async (req) => {
  // CORS-Preflight-Anfragen behandeln
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ✅ SICHERHEIT: IP-Validierung vor weiterer Verarbeitung
    if (!isValidStripeIP(req)) {
      console.log('🔴 SECURITY: Invalid IP address for webhook');
      return new Response(
        JSON.stringify({ error: "Unauthorized IP address" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Umgebung bestimmen
    const environment = getEnvironment(req);
    console.log(`🟢 Using environment: ${environment}`);

    // Schema basierend auf der Umgebung auswählen
    const schema = environment === "prod" ? "prod" : "test";
    console.log(`🟢 Using schema: ${schema}`);

    // Stripe-Konfiguration basierend auf der Umgebung auswählen
    const stripeSecretKey =
      environment === "prod"
        ? Deno.env.get("PROD_STRIPE_SECRET_KEY")
        : Deno.env.get("TEST_STRIPE_SECRET_KEY");

    // ✅ SICHERHEIT: Webhook-Secret aus Environment Variables
    const webhookSecretKey =
      environment === "prod"
        ? "PROD_STRIPE_WEBHOOK_SECRET"
        : "TEST_STRIPE_WEBHOOK_SECRET";

    console.log(`🔍 Looking for webhook secret with key: ${webhookSecretKey}`);

    const stripeWebhookSecret = Deno.env.get(webhookSecretKey);

    // ✅ SICHERHEIT: Kein Fallback auf hardcoded Secret mehr
    if (!stripeWebhookSecret) {
      console.error(`🔴 CRITICAL: ${webhookSecretKey} environment variable not configured`);
      return new Response(
        JSON.stringify({ 
          error: "Webhook configuration error",
          message: "Webhook secret not configured properly"
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`🟢 Stripe config:`, {
      environment: environment,
      hasSecretKey: !!stripeSecretKey,
      secretKeyPrefix: stripeSecretKey?.substring(0, 10) || "MISSING",
      hasWebhookSecret: !!stripeWebhookSecret,
      webhookSecretPrefix: stripeWebhookSecret?.substring(0, 10) || "MISSING",
    });

    // Stripe-Webhook-Signatur aus dem Header extrahieren
    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      console.log(`🔴 ERROR: Missing Stripe signature`);
      return new Response(
        JSON.stringify({ error: "Fehlende Stripe-Signatur" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    console.log(`🟢 Stripe signature received:`, {
      signaturePrefix: signature.substring(0, 20) + "...",
    });

    // Webhook-Ereignis mit asynchroner Signaturverifizierung verarbeiten
    const rawBody = await req.text();
    console.log(`🟢 Raw body received, length: ${rawBody.length}`);

    let event;

    try {
      // Stripe-Instanz erstellen
      const stripe = new Stripe(stripeSecretKey || "");
      console.log(`🔍 Verifying webhook signature...`);

      // ✅ SICHERHEIT: Signaturverifizierung mit Environment Variable
      event = await stripe.webhooks.constructEventAsync(
        rawBody,
        signature,
        stripeWebhookSecret
      );
      console.log(
        "🟢 Signature successfully verified with constructEventAsync!"
      );
    } catch (err) {
      console.log(`🔴 ERROR: Signature verification failed (async)`, {
        error: err instanceof Error ? err.message : err,
        environment: environment,
      });
      return new Response(
        JSON.stringify({
          error: "Ungültige Signatur",
          details: err instanceof Error ? err.message : "Unbekannter Fehler",
          environment,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Stripe-Client initialisieren mit dem entsprechenden API-Key
    const stripe = new Stripe(stripeSecretKey ?? "", {
      apiVersion: "2023-10-16",
    });

    // Supabase-Client initialisieren mit korrekter Schema-Konfiguration
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log(`🟢 Supabase config:`, {
      hasUrl: !!supabaseUrl,
      hasServiceKey: !!supabaseServiceKey,
      schema: schema,
    });

    const supabaseClient = createClient(
      supabaseUrl ?? "",
      supabaseServiceKey ?? "",
      {
        db: {
          schema: schema,
        },
      }
    );

    console.log(`🟢 Processing webhook event type: ${event.type}`);

    // Event-Typ verarbeiten
    switch (event.type) {
      case "checkout.session.completed": {
        console.log("🟢 Processing checkout.session.completed event");
        const sessionId = event.data.object.id;

        // Checkout Session mit erweiterten line_items abrufen (Stripe Best Practice)
        let session;
        try {
          console.log(
            `🔍 Retrieving checkout session: ${sessionId.substring(0, 20)}...`
          );
          session = await stripe.checkout.sessions.retrieve(sessionId, {
            expand: ["line_items"],
          });
          console.log(
            "🟢 Checkout session successfully retrieved with line_items"
          );
        } catch (error) {
          console.log(`🔴 ERROR: Failed to retrieve checkout session`, {
            error: error.message,
          });
          return new Response(
            JSON.stringify({ error: "Fehler beim Abrufen der Session" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        console.log(`🟢 Session details:`, {
          paymentStatus: session.payment_status,
          clientReferenceId: session.client_reference_id,
          hasMetadata:
            !!session.metadata && Object.keys(session.metadata).length > 0,
        });

        // Prüfen, ob die Zahlung erfolgreich war
        if (session.payment_status === "paid") {
          const customerId = session.customer;
          const paymentId = session.payment_intent;
          const email = session.customer_details?.email;

          // Device-ID aus client_reference_id extrahieren (Primary) oder aus metadata (Fallback)
          const deviceId =
            session.client_reference_id || session.metadata?.deviceId;
          const deviceName =
            session.metadata?.deviceName || "Unbenanntes Gerät";

          console.log("Extrahierte Daten:", {
            deviceId,
            deviceName,
            email,
            customerId,
            paymentId,
          });

          if (!email || !deviceId) {
            console.error("Fehlende erforderliche Daten:", {
              email,
              deviceId,
            });
            return new Response(
              JSON.stringify({
                error: "Fehlende erforderliche Daten",
                missing: { email: !email, deviceId: !deviceId },
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 400,
              }
            );
          }

          // **NEU: Zusätzliche Sicherheitsprüfung - doppelte Geräte-Aktivierungen verhindern**
          const { data: existingActivation, error: activationCheckError } =
            await supabaseClient
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

          if (activationCheckError) {
            console.error(
              "Fehler bei der Validierung bestehender Aktivierungen:",
              activationCheckError
            );
          } else if (existingActivation) {
            console.log(
              `⚠️ Gerät ${deviceId} hat bereits eine aktive Lizenz. Überspringe Lizenz-Erstellung.`
            );

            // Webhook als erfolgreich behandeln, aber keine neue Lizenz erstellen
            return new Response(
              JSON.stringify({
                success: true,
                message:
                  "Gerät bereits lizenziert - keine neue Lizenz erstellt",
                existing_license: true,
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
              }
            );
          }

          // Line items verarbeiten (um zu wissen was gekauft wurde)
          const lineItems = session.line_items?.data || [];
          console.log(
            "Gekaufte Items:",
            lineItems.map((item) => ({
              description: item.description,
              amount: item.amount_total,
              quantity: item.quantity,
            }))
          );

          // Eindeutigen Lizenzschlüssel generieren (Format: SF-XXXX-XXXX-XXXX)
          const licenseKey = `SF-${generateRandomString(
            4
          )}-${generateRandomString(4)}-${generateRandomString(4)}`;

          console.log("Erstelle Lizenz mit Key:", licenseKey);

          // Für Subscriptions: Subscription ID aus der Session extrahieren
          const subscriptionId = session.subscription;

          // Subscription Details abrufen für Ablaufdatum
          let subscriptionEndDate = null;
          if (subscriptionId) {
            try {
              const subscription = await stripe.subscriptions.retrieve(
                subscriptionId
              );
              console.log("Subscription Details:", {
                id: subscription.id,
                status: subscription.status,
                current_period_end: subscription.current_period_end,
              });

              // Unix timestamp zu ISO string
              subscriptionEndDate = new Date(
                subscription.current_period_end * 1000
              ).toISOString();
              console.log("Subscription endet am:", subscriptionEndDate);
            } catch (error) {
              console.error("Fehler beim Abrufen der Subscription:", error);
            }
          }

          // Neue Lizenz in der Datenbank erstellen
          const { data: licenseData, error: licenseError } =
            await supabaseClient
              .from("licenses")
              .insert({
                license_key: licenseKey,
                email: email,
                stripe_customer_id: customerId,
                stripe_payment_id: paymentId, // Kann bei Subscriptions null sein
                stripe_subscription_id: subscriptionId,
                subscription_end_date: subscriptionEndDate, // Neues Feld
                is_active: true,
              })
              .select()
              .single();

          if (licenseError) {
            console.error("Fehler beim Erstellen der Lizenz:", licenseError);
            return new Response(
              JSON.stringify({
                error: "Fehler beim Erstellen der Lizenz",
                details: licenseError,
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 500,
              }
            );
          }

          console.log("Lizenz erfolgreich erstellt:", licenseData);

          // Gerät aktivieren
          const { error: deviceError } = await supabaseClient
            .from("device_activations")
            .insert({
              license_id: licenseData.id,
              device_id: deviceId,
              device_name: deviceName,
              first_activated_at: new Date().toISOString(),
              last_check_in: new Date().toISOString(),
              is_active: true,
            });

          if (deviceError) {
            console.error("Fehler beim Aktivieren des Geräts:", deviceError);
            return new Response(
              JSON.stringify({
                error: "Fehler beim Aktivieren des Geräts",
                details: deviceError,
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 500,
              }
            );
          }

          console.log(
            `✅ Lizenz erfolgreich erstellt für ${email} mit Gerät ${deviceId} (${deviceName})`
          );
          console.log(`✅ Lizenzschlüssel: ${licenseKey}`);

          // Send welcome email
          try {
            console.log("🟢 Sending welcome email...");
            const welcomeEmailResponse = await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/sendWelcomeEmail`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  email: email,
                  licenseKey: licenseKey,
                  deviceName: deviceName,
                }),
              }
            );

            if (welcomeEmailResponse.ok) {
              console.log("✅ Welcome email sent successfully");
            } else {
              console.error(
                "⚠️ Welcome email failed:",
                await welcomeEmailResponse.text()
              );
            }
          } catch (emailError) {
            console.error("⚠️ Welcome email error (non-critical):", emailError);
            // Don't fail the webhook if email fails
          }
        } else {
          console.log(
            `Zahlung noch nicht abgeschlossen. Status: ${session.payment_status}`
          );
        }
        break;
      }

      case "charge.refunded": {
        const charge = event.data.object;
        const paymentIntentId = charge.payment_intent;

        if (paymentIntentId) {
          // Lizenz finden und deaktivieren (Schema ist bereits im Client konfiguriert)
          const { data: licenseData, error: licenseError } =
            await supabaseClient
              .from("licenses")
              .select("id")
              .eq("stripe_payment_id", paymentIntentId)
              .single();

          if (licenseError || !licenseData) {
            console.error(
              "Lizenz für Rückerstattung nicht gefunden:",
              paymentIntentId
            );

            // GDPR/Account-Löschung: Wenn Lizenz bereits anonymisiert wurde, ist das OK
            console.log(
              `ℹ️ [WEBHOOK] License for payment ${paymentIntentId} not found - possibly already deleted due to account deletion (GDPR). This is expected behavior.`
            );

            // Webhook als erfolgreich behandeln - kein Fehler
            return new Response(
              JSON.stringify({
                success: true,
                message: "License already processed or deleted",
                payment_intent_id: paymentIntentId,
              }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 200,
              }
            );
          }

          // Lizenz deaktivieren (mit Schema)
          const { error: updateError } = await supabaseClient
            .from(`${schema}.licenses`)
            .update({ is_active: false })
            .eq("id", licenseData.id);

          if (updateError) {
            console.error("Fehler beim Deaktivieren der Lizenz:", updateError);
            return new Response(
              JSON.stringify({ error: "Fehler beim Deaktivieren der Lizenz" }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 500,
              }
            );
          }

          // Alle Geräte für diese Lizenz deaktivieren
          const { error: devicesError } = await supabaseClient
            .from("device_activations")
            .update({ is_active: false })
            .eq("license_id", licenseData.id);

          if (devicesError) {
            console.error("Fehler beim Deaktivieren der Geräte:", devicesError);
            return new Response(
              JSON.stringify({ error: "Fehler beim Deaktivieren der Geräte" }),
              {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
                status: 500,
              }
            );
          }

          console.log(
            `Lizenz deaktiviert aufgrund von Rückerstattung für Payment Intent ${paymentIntentId}`
          );
        }
        break;
      }

      case "customer.subscription.updated": {
        // Subscription wurde geändert (z.B. gecancelt mit cancel_at_period_end)
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        console.log(`Verarbeite Subscription Update: ${subscriptionId}`);

        // Prüfen ob Cancellation geplant ist
        if (subscription.cancel_at_period_end) {
          console.log(
            `Subscription wurde gekündigt (cancel_at_period_end): ${subscriptionId}`
          );

          // Lizenz finden und Cancellation-Datum setzen
          const { error: updateError } = await supabaseClient
            .from("licenses")
            .update({
              cancelled_at: new Date().toISOString(),
              cancels_at_period_end: true,
            })
            .eq("stripe_subscription_id", subscriptionId);

          if (updateError) {
            console.error("Fehler beim Setzen der Cancellation:", updateError);
          } else {
            console.log(
              `✅ Subscription Cancellation markiert: ${subscriptionId}`
            );
          }
        } else if (subscription.cancel_at_period_end === false) {
          // Cancellation wurde rückgängig gemacht
          const { error: updateError } = await supabaseClient
            .from("licenses")
            .update({
              cancelled_at: null,
              cancels_at_period_end: false,
            })
            .eq("stripe_subscription_id", subscriptionId);

          if (updateError) {
            console.error(
              "Fehler beim Entfernen der Cancellation:",
              updateError
            );
          } else {
            console.log(
              `✅ Subscription Cancellation entfernt: ${subscriptionId}`
            );
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        // Abonnement wurde gekündigt oder abgelaufen
        const subscription = event.data.object;
        const subscriptionId = subscription.id;

        console.log(`Verarbeite Subscription Deletion: ${subscriptionId}`);

        // Cancellation-Daten aus dem Stripe Event extrahieren
        const cancelledAt = subscription.canceled_at
          ? new Date(subscription.canceled_at * 1000).toISOString()
          : new Date().toISOString();

        // Lizenz finden und deaktivieren
        const { data: licenseData, error: licenseError } = await supabaseClient
          .from("licenses")
          .select("id")
          .eq("stripe_subscription_id", subscriptionId)
          .single();

        if (licenseError || !licenseData) {
          console.error(
            "Lizenz für Abonnement-Löschung nicht gefunden:",
            subscriptionId
          );

          // GDPR/Account-Löschung: Wenn Lizenz bereits anonymisiert wurde, ist das OK
          // Der User hat möglicherweise seinen Account gelöscht BEVOR der Webhook ankam
          console.log(
            `ℹ️ [WEBHOOK] License for subscription ${subscriptionId} not found - possibly already deleted due to account deletion (GDPR). This is expected behavior.`
          );

          // Webhook als erfolgreich behandeln - kein Fehler
          return new Response(
            JSON.stringify({
              success: true,
              message: "License already processed or deleted",
              subscription_id: subscriptionId,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            }
          );
        }

        // Lizenz deaktivieren und Cancellation-Daten setzen
        const { error: updateError } = await supabaseClient
          .from("licenses")
          .update({
            is_active: false,
            cancelled_at: cancelledAt,
            cancels_at_period_end: true, // War gekündigt und ist jetzt abgelaufen
          })
          .eq("id", licenseData.id);

        if (updateError) {
          console.error("Fehler beim Deaktivieren der Lizenz:", updateError);
          return new Response(
            JSON.stringify({ error: "Fehler beim Deaktivieren der Lizenz" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        // Alle Geräte für diese Lizenz deaktivieren
        const { error: devicesError } = await supabaseClient
          .from("device_activations")
          .update({ is_active: false })
          .eq("license_id", licenseData.id);

        if (devicesError) {
          console.error("Fehler beim Deaktivieren der Geräte:", devicesError);
          return new Response(
            JSON.stringify({ error: "Fehler beim Deaktivieren der Geräte" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        console.log(
          `✅ Lizenz deaktiviert aufgrund von Subscription Deletion: ${subscriptionId}, gekündigt am: ${cancelledAt}`
        );
        break;
      }

      case "invoice.payment_succeeded": {
        // Erfolgreiche Zahlung - Subscription verlängert
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        if (subscriptionId) {
          console.log(`✅ Subscription-Zahlung erfolgreich: ${subscriptionId}`);

          // Subscription Details abrufen für neues Ablaufdatum
          try {
            const subscription = await stripe.subscriptions.retrieve(
              subscriptionId
            );
            const newEndDate = new Date(
              subscription.current_period_end * 1000
            ).toISOString();

            // Lizenz-Ablaufdatum aktualisieren
            const { error: updateError } = await supabaseClient
              .from("licenses")
              .update({
                subscription_end_date: newEndDate,
                is_active: true, // Sicherstellen dass die Lizenz aktiv ist
              })
              .eq("stripe_subscription_id", subscriptionId);

            if (updateError) {
              console.error(
                "Fehler beim Aktualisieren des Ablaufdatums:",
                updateError
              );
            } else {
              console.log(`✅ Subscription verlängert bis: ${newEndDate}`);
            }
          } catch (error) {
            console.error("Fehler beim Abrufen der Subscription:", error);
          }
        }
        break;
      }

      case "invoice.payment_failed": {
        // Zahlung fehlgeschlagen - Optional: Warnung senden, aber Lizenz noch nicht deaktivieren
        const invoice = event.data.object;
        const subscriptionId = invoice.subscription;

        console.log(
          `⚠️ Zahlung fehlgeschlagen für Subscription: ${subscriptionId}`
        );
        // Hier könnte eine E-Mail-Benachrichtigung gesendet werden
        break;
      }

      // Weitere Event-Typen können hier hinzugefügt werden

      default:
        console.log(`Unbehandelter Event-Typ: ${event.type}`);
    }

    // Erfolgreiche Antwort
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Unerwarteter Fehler:", error);
    return new Response(
      JSON.stringify({ error: "Ein unerwarteter Fehler ist aufgetreten" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});

// Hilfsfunktion zum Generieren eines zufälligen Strings
function generateRandomString(length: number): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
