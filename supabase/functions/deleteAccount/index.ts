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
    const schema = environment === "prod" ? "prod" : "test";
    const { email } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "email ist erforderlich" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      { db: { schema } }
    );
    // Alle Devices zu den Lizenzen des Users löschen
    const { data: licenses, error: licenseError } = await supabaseClient
      .from("licenses")
      .select("id")
      .eq("email", email);
    if (licenseError) {
      return new Response(
        JSON.stringify({
          error: "Fehler beim Finden der Lizenzen",
          details: licenseError.message,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }
    if (licenses && licenses.length > 0) {
      const licenseIds = licenses.map((l: any) => l.id);
      await supabaseClient
        .from("device_activations")
        .delete()
        .in("license_id", licenseIds);
    }
    // Lizenzen anonymisieren (statt löschen)
    const { error: updateError } = await supabaseClient
      .from("licenses")
      .update({ email: null, is_active: false })
      .eq("email", email);
    if (updateError) {
      return new Response(
        JSON.stringify({
          error: "Fehler beim Anonymisieren der Lizenzdaten",
          details: updateError.message,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: "Unerwarteter Fehler", details: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
