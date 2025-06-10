import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@12.0.0";
import { generateLicenseKey } from "../_shared/licenseUtils.ts";

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
    console.log(`🟢 Using environment: ${environment}`);

    // Stripe-Key basierend auf der Umgebung auswählen
    const stripeSecretKey =
      environment === "prod"
        ? Deno.env.get("PROD_STRIPE_SECRET_KEY")
        : Deno.env.get("TEST_STRIPE_SECRET_KEY");

    console.log(`🟢 Stripe config:`, {
      environment: environment,
      hasSecretKey: !!stripeSecretKey,
      secretKeyPrefix: stripeSecretKey?.substring(0, 10) || "MISSING",
    });

    if (!stripeSecretKey) {
      console.log(
        `🔴 ERROR: Stripe Secret Key missing for environment: ${environment}`
      );
      return new Response(
        JSON.stringify({
          error: `Stripe Secret Key für Umgebung ${environment} ist nicht konfiguriert`,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Request-Daten abrufen
    const { sessionId, deviceId, deviceName } = await req.json();
    console.log(`🟢 Request data:`, {
      hasSessionId: !!sessionId,
      sessionIdPrefix: sessionId?.substring(0, 20) || "MISSING",
      deviceId: deviceId || "MISSING",
      deviceName: deviceName || "NOT_PROVIDED",
    });

    // Validierung der Eingaben
    if (!sessionId || !deviceId) {
      console.log(`🔴 ERROR: Missing required fields`, {
        hasSessionId: !!sessionId,
        hasDeviceId: !!deviceId,
      });
      return new Response(
        JSON.stringify({ error: "Fehlende Session-ID oder Geräte-ID" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Stripe-Client initialisieren mit dem umgebungsspezifischen Key
    console.log(`🟢 Initializing Stripe client`);
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: "2023-10-16",
    });

    // Checkout-Session abrufen und überprüfen
    console.log(
      `🔍 Retrieving Stripe session: ${sessionId.substring(0, 20)}...`
    );
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    console.log(`🟢 Session retrieved:`, {
      sessionId: session.id,
      paymentStatus: session.payment_status,
      customerEmail: session.customer_details?.email || "NOT_PROVIDED",
      customerId: session.customer || "NOT_PROVIDED",
    });

    // Prüfen, ob die Session erfolgreich bezahlt wurde
    if (session.payment_status !== "paid") {
      console.log(`🔴 ERROR: Payment not completed`, {
        paymentStatus: session.payment_status,
        sessionId: session.id,
      });
      return new Response(
        JSON.stringify({
          error: "Die Zahlung wurde nicht abgeschlossen",
          success: false,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Supabase-Client initialisieren
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log(`🟢 Supabase config:`, {
      hasUrl: !!supabaseUrl,
      hasServiceKey: !!supabaseServiceKey,
      schema: environment === "prod" ? "prod" : "test",
    });

    if (!supabaseUrl || !supabaseServiceKey) {
      console.log(`🔴 ERROR: Supabase configuration missing`);
      return new Response(
        JSON.stringify({
          error: "Supabase-Konfiguration fehlt",
          success: false,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      db: { schema: environment === "prod" ? "prod" : "test" },
    });

    // Kundeninformationen aus der Session abrufen
    const customerEmail = session.customer_details?.email;
    const stripeCustomerId = session.customer;
    const stripePaymentId = session.payment_intent as string;

    console.log(`🟢 Customer info extracted:`, {
      email: customerEmail || "NOT_PROVIDED",
      customerId: stripeCustomerId || "NOT_PROVIDED",
      paymentId: stripePaymentId || "NOT_PROVIDED",
    });

    if (!customerEmail) {
      console.log(`🔴 ERROR: No customer email found in session`);
      return new Response(
        JSON.stringify({
          error: "Keine Kunden-E-Mail in der Session gefunden",
          success: false,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Prüfen, ob bereits eine Lizenz für diese E-Mail existiert
    console.log(`🔍 Checking for existing license:`, {
      email: customerEmail,
      paymentId: stripePaymentId,
    });
    const { data: existingLicense, error: existingLicenseError } =
      await supabaseClient
        .from("licenses")
        .select("license_key")
        .eq("email", customerEmail)
        .eq("stripe_payment_id", stripePaymentId)
        .single();

    if (existingLicenseError && existingLicenseError.code !== "PGRST116") {
      console.log(`🔴 ERROR: Failed to check existing license`, {
        existingLicenseError,
      });
    }

    let licenseKey;

    if (existingLicense) {
      // Wenn bereits eine Lizenz existiert, verwende diese
      licenseKey = existingLicense.license_key;
      console.log(
        `🟡 Found existing license: ${licenseKey.substring(0, 10)}...`
      );
    } else {
      // Neue Lizenz erstellen
      licenseKey = generateLicenseKey();
      console.log(
        `🟢 Generated new license key: ${licenseKey.substring(0, 10)}...`
      );

      // Lizenz in der Datenbank speichern
      console.log(`🟢 Saving new license to database`);
      const { error: licenseError } = await supabaseClient
        .from("licenses")
        .insert({
          license_key: licenseKey,
          email: customerEmail,
          stripe_customer_id: stripeCustomerId,
          stripe_payment_id: stripePaymentId,
          is_active: true,
        });

      if (licenseError) {
        console.log(`🔴 ERROR: Failed to create license`, { licenseError });
        return new Response(
          JSON.stringify({
            error: "Fehler beim Erstellen der Lizenz",
            success: false,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      console.log(`🟢 New license created successfully`);
    }

    // Gerät aktivieren
    console.log(`🟢 Activating device:`, {
      deviceId: deviceId,
      deviceName: deviceName || "Unbenanntes Gerät",
    });
    const { error: deviceError } = await supabaseClient.from("devices").insert({
      license_key: licenseKey,
      device_id: deviceId,
      device_name: deviceName || "Unbenanntes Gerät",
      is_active: true,
    });

    if (deviceError) {
      console.log(`🔴 ERROR: Failed to activate device`, { deviceError });
      return new Response(
        JSON.stringify({
          error: "Fehler beim Aktivieren des Geräts",
          success: false,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(`🟢 Device activated successfully`);
    console.log(`🟢 License activation completed successfully`);

    // Erfolgreiche Antwort mit der Lizenz
    return new Response(
      JSON.stringify({
        success: true,
        licenseKey: licenseKey,
        email: customerEmail,
        purchaseDate: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.log(`🔴 ERROR: Unexpected error occurred`, {
      error: error.message,
    });
    return new Response(
      JSON.stringify({
        error: "Ein unerwarteter Fehler ist aufgetreten",
        success: false,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
