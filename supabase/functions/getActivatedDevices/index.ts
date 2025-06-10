import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.7.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment",
};

interface RequestBody {
  licenseKey: string;
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

  // 3. Fallback auf die Standardumgebung aus den Umgebungsvariablen
  const defaultEnv = Deno.env.get("ACTIVE_ENVIRONMENT") || "test";
  return defaultEnv;
}

serve(async (req) => {
  // CORS-Präflug-Anfragen behandeln
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

    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

    console.log(`🟢 Supabase config:`, {
      hasUrl: !!supabaseUrl,
      hasServiceKey: !!supabaseKey,
      schema: schema,
    });

    const supabase = createClient(supabaseUrl, supabaseKey, {
      db: {
        schema: schema,
      },
    });

    // Request-Body parsen
    const { licenseKey } = (await req.json()) as RequestBody;

    console.log(`🟢 Request data:`, {
      hasLicenseKey: !!licenseKey,
      licenseKeyPrefix: licenseKey?.substring(0, 10) || "MISSING",
    });

    if (!licenseKey) {
      console.log(`🔴 ERROR: Missing license key`);
      return new Response(
        JSON.stringify({ success: false, message: "Lizenzschlüssel fehlt" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Lizenz in der Datenbank suchen (Schema ist bereits im Client konfiguriert)
    console.log(
      `🔍 Searching for license with key: ${licenseKey.substring(0, 10)}...`
    );
    const { data: licenseData, error: licenseError } = await supabase
      .from("licenses")
      .select("id, is_active")
      .eq("license_key", licenseKey)
      .single();

    if (licenseError || !licenseData) {
      console.log(`🔴 ERROR: License not found`, { licenseError });
      return new Response(
        JSON.stringify({ success: false, message: "Lizenz nicht gefunden" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 404,
        }
      );
    }

    console.log(`🟢 License found:`, {
      licenseId: licenseData.id,
      isActive: licenseData.is_active,
    });

    if (!licenseData.is_active) {
      console.log(`🔴 ERROR: License is not active`);
      return new Response(
        JSON.stringify({ success: false, message: "Lizenz ist nicht aktiv" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 403,
        }
      );
    }

    // Aktivierte Geräte für diese Lizenz abrufen (Schema ist bereits im Client konfiguriert)
    console.log(`🔍 Fetching devices for license: ${licenseData.id}`);
    const { data: devices, error: devicesError } = await supabase
      .from("device_activations")
      .select(
        "device_id, device_name, first_activated_at, last_check_in, is_active"
      )
      .eq("license_id", licenseData.id);

    if (devicesError) {
      console.log(`🔴 ERROR: Failed to fetch devices`, { devicesError });
      return new Response(
        JSON.stringify({
          success: false,
          message: "Fehler beim Abrufen der Geräte",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    const activeDevices = devices?.filter((device) => device.is_active) || [];

    console.log(`🟢 Devices retrieved:`, {
      totalDevices: devices?.length || 0,
      activeDevices: activeDevices.length,
      deviceIds: activeDevices.map((d) => d.device_id).slice(0, 3), // Show first 3 for debugging
    });

    console.log(`🟢 Get activated devices completed successfully`);

    return new Response(
      JSON.stringify({
        success: true,
        devices: activeDevices,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.log(`🔴 ERROR: Unexpected error occurred`, {
      error: error.message,
      stack: error.stack,
    });
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
