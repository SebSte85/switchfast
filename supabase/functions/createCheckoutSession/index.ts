import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@12.0.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment",
};

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

  // 3. Fallback auf die Standardumgebung aus den Umgebungsvariablen
  const defaultEnv = Deno.env.get("ACTIVE_ENVIRONMENT") || "test";
  return defaultEnv;
}

serve(async (req) => {
  // CORS-Preflight-Anfragen behandeln
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Umgebung bestimmen
    const environment = getEnvironment(req);
    console.log(`Verwende Umgebung: ${environment}`);

    // Schema basierend auf der Umgebung auswählen
    const schema = environment === "prod" ? "prod" : "test";

    const { deviceId, deviceName, email } = await req.json();

    // Validierung der Eingaben
    if (!deviceId) {
      return new Response(
        JSON.stringify({
          error: "Geräte-ID ist erforderlich",
          userMessage:
            "Ein technischer Fehler ist aufgetreten. Bitte starten Sie die Anwendung neu und versuchen Sie es erneut.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Supabase-Client für Validierung initialisieren
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        db: {
          schema: schema,
        },
      }
    );

    // **NEU: Prüfung ob bereits eine aktive Lizenz für diese Device-ID existiert**
    const { data: existingActivations, error: activationError } =
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
        .eq("licenses.is_active", true);

    const existingActivation = existingActivations?.[0] || null;

    if (activationError) {
      console.error(
        "Fehler bei der Validierung bestehender Lizenzen:",
        activationError
      );
      return new Response(
        JSON.stringify({
          error: "Validierungsfehler",
          userMessage:
            "Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    if (existingActivation) {
      // Bereits eine aktive Lizenz für dieses Gerät gefunden
      const existingEmail = existingActivation.licenses.email;

      return new Response(
        JSON.stringify({
          error: "DEVICE_ALREADY_LICENSED",
          userMessage: `Für dieses Gerät ist bereits eine aktive Lizenz registriert${
            existingEmail ? ` (${existingEmail})` : ""
          }. Jedes Gerät kann nur eine Lizenz haben. Falls Sie Probleme mit Ihrer bestehenden Lizenz haben, kontaktieren Sie bitte unseren Support.`,
          existingLicenseEmail: existingEmail,
          suggestions: [
            "Prüfen Sie, ob Sie bereits eine Lizenz gekauft haben",
            "Kontaktieren Sie unseren Support für Lizenz-Transfer",
            "Verwenden Sie ein anderes Gerät für eine neue Lizenz",
          ],
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 409,
        }
      );
    }

    // Stripe-Konfiguration basierend auf der Umgebung
    const stripeSecretKey =
      environment === "prod"
        ? Deno.env.get("PROD_STRIPE_SECRET_KEY")
        : Deno.env.get("TEST_STRIPE_SECRET_KEY");

    const priceId =
      environment === "prod"
        ? Deno.env.get("PROD_STRIPE_PRICE_ID")
        : Deno.env.get("TEST_STRIPE_PRICE_ID");

    if (!stripeSecretKey || !priceId) {
      return new Response(
        JSON.stringify({
          error: "Stripe-Konfiguration fehlt",
          userMessage:
            "Der Zahlungsservice ist derzeit nicht verfügbar. Bitte versuchen Sie es später erneut.",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Stripe-Client initialisieren
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
    });

    // URLs für Erfolg und Abbruch
    const baseSuccessUrl =
      Deno.env.get("STRIPE_SUCCESS_URL") || "switchfast://payment-success";
    const baseCancelUrl =
      Deno.env.get("STRIPE_CANCEL_URL") || "switchfast://payment-cancel";

    // Füge Umgebungsparameter zu den URLs hinzu
    const successUrl = `${baseSuccessUrl}${
      baseSuccessUrl.includes("?") ? "&" : "?"
    }env=${environment}`;
    const cancelUrl = `${baseCancelUrl}${
      baseCancelUrl.includes("?") ? "&" : "?"
    }env=${environment}`;

    // Checkout-Session erstellen
    const sessionConfig: any = {
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: "payment",
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      // Wichtig: Device-ID als client_reference_id übergeben
      // Dies wird vom Webhook verwendet, um die Lizenz zu aktivieren
      client_reference_id: deviceId,
      metadata: {
        deviceName: deviceName || "Unbenanntes Gerät",
        productType: "software_license",
        licenseType: "single_device",
      },
      // Zusätzliche Checkout-Konfiguration für bessere UX
      billing_address_collection: "auto",
      phone_number_collection: {
        enabled: false,
      },
      shipping_address_collection: {
        allowed_countries: ["DE", "AT", "CH", "FR", "NL", "BE", "IT", "ES"],
      },
      custom_text: {
        submit: {
          message: "Ihre Lizenz wird automatisch nach der Zahlung aktiviert.",
        },
        shipping_address: {
          message: "Rechnungsadresse für Ihre Lizenz-Dokumentation",
        },
        terms_of_service_acceptance: {
          message: "Mit dem Kauf stimmen Sie unseren Geschäftsbedingungen zu.",
        },
      },
      consent_collection: {
        terms_of_service: "required",
      },
      invoice_creation: {
        enabled: true,
        invoice_data: {
          description: "switchfast Pro Lizenz - Lebenslange Desktop-Software",
          metadata: {
            deviceId: deviceId,
            deviceName: deviceName || "Unbenanntes Gerät",
            licenseType: "lifetime",
            platform: "desktop",
          },
          footer:
            "Vielen Dank für Ihren Kauf von switchfast! Ihre Lizenz wurde automatisch aktiviert.",
          custom_fields: [
            {
              name: "Geräte-ID",
              value: deviceId,
            },
            {
              name: "Gerätename",
              value: deviceName || "Unbenanntes Gerät",
            },
          ],
        },
      },
      // Automatische Steuerberechnung aktivieren
      automatic_tax: {
        enabled: true,
      },
      // Steuerverhalten konfigurieren
      tax_id_collection: {
        enabled: true,
      },
      // Zahlungsmethoden: nur Karte und Link
      payment_method_types: ["card", "link"],
    };

    // E-Mail nur hinzufügen, wenn sie vorhanden und gültig ist
    if (email && email.trim() && email.includes("@")) {
      sessionConfig.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionConfig);

    // Erfolgreiche Antwort mit der Checkout-URL
    return new Response(
      JSON.stringify({
        success: true,
        url: session.url,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Unerwarteter Fehler:", error);
    return new Response(
      JSON.stringify({
        error: "Ein unerwarteter Fehler ist aufgetreten",
        userMessage:
          "Ein technischer Fehler ist aufgetreten. Bitte versuchen Sie es später erneut.",
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
