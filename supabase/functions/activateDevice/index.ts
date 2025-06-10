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

    const { licenseKey, deviceId, deviceName } = await req.json();
    console.log(`🟢 Request data:`, {
      hasLicenseKey: !!licenseKey,
      licenseKeyPrefix: licenseKey?.substring(0, 10) || "MISSING",
      deviceId: deviceId || "MISSING",
      deviceName: deviceName || "NOT_PROVIDED",
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
      .select("id, is_active")
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
      isActive: licenseData.is_active,
    });

    if (!licenseData.is_active) {
      console.log(`🔴 ERROR: License is not active`);
      return new Response(
        JSON.stringify({ error: "Diese Lizenz ist nicht aktiv" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    // Anzahl der aktiven Geräte für diese Lizenz prüfen (Schema ist bereits im Client konfiguriert)
    console.log(`🔍 Checking active devices for license: ${licenseData.id}`);
    const { data: activeDevices, error: countError } = await supabaseClient
      .from("device_activations")
      .select("id")
      .eq("license_id", licenseData.id)
      .eq("is_active", true);

    if (countError) {
      console.log(`🔴 ERROR: Failed to check active devices`, { countError });
      return new Response(
        JSON.stringify({ error: "Fehler beim Prüfen der aktiven Geräte" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(`🟢 Active devices count: ${activeDevices?.length || 0}`);

    // Prüfen, ob das Gerät bereits aktiviert ist (Schema ist bereits im Client konfiguriert)
    console.log(`🔍 Checking if device already exists: ${deviceId}`);
    const { data: existingDevice, error: deviceCheckError } =
      await supabaseClient
        .from("device_activations")
        .select("id, is_active")
        .eq("license_id", licenseData.id)
        .eq("device_id", deviceId)
        .maybeSingle();

    if (deviceCheckError) {
      console.log(`🔴 ERROR: Failed to check existing device`, {
        deviceCheckError,
      });
      return new Response(
        JSON.stringify({ error: "Fehler beim Prüfen des Geräts" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Wenn das Gerät bereits aktiviert ist, aktualisieren wir nur den Zeitstempel
    if (existingDevice) {
      console.log(`🟡 Device already exists:`, {
        deviceId: existingDevice.id,
        isActive: existingDevice.is_active,
      });

      if (existingDevice.is_active) {
        console.log(`🟢 Updating existing active device check-in`);
        const { error: updateError } = await supabaseClient
          .from("device_activations")
          .update({
            last_check_in: new Date().toISOString(),
            device_name: deviceName || "Unbenanntes Gerät",
          })
          .eq("id", existingDevice.id);

        if (updateError) {
          console.log(`🔴 ERROR: Failed to update device`, { updateError });
          return new Response(
            JSON.stringify({ error: "Fehler beim Aktualisieren des Geräts" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }

        console.log(`🟢 Device updated successfully`);
        return new Response(
          JSON.stringify({
            success: true,
            message: "Gerät bereits aktiviert",
            active_devices_count: activeDevices.length,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } else {
        // Wenn das Gerät deaktiviert war, reaktivieren wir es
        if (activeDevices.length >= 3) {
          console.log(`🔴 ERROR: Maximum device limit reached`, {
            activeDevicesCount: activeDevices.length,
            maxDevices: 3,
          });
          return new Response(
            JSON.stringify({
              error: "Maximale Anzahl an Geräten erreicht",
              active_devices_count: activeDevices.length,
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 400,
            }
          );
        }

        console.log(`🟡 Reactivating inactive device`);
        const { error: reactivateError } = await supabaseClient
          .from("device_activations")
          .update({
            is_active: true,
            last_check_in: new Date().toISOString(),
            device_name:
              deviceName || existingDevice.device_name || "Unbenanntes Gerät",
          })
          .eq("id", existingDevice.id);

        if (reactivateError) {
          console.log(`🔴 ERROR: Failed to reactivate device`, {
            reactivateError,
          });
          return new Response(
            JSON.stringify({ error: "Fehler beim Reaktivieren des Geräts" }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 500,
            }
          );
        }
        console.log(`🟢 Device reactivated successfully`);
      }
    } else {
      // Neues Gerät aktivieren, wenn das Limit nicht erreicht ist
      if (activeDevices.length >= 3) {
        console.log(`🔴 ERROR: Maximum device limit reached for new device`, {
          activeDevicesCount: activeDevices.length,
          maxDevices: 3,
        });
        return new Response(
          JSON.stringify({
            error: "Maximale Anzahl an Geräten erreicht",
            active_devices_count: activeDevices.length,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
          }
        );
      }

      // Neues Gerät hinzufügen (Schema ist bereits im Client konfiguriert)
      console.log(`🟢 Adding new device activation`);
      const { error: activationError } = await supabaseClient
        .from("device_activations")
        .insert({
          license_id: licenseData.id,
          device_id: deviceId,
          device_name: deviceName || "Unbenanntes Gerät",
          first_activated_at: new Date().toISOString(),
          last_check_in: new Date().toISOString(),
          is_active: true,
        });

      if (activationError) {
        console.log(`🔴 ERROR: Failed to activate new device`, {
          activationError,
        });
        return new Response(
          JSON.stringify({ error: "Fehler beim Aktivieren des Geräts" }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }
      console.log(`🟢 New device activated successfully`);
    }

    // Erfolgreiche Antwort
    console.log(`🟢 Device activation completed successfully`);
    return new Response(
      JSON.stringify({
        success: true,
        message: "Gerät erfolgreich aktiviert",
        active_devices_count: activeDevices.length + 1,
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
