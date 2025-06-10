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

    const { deviceId, consentGiven } = await req.json();

    console.log(`🟢 Request data:`, {
      deviceId: deviceId || "MISSING",
      consentGiven: consentGiven,
      consentType: typeof consentGiven,
    });

    // Validierung der Eingaben
    if (!deviceId) {
      console.log(`🔴 ERROR: Missing device ID`);
      return new Response(JSON.stringify({ error: "Fehlende Geräte-ID" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    if (typeof consentGiven !== "boolean") {
      console.log(`🔴 ERROR: Invalid consent type`, {
        consentGiven: consentGiven,
        type: typeof consentGiven,
      });
      return new Response(
        JSON.stringify({ error: "Consent-Status muss ein Boolean sein" }),
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

    // Prüfen, ob bereits ein Trial-Eintrag existiert
    console.log(`🔍 Checking for existing trial data: ${deviceId}`);
    const { data: existingTrialData, error: selectError } = await supabaseClient
      .from("trial_blocks")
      .select("*")
      .eq("device_id", deviceId)
      .maybeSingle();

    if (selectError) {
      console.log(`🔴 ERROR: Failed to retrieve trial status`, { selectError });
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

    console.log(`🟢 Trial query result:`, {
      foundTrial: !!existingTrialData,
      currentConsent: existingTrialData?.privacy_consent_given,
      newConsent: consentGiven,
    });

    if (existingTrialData) {
      // Trial-Eintrag existiert, aktualisiere den Consent-Status
      console.log(`🟢 Updating existing trial consent`);
      const { error: updateError } = await supabaseClient
        .from("trial_blocks")
        .update({ privacy_consent_given: consentGiven })
        .eq("device_id", deviceId);

      if (updateError) {
        console.log(`🔴 ERROR: Failed to update consent status`, {
          updateError,
        });
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

      console.log(`🟢 Privacy consent updated successfully`);
      console.log(`🟢 Update privacy consent completed successfully`);

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
      console.log(`🟢 Creating new trial entry with consent`);
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
        console.log(`🔴 ERROR: Failed to create trial entry`, { insertError });
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

      console.log(`🟢 New trial entry created successfully:`, {
        trialStartDate: newTrialData?.trial_start_date,
        trialEndDate: newTrialData?.trial_end_date,
        consentGiven: consentGiven,
      });

      console.log(
        `🟢 Create trial with privacy consent completed successfully`
      );

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
