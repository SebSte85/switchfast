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

    const { licenseKey, deviceId } = await req.json();
    console.log(`🟢 Request data:`, {
      hasLicenseKey: !!licenseKey,
      licenseKeyPrefix: licenseKey?.substring(0, 10) || "MISSING",
      deviceId: deviceId || "MISSING",
    });

    // Validierung der Eingaben
    if (!licenseKey || !deviceId) {
      console.log(`🔴 ERROR: Missing required fields`, {
        hasLicenseKey: !!licenseKey,
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

    // Lizenz in der Datenbank suchen (Schema ist bereits im Client konfiguriert)
    console.log(
      `🔍 Searching for license with key: ${licenseKey.substring(0, 10)}...`
    );
    const { data: licenseData, error: licenseError } = await supabaseClient
      .from("licenses")
      .select("id")
      .eq("license_key", licenseKey)
      .single();

    if (licenseError || !licenseData) {
      console.log(`🔴 ERROR: Invalid license key`, { licenseError });
      return new Response(
        JSON.stringify({ error: "Ungültiger Lizenzschlüssel" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    console.log(`🟢 License found:`, {
      licenseId: licenseData.id,
    });

    // Gerät in der Datenbank suchen und deaktivieren (Schema ist bereits im Client konfiguriert)
    console.log(`🔍 Searching for device: ${deviceId}`);
    const { data: deviceData, error: deviceError } = await supabaseClient
      .from("device_activations")
      .select("id, is_active")
      .eq("license_id", licenseData.id)
      .eq("device_id", deviceId)
      .maybeSingle();

    if (deviceError) {
      console.log(`🔴 ERROR: Failed to search device`, { deviceError });
      return new Response(
        JSON.stringify({ error: "Fehler beim Suchen des Geräts" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    if (!deviceData) {
      console.log(`🔴 ERROR: Device not found`, {
        deviceId: deviceId,
        licenseId: licenseData.id,
      });
      return new Response(JSON.stringify({ error: "Gerät nicht gefunden" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    console.log(`🟢 Device found:`, {
      deviceActivationId: deviceData.id,
      isActive: deviceData.is_active,
    });

    if (!deviceData.is_active) {
      console.log(`🟡 Device already deactivated`);
      return new Response(
        JSON.stringify({ message: "Gerät ist bereits deaktiviert" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Gerät deaktivieren (Schema ist bereits im Client konfiguriert)
    console.log(`🟢 Deactivating device`);
    const { error: updateError } = await supabaseClient
      .from("device_activations")
      .update({
        is_active: false,
        last_check_in: new Date().toISOString(),
      })
      .eq("id", deviceData.id);

    if (updateError) {
      console.log(`🔴 ERROR: Failed to deactivate device`, { updateError });
      return new Response(
        JSON.stringify({ error: "Fehler beim Deaktivieren des Geräts" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(`🟢 Device deactivated successfully`);

    // Anzahl der verbleibenden aktiven Geräte für diese Lizenz abrufen
    console.log(
      `🔍 Counting remaining active devices for license: ${licenseData.id}`
    );
    const { data: activeDevices, error: countError } = await supabaseClient
      .from("device_activations")
      .select("id")
      .eq("license_id", licenseData.id)
      .eq("is_active", true);

    if (countError) {
      console.log(`🔴 ERROR: Failed to count active devices`, { countError });
    }

    console.log(`🟢 Remaining active devices: ${activeDevices?.length || 0}`);
    console.log(`🟢 Device deactivation completed successfully`);

    // Erfolgreiche Antwort
    return new Response(
      JSON.stringify({
        success: true,
        message: "Gerät erfolgreich deaktiviert",
        remaining_active_devices: activeDevices ? activeDevices.length : 0,
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
