import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-environment',
};

// Funktion zum Ermitteln der aktiven Umgebung
function getEnvironment(req: Request): string {
  // 1. Prüfen des x-environment Headers
  const envHeader = req.headers.get('x-environment');
  if (envHeader === 'test' || envHeader === 'prod') {
    return envHeader;
  }
  
  // 2. Prüfen des env Query-Parameters
  const url = new URL(req.url);
  const envParam = url.searchParams.get('env');
  if (envParam === 'test' || envParam === 'prod') {
    return envParam;
  }
  
  // 3. Fallback auf die Standardumgebung aus den Umgebungsvariablen
  const defaultEnv = Deno.env.get('ACTIVE_ENVIRONMENT') || 'test';
  return defaultEnv;
}

serve(async (req) => {
  // CORS-Preflight-Anfragen behandeln
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Umgebung bestimmen
    const environment = getEnvironment(req);
    console.log(`Verwende Umgebung: ${environment}`);
    
    // Schema basierend auf der Umgebung auswählen
    const schema = environment === 'prod' ? 'prod' : 'test';
    
    const { licenseKey, deviceId } = await req.json();

    // Validierung der Eingaben
    if (!licenseKey || !deviceId) {
      return new Response(
        JSON.stringify({ error: 'Fehlende erforderliche Felder' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Supabase-Client initialisieren
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Lizenz in der Datenbank suchen (mit Schema)
    const { data: licenseData, error: licenseError } = await supabaseClient
      .from(`${schema}.licenses`)
      .select('id, is_active')
      .eq('license_key', licenseKey)
      .single();

    if (licenseError || !licenseData) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Ungültiger Lizenzschlüssel',
          is_license_valid: false,
          is_device_activated: false
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    if (!licenseData.is_active) {
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: 'Diese Lizenz ist nicht aktiv',
          is_license_valid: false,
          is_device_activated: false
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }

    // Gerät in der Datenbank suchen
    const { data: deviceData, error: deviceError } = await supabaseClient
      .from(`${schema}.device_activations`)
      .select('id, is_active')
      .eq('license_id', licenseData.id)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (deviceError) {
      return new Response(
        JSON.stringify({ error: 'Fehler beim Prüfen des Geräts' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Wenn das Gerät gefunden wurde und aktiv ist, aktualisieren wir den last_check_in-Zeitstempel
    if (deviceData && deviceData.is_active) {
      const { error: updateError } = await supabaseClient
        .from(`${schema}.device_activations`)
        .update({
          last_check_in: new Date().toISOString()
        })
        .eq('id', deviceData.id);

      if (updateError) {
        console.error('Fehler beim Aktualisieren des last_check_in-Zeitstempels:', updateError);
        // Wir geben trotzdem eine erfolgreiche Antwort zurück, da die Lizenz gültig ist
      }

      // Anzahl der aktiven Geräte für diese Lizenz abrufen
      const { data: activeDevices, error: countError } = await supabaseClient
        .from(`${schema}.device_activations`)
        .select('id')
        .eq('license_id', licenseData.id)
        .eq('is_active', true);

      if (countError) {
        console.error('Fehler beim Zählen der aktiven Geräte:', countError);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Lizenz und Gerät sind gültig',
          is_license_valid: true,
          is_device_activated: true,
          active_devices_count: activeDevices ? activeDevices.length : 1
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    } else {
      // Das Gerät ist nicht aktiviert oder nicht aktiv
      return new Response(
        JSON.stringify({
          success: false,
          message: deviceData ? 'Gerät ist deaktiviert' : 'Gerät ist nicht aktiviert',
          is_license_valid: true,
          is_device_activated: false
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
      );
    }
  } catch (error) {
    console.error('Unerwarteter Fehler:', error);
    return new Response(
      JSON.stringify({ error: 'Ein unerwarteter Fehler ist aufgetreten' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
