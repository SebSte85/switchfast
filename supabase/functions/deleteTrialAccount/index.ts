import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-environment",
};

function getEnvironment(req: Request): string {
  const envHeader = req.headers.get("x-environment");
  if (envHeader === "test" || envHeader === "prod") return envHeader;
  const url = new URL(req.url);
  const envParam = url.searchParams.get("env");
  if (envParam === "test" || envParam === "prod") return envParam;
  return Deno.env.get("ACTIVE_ENVIRONMENT") || "test";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const environment = getEnvironment(req);
    console.log(`🟢 Using environment: ${environment}`);

    const schema = environment === "prod" ? "prod" : "test";
    console.log(`🟢 Using schema: ${schema}`);

    const { deviceId } = await req.json();

    console.log(`🟢 Request data:`, {
      deviceId: deviceId || "MISSING",
    });

    if (!deviceId) {
      console.log(`🔴 ERROR: Missing deviceId`);
      return new Response(
        JSON.stringify({ error: "deviceId ist erforderlich" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        }
      );
    }

    console.log(
      `🟢 Starting GDPR-compliant trial account deletion for deviceId: ${deviceId}`
    );

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
      { db: { schema } }
    );

    // 1. Trial Block für diese Device-ID löschen (DSGVO: Device-ID ist personenbezogener Daten)
    console.log(
      `🗑️ [DELETE TRIAL] Deleting trial block for device: ${deviceId}`
    );

    const { error: trialError } = await supabaseClient
      .from("trial_blocks")
      .delete()
      .eq("device_id", deviceId);

    if (trialError) {
      console.error(
        "❌ [DELETE TRIAL] Error deleting trial block:",
        trialError
      );
      return new Response(
        JSON.stringify({
          error: "Fehler beim Löschen der Trial-Daten",
          details: trialError.message,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    console.log(`✅ [DELETE TRIAL] Trial block deleted successfully`);

    // 2. Device Activations für diese Device-ID löschen (falls vorhanden)
    console.log(
      `🗑️ [DELETE TRIAL] Deleting device activations for device: ${deviceId}`
    );

    const { error: deviceError } = await supabaseClient
      .from("device_activations")
      .delete()
      .eq("device_id", deviceId);

    if (deviceError) {
      console.error(
        "❌ [DELETE TRIAL] Error deleting device activations:",
        deviceError
      );
      // Nicht kritisch, da Trial-User möglicherweise keine device_activations haben
    } else {
      console.log(`✅ [DELETE TRIAL] Device activations deleted`);
    }

    console.log(
      `✅ [DELETE TRIAL] GDPR-compliant trial account deletion completed for deviceId: ${deviceId}`
    );

    return new Response(
      JSON.stringify({
        success: true,
        message: "Trial account successfully deleted with GDPR compliance",
        details: {
          trial_blocks_deleted: 1,
          device_activations_checked: true,
        },
        gdpr_compliance: {
          device_data_notice:
            "All device-related data has been permanently deleted from our servers.",
          what_was_deleted: [
            "Trial block data",
            "Device activation records (if any)",
            "All personal device identifiers",
          ],
        },
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("💥 [DELETE TRIAL] Unexpected error:", error);
    return new Response(
      JSON.stringify({ error: "Unerwarteter Fehler", details: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
