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
      return new Response(JSON.stringify({ error: "Fehlende Geräte-ID" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
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

    // Trial-Status in der Datenbank suchen (Schema ist bereits im Client konfiguriert)
    const { data: trialData, error: trialError } = await supabaseClient
      .from("trial_blocks")
      .select("*")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (trialError) {
      console.error("Trial-Fehler:", JSON.stringify(trialError));
      return new Response(
        JSON.stringify({
          error: "Fehler beim Abrufen des Trial-Status",
          details: trialError.message,
          code: trialError.code,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    // Wenn kein Trial-Eintrag gefunden wurde, erstellen wir einen neuen
    if (!trialData) {
      const trialStartDate = new Date();
      const trialEndDate = new Date(trialStartDate);
      trialEndDate.setDate(trialEndDate.getDate() + 7); // 7 Tage Trial

      const { data: newTrialData, error: insertError } = await supabaseClient
        .from("trial_blocks")
        .insert({
          device_id: deviceId,
          trial_start_date: trialStartDate.toISOString(),
          trial_end_date: trialEndDate.toISOString(),
          is_trial_used: false,
          privacy_consent_given: false,
        })
        .select("*")
        .maybeSingle();

      if (insertError) {
        console.error("Insert-Fehler:", JSON.stringify(insertError));
        return new Response(
          JSON.stringify({
            error: "Fehler beim Erstellen des Trial-Status",
            details: insertError.message,
            code: insertError.code,
          }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 500,
          }
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          is_trial_active: true,
          trial_start_date: newTrialData.trial_start_date,
          trial_end_date: newTrialData.trial_end_date,
          remaining_days: 7,
          privacy_consent_given: newTrialData.privacy_consent_given,
          message: "Trial gestartet",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prüfen, ob der Trial bereits verwendet wurde
    if (trialData.is_trial_used) {
      return new Response(
        JSON.stringify({
          success: true,
          is_trial_active: false,
          trial_start_date: trialData.trial_start_date,
          trial_end_date: trialData.trial_end_date,
          remaining_days: 0,
          privacy_consent_given: trialData.privacy_consent_given,
          message: "Trial wurde bereits verwendet",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Prüfen, ob der Trial abgelaufen ist
    const now = new Date();
    const trialEndDate = new Date(trialData.trial_end_date);

    if (now > trialEndDate) {
      // Trial ist abgelaufen, als verwendet markieren (Schema ist bereits im Client konfiguriert)
      const { error: updateError } = await supabaseClient
        .from("trial_blocks")
        .update({ is_trial_used: true })
        .eq("device_id", deviceId);

      if (updateError) {
        console.error(
          "Fehler beim Aktualisieren des Trial-Status:",
          updateError
        );
      }

      return new Response(
        JSON.stringify({
          success: true,
          is_trial_active: false,
          trial_start_date: trialData.trial_start_date,
          trial_end_date: trialData.trial_end_date,
          remaining_days: 0,
          privacy_consent_given: trialData.privacy_consent_given,
          message: "Trial ist abgelaufen",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Trial ist aktiv, verbleibende Tage berechnen
    const remainingDays = Math.ceil(
      (trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    return new Response(
      JSON.stringify({
        success: true,
        is_trial_active: true,
        trial_start_date: trialData.trial_start_date,
        trial_end_date: trialData.trial_end_date,
        remaining_days: remainingDays,
        privacy_consent_given: trialData.privacy_consent_given,
        message: "Trial ist aktiv",
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
