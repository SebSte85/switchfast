import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.7.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-environment',
};

interface RequestBody {
  licenseKey: string;
}

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
  // CORS-Präflug-Anfragen behandeln
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Umgebung bestimmen
    const environment = getEnvironment(req);
    console.log(`Verwende Umgebung: ${environment}`);
    
    // Schema basierend auf der Umgebung auswählen
    const schema = environment === 'prod' ? 'prod' : 'test';
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Request-Body parsen
    const { licenseKey } = await req.json() as RequestBody;

    if (!licenseKey) {
      return new Response(
        JSON.stringify({ success: false, message: 'Lizenzschlüssel fehlt' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Lizenz in der Datenbank suchen (mit Schema)
    const { data: licenseData, error: licenseError } = await supabase
      .from(`${schema}.licenses`)
      .select('id, is_active')
      .eq('license_key', licenseKey)
      .single();

    if (licenseError || !licenseData) {
      return new Response(
        JSON.stringify({ success: false, message: 'Lizenz nicht gefunden' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
      );
    }

    if (!licenseData.is_active) {
      return new Response(
        JSON.stringify({ success: false, message: 'Lizenz ist nicht aktiv' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 403 }
      );
    }

    // Aktivierte Geräte für diese Lizenz abrufen (mit Schema)
    const { data: devices, error: devicesError } = await supabase
      .from(`${schema}.device_activations`)
      .select('device_id, device_name, first_activated_at, last_check_in, is_active')
      .eq('license_id', licenseData.id);

    if (devicesError) {
      return new Response(
        JSON.stringify({ success: false, message: 'Fehler beim Abrufen der Geräte' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        devices: devices.filter(device => device.is_active) 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, message: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
