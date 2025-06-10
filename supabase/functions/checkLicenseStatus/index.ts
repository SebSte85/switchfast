import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
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

    const { deviceId } = await req.json();

    // Validierung der Eingaben
    if (!deviceId) {
      return new Response(
        JSON.stringify({ error: "Fehlende erforderliche Felder" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Supabase-Client initialisieren mit korrekter Schema-Konfiguration
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        db: {
          schema: schema,
        },
      }
    );

    // Geräteaktivierung in der Datenbank suchen (Schema ist bereits im Client konfiguriert)
    const { data: deviceDataArray, error: deviceError } = await supabaseClient
      .from("device_activations")
      .select("id, license_id, is_active")
      .eq("device_id", deviceId);

    const deviceData =
      deviceDataArray && deviceDataArray.length > 0 ? deviceDataArray[0] : null;

    if (deviceError) {
      console.error("Device Error:", deviceError);
      return new Response(
        JSON.stringify({
          success: false,
          message: "Fehler beim Prüfen des Geräts",
          is_license_valid: false,
          is_device_activated: false,
          error_details: deviceError,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Wenn keine Geräteaktivierung gefunden wurde, prüfe trotzdem auf gecancelte Subscriptions
    if (!deviceData) {
      // Prüfe, ob es eine Lizenz mit gecancelten Subscription-Daten für dieses Gerät gibt
      // (über device_activations mit is_active=false)
      console.log(
        `🔍 [checkLicenseStatus] Suche nach inaktiven Devices für deviceId: ${deviceId}`
      );
      const { data: inactiveDeviceData, error: inactiveDeviceError } =
        await supabaseClient
          .from("device_activations")
          .select("id, license_id")
          .eq("device_id", deviceId)
          .eq("is_active", false)
          .limit(1);

      console.log(
        `🔍 [checkLicenseStatus] Inaktive Device-Daten:`,
        inactiveDeviceData
      );
      console.log(
        `🔍 [checkLicenseStatus] Inaktive Device Error:`,
        inactiveDeviceError
      );

      const latestInactiveDevice =
        inactiveDeviceData && inactiveDeviceData.length > 0
          ? inactiveDeviceData[0]
          : null;

      if (latestInactiveDevice) {
        // Lizenz-Daten für die inaktive Geräteaktivierung abrufen
        const { data: licenseData, error: licenseError } = await supabaseClient
          .from("licenses")
          .select(
            "id, is_active, license_key, subscription_end_date, stripe_subscription_id, email, cancelled_at, cancels_at_period_end"
          )
          .eq("id", latestInactiveDevice.license_id)
          .single();

        // Wenn Subscription gecancelt wurde, Daten zurückgeben
        if (
          !licenseError &&
          licenseData &&
          (licenseData.cancelled_at || licenseData.cancels_at_period_end)
        ) {
          console.log(
            "Gecancelte Subscription für inaktives Gerät gefunden:",
            licenseData.cancelled_at
          );
          return new Response(
            JSON.stringify({
              success: true,
              message:
                "Gerät nicht aktiviert, aber gecancelte Subscription gefunden",
              is_license_valid: false,
              is_device_activated: false,
              license_key: licenseData.license_key,
              subscription_end_date: licenseData.subscription_end_date,
              is_subscription: !!licenseData.stripe_subscription_id,
              stripe_subscription_id: licenseData.stripe_subscription_id,
              email: licenseData.email,
              cancelled_at: licenseData.cancelled_at,
              cancels_at_period_end: licenseData.cancels_at_period_end,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 200,
            }
          );
        }
      }

      return new Response(
        JSON.stringify({
          success: false,
          message: "Gerät nicht aktiviert",
          is_license_valid: false,
          is_device_activated: false,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Lizenz in der Datenbank suchen mit Subscription-Daten (auch für deaktivierte Geräte)
    const { data: licenseData, error: licenseError } = await supabaseClient
      .from("licenses")
      .select(
        "id, is_active, license_key, subscription_end_date, stripe_subscription_id, email, cancelled_at, cancels_at_period_end"
      )
      .eq("id", deviceData.license_id)
      .single();

    if (licenseError || !licenseData) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Zugehörige Lizenz nicht gefunden",
          is_license_valid: false,
          is_device_activated: true,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        }
      );
    }

    // Auch für inaktive Lizenzen die Subscription-Informationen zurückgeben
    // (z.B. für gekündigte Subscriptions mit cancelled_at)
    const is_license_active = licenseData.is_active;
    const is_device_active = deviceData.is_active;

    // Aktualisiere den last_check_in-Zeitstempel nur für aktive Geräte
    if (deviceData && is_device_active) {
      const { error: updateError } = await supabaseClient
        .from("device_activations")
        .update({
          last_check_in: new Date().toISOString(),
        })
        .eq("id", deviceData.id);

      if (updateError) {
        console.error(
          "Fehler beim Aktualisieren des last_check_in-Zeitstempels:",
          updateError
        );
      }
    }

    // Anzahl der aktiven Geräte für diese Lizenz abrufen
    const { data: activeDevices, error: countError } = await supabaseClient
      .from("device_activations")
      .select("id")
      .eq("license_id", licenseData.id)
      .eq("is_active", true);

    if (countError) {
      console.error("Fehler beim Zählen der aktiven Geräte:", countError);
    }

    // Status-Nachricht basierend auf Lizenz- und Gerätestatus
    let message = "Lizenz gefunden";

    if (!is_license_active && !is_device_active) {
      message = "Lizenz und Gerät sind deaktiviert";
    } else if (!is_license_active) {
      message = "Lizenz ist deaktiviert";
    } else if (!is_device_active) {
      message = "Gerät ist deaktiviert";
    } else {
      message = "Lizenz und Gerät sind aktiv";
    }

    // Immer success: true wenn eine Lizenz existiert (auch gekündigte Lizenzen)
    // Die App kann dann basierend auf is_license_valid und cancelled_at entscheiden
    return new Response(
      JSON.stringify({
        success: true,
        message: message,
        is_license_valid: is_license_active,
        is_device_activated: is_device_active,
        active_devices_count: activeDevices ? activeDevices.length : 0,
        license_key: licenseData.license_key,
        subscription_end_date: licenseData.subscription_end_date,
        is_subscription: !!licenseData.stripe_subscription_id,
        stripe_subscription_id: licenseData.stripe_subscription_id,
        email: licenseData.email,
        cancelled_at: licenseData.cancelled_at,
        cancels_at_period_end: licenseData.cancels_at_period_end,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
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
