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

    // Supabase-Client initialisieren mit korrekter Schema-Konfiguration
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      {
        db: {
          schema: schema
        }
      }
    );

    // Lizenz in der Datenbank suchen (Schema ist bereits im Client konfiguriert)
    const { data: licenseData, error: licenseError } = await supabaseClient
      .from('licenses')
      .select('id')
      .eq('license_key', licenseKey)
      .single();

    if (licenseError || !licenseData) {
      return new Response(
        JSON.stringify({ error: 'Ungültiger Lizenzschlüssel' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Gerät in der Datenbank suchen und deaktivieren (Schema ist bereits im Client konfiguriert)
    const { data: deviceData, error: deviceError } = await supabaseClient
      .from('device_activations')
      .select('id, is_active')
      .eq('license_id', licenseData.id)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (deviceError) {
      return new Response(
        JSON.stringify({ error: 'Fehler beim Suchen des Geräts' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    if (!deviceData) {
      return new Response(
        JSON.stringify({ error: 'Gerät nicht gefunden' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    if (!deviceData.is_active) {
      return new Response(
        JSON.stringify({ message: 'Gerät ist bereits deaktiviert' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Gerät deaktivieren (Schema ist bereits im Client konfiguriert)
    const { error: updateError } = await supabaseClient
      .from('device_activations')
      .update({
        is_active: false,
        last_check_in: new Date().toISOString()
      })
      .eq('id', deviceData.id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: 'Fehler beim Deaktivieren des Geräts' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Anzahl der verbleibenden aktiven Geräte für diese Lizenz abrufen (mit Schema)
    const { data: activeDevices, error: countError } = await supabaseClient
      .from(`${schema}.device_activations`)
      .select('id')
      .eq('license_id', licenseData.id)
      .eq('is_active', true);

    if (countError) {
      console.error('Fehler beim Zählen der aktiven Geräte:', countError);
    }

    // Erfolgreiche Antwort
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Gerät erfolgreich deaktiviert',
        remaining_active_devices: activeDevices ? activeDevices.length : 0
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unerwarteter Fehler:', error);
    return new Response(
      JSON.stringify({ error: 'Ein unerwarteter Fehler ist aufgetreten' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
