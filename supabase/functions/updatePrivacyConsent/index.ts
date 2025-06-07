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

    const { deviceId, consentGiven } = await req.json();

    // Validierung der Eingaben
    if (!deviceId) {
      return new Response(JSON.stringify({ error: "Fehlende Geräte-ID" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    if (typeof consentGiven !== "boolean") {
      return new Response(
        JSON.stringify({ error: "Consent-Status muss ein Boolean sein" }),
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

    // Prüfen, ob bereits ein Trial-Eintrag existiert
    const { data: existingTrialData, error: selectError } = await supabaseClient
      .from("trial_blocks")
      .select("*")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (selectError) {
      console.error(
        "Fehler beim Abrufen des Trial-Status:",
        JSON.stringify(selectError)
      );
      return new Response(
        JSON.stringify({
          error: "Fehler beim Abrufen des Trial-Status",
          details: selectError.message,
          code: selectError.code,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        }
      );
    }

    if (existingTrialData) {
      // Trial-Eintrag existiert, aktualisiere den Consent-Status
      const { error: updateError } = await supabaseClient
        .from("trial_blocks")
        .update({ privacy_consent_given: consentGiven })
        .eq("device_id", deviceId);

      if (updateError) {
        console.error(
          "Fehler beim Aktualisieren des Consent-Status:",
          JSON.stringify(updateError)
        );
        return new Response(
          JSON.stringify({
            error: "Fehler beim Aktualisieren des Consent-Status",
            details: updateError.message,
            code: updateError.code,
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
          message: "Privacy Consent erfolgreich aktualisiert",
          consentGiven: consentGiven,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      // Noch kein Trial-Eintrag vorhanden, erstelle einen neuen
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
          privacy_consent_given: consentGiven,
        })
        .select("*")
        .maybeSingle();

      if (insertError) {
        console.error(
          "Fehler beim Erstellen des Trial-Eintrags:",
          JSON.stringify(insertError)
        );
        return new Response(
          JSON.stringify({
            error: "Fehler beim Erstellen des Trial-Eintrags",
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
          message: "Trial-Eintrag erstellt und Privacy Consent gesetzt",
          consentGiven: consentGiven,
          trialCreated: true,
          trialData: newTrialData,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
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
