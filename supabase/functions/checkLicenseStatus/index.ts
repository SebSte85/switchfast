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
    console.log(`🟢 Using environment: ${environment}`);

    // Schema basierend auf der Umgebung auswählen
    const schema = environment === "prod" ? "prod" : "test";
    console.log(`🟢 Using schema: ${schema}`);

    const { deviceId } = await req.json();
    console.log(`🟢 Request data:`, {
      deviceId: deviceId || "MISSING",
    });

    // Validierung der Eingaben
    if (!deviceId) {
      console.log(`🔴 ERROR: Missing device ID`);
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

    // Geräteaktivierung in der Datenbank suchen (Schema ist bereits im Client konfiguriert)
    console.log(`🔍 Searching for device activation: ${deviceId}`);
    const { data: deviceDataArray, error: deviceError } = await supabaseClient
      .from("device_activations")
      .select("id, license_id, is_active")
      .eq("device_id", deviceId);

    const deviceData =
      deviceDataArray && deviceDataArray.length > 0 ? deviceDataArray[0] : null;

    if (deviceError) {
      console.log(`🔴 ERROR: Failed to check device`, { deviceError });
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

    console.log(`🟢 Device query result:`, {
      foundDevice: !!deviceData,
      deviceId: deviceData?.id,
      licenseId: deviceData?.license_id,
      isActive: deviceData?.is_active,
    });

    // Wenn keine Geräteaktivierung gefunden wurde, prüfe trotzdem auf gecancelte Subscriptions
    if (!deviceData) {
      // Prüfe, ob es eine Lizenz mit gecancelten Subscription-Daten für dieses Gerät gibt
      // (über device_activations mit is_active=false)
      console.log(
        `🔍 Searching for inactive devices for deviceId: ${deviceId}`
      );
      const { data: inactiveDeviceData, error: inactiveDeviceError } =
        await supabaseClient
          .from("device_activations")
          .select("id, license_id")
          .eq("device_id", deviceId)
          .eq("is_active", false)
          .limit(1);

      console.log(`🟡 Inactive device data:`, {
        found: !!inactiveDeviceData?.length,
        count: inactiveDeviceData?.length || 0,
      });

      if (inactiveDeviceError) {
        console.log(`🔴 ERROR: Failed to check inactive devices`, {
          inactiveDeviceError,
        });
      }

      const latestInactiveDevice =
        inactiveDeviceData && inactiveDeviceData.length > 0
          ? inactiveDeviceData[0]
          : null;

      if (latestInactiveDevice) {
        console.log(
          `🔍 Found inactive device, checking license: ${latestInactiveDevice.license_id}`
        );
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
          console.log(`🟡 Found canceled subscription for inactive device:`, {
            cancelledAt: licenseData.cancelled_at,
            cancelsAtPeriodEnd: licenseData.cancels_at_period_end,
            email: licenseData.email,
          });
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

      console.log(`🔴 No device activation found for device: ${deviceId}`);
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
    console.log(
      `🔍 Fetching license data for license ID: ${deviceData.license_id}`
    );
    const { data: licenseData, error: licenseError } = await supabaseClient
      .from("licenses")
      .select(
        "id, is_active, license_key, subscription_end_date, stripe_subscription_id, email, cancelled_at, cancels_at_period_end"
      )
      .eq("id", deviceData.license_id)
      .single();

    if (licenseError || !licenseData) {
      console.log(`🔴 ERROR: License not found`, {
        licenseId: deviceData.license_id,
        licenseError,
      });
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

    console.log(`🟢 License data retrieved:`, {
      licenseId: licenseData.id,
      isActive: licenseData.is_active,
      email: licenseData.email,
      hasSubscription: !!licenseData.stripe_subscription_id,
      cancelledAt: licenseData.cancelled_at,
      cancelsAtPeriodEnd: licenseData.cancels_at_period_end,
    });

    // Auch für inaktive Lizenzen die Subscription-Informationen zurückgeben
    // (z.B. für gekündigte Subscriptions mit cancelled_at)
    const is_license_active = licenseData.is_active;
    const is_device_active = deviceData.is_active;

    console.log(`🟢 Status check:`, {
      isLicenseActive: is_license_active,
      isDeviceActive: is_device_active,
    });

    // Aktualisiere den last_check_in-Zeitstempel nur für aktive Geräte
    if (deviceData && is_device_active) {
      console.log(`🟢 Updating last check-in for active device`);
      const { error: updateError } = await supabaseClient
        .from("device_activations")
        .update({
          last_check_in: new Date().toISOString(),
        })
        .eq("id", deviceData.id);

      if (updateError) {
        console.log(`🔴 ERROR: Failed to update last check-in`, {
          updateError,
        });
      } else {
        console.log(`🟢 Last check-in updated successfully`);
      }
    }

    // Anzahl der aktiven Geräte für diese Lizenz abrufen
    console.log(`🔍 Counting active devices for license: ${licenseData.id}`);
    const { data: activeDevices, error: countError } = await supabaseClient
      .from("device_activations")
      .select("id")
      .eq("license_id", licenseData.id)
      .eq("is_active", true);

    if (countError) {
      console.log(`🔴 ERROR: Failed to count active devices`, { countError });
    }

    console.log(`🟢 Active devices count: ${activeDevices?.length || 0}`);

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

    console.log(`🟢 Final status: ${message}`);
    console.log(`🟢 License status check completed successfully`);

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
