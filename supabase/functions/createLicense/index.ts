import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { generateRandomString } from "../_shared/licenseUtils.ts";

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

    // Schema basierend auf der Umgebung auswählen
    const schema = environment === "prod" ? "prod" : "test";
    console.log(`🟢 Using schema: ${schema}`);

    const { email, stripeCustomerId, stripePaymentId, deviceId, deviceName } =
      await req.json();

    console.log(`🟢 Request data:`, {
      email: email || "MISSING",
      hasStripeCustomerId: !!stripeCustomerId,
      stripeCustomerIdPrefix: stripeCustomerId?.substring(0, 20) || "MISSING",
      hasStripePaymentId: !!stripePaymentId,
      stripePaymentIdPrefix: stripePaymentId?.substring(0, 20) || "MISSING",
      deviceId: deviceId || "MISSING",
      deviceName: deviceName || "NOT_PROVIDED",
    });

    // Validierung der Eingaben
    if (!email || !stripeCustomerId || !stripePaymentId || !deviceId) {
      console.log(`🔴 ERROR: Missing required fields`, {
        hasEmail: !!email,
        hasStripeCustomerId: !!stripeCustomerId,
        hasStripePaymentId: !!stripePaymentId,
        hasDeviceId: !!deviceId,
      });
      return new Response(
        JSON.stringify({ error: "Fehlende erforderliche Felder" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

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

    // Eindeutigen Lizenzschlüssel generieren (Format: SF-XXXX-XXXX-XXXX)
    const licenseKey = `SF-${generateRandomString(4)}-${generateRandomString(
      4
    )}-${generateRandomString(4)}`;
    console.log(`🟢 Generated license key: ${licenseKey}`);

    // Neue Lizenz in der Datenbank erstellen (Schema ist bereits im Client konfiguriert)
    console.log(`🟢 Creating new license in database`);
    const { data: licenseData, error: licenseError } = await supabaseClient
      .from("licenses")
      .insert({
        license_key: licenseKey,
        email: email,
        stripe_customer_id: stripeCustomerId,
        stripe_payment_id: stripePaymentId,
        is_active: true,
      })
      .select()
      .single();

    if (licenseError) {
      console.log(`🔴 ERROR: Failed to create license`, { licenseError });
      return new Response(
        JSON.stringify({ error: "Fehler beim Erstellen der Lizenz" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(`🟢 License created successfully:`, {
      licenseId: licenseData.id,
      licenseKey: licenseKey,
      email: email,
    });

    // Gerät aktivieren (Schema ist bereits im Client konfiguriert)
    console.log(`🟢 Activating device:`, {
      licenseId: licenseData.id,
      deviceId: deviceId,
      deviceName: deviceName || "Unbenanntes Gerät",
    });

    const { error: deviceError } = await supabaseClient
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
      console.log(`🔴 ERROR: Failed to activate device`, { deviceError });
      return new Response(
        JSON.stringify({ error: "Fehler beim Aktivieren des Geräts" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(`🟢 Device activated successfully`);
    console.log(
      `🟢 License creation and device activation completed successfully`
    );

    // Erfolgreiche Antwort
    return new Response(
      JSON.stringify({
        success: true,
        license_key: licenseKey,
        message: "Lizenz erfolgreich erstellt und Gerät aktiviert",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.log(`🔴 ERROR: Unexpected error occurred`, {
      error: error.message,
      stack: error.stack,
    });
    return new Response(
      JSON.stringify({ error: "Ein unerwarteter Fehler ist aufgetreten" }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
