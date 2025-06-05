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
    
    const { licenseKey, deviceId, deviceName } = await req.json();

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
        JSON.stringify({ error: 'Ungültiger Lizenzschlüssel' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    if (!licenseData.is_active) {
      return new Response(
        JSON.stringify({ error: 'Diese Lizenz ist nicht aktiv' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Anzahl der aktiven Geräte für diese Lizenz prüfen
    const { data: activeDevices, error: countError } = await supabaseClient
      .from(`${schema}.device_activations`)
      .select('id')
      .eq('license_id', licenseData.id)
      .eq('is_active', true);

    if (countError) {
      return new Response(
        JSON.stringify({ error: 'Fehler beim Prüfen der aktiven Geräte' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Prüfen, ob das Gerät bereits aktiviert ist
    const { data: existingDevice, error: deviceCheckError } = await supabaseClient
      .from(`${schema}.device_activations`)
      .select('id, is_active')
      .eq('license_id', licenseData.id)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (deviceCheckError) {
      return new Response(
        JSON.stringify({ error: 'Fehler beim Prüfen des Geräts' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Wenn das Gerät bereits aktiviert ist, aktualisieren wir nur den Zeitstempel
    if (existingDevice) {
      if (existingDevice.is_active) {
        const { error: updateError } = await supabaseClient
          .from(`${schema}.device_activations`)
          .update({
            last_check_in: new Date().toISOString(),
            device_name: deviceName || 'Unbenanntes Gerät'
          })
          .eq('id', existingDevice.id);

        if (updateError) {
          return new Response(
            JSON.stringify({ error: 'Fehler beim Aktualisieren des Geräts' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          );
        }

        return new Response(
          JSON.stringify({
            success: true,
            message: 'Gerät bereits aktiviert',
            active_devices_count: activeDevices.length
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        // Wenn das Gerät deaktiviert war, reaktivieren wir es
        if (activeDevices.length >= 3) {
          return new Response(
            JSON.stringify({
              error: 'Maximale Anzahl an Geräten erreicht',
              active_devices_count: activeDevices.length
            }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
          );
        }

        const { error: reactivateError } = await supabaseClient
          .from(`${schema}.device_activations`)
          .update({
            is_active: true,
            last_check_in: new Date().toISOString(),
            device_name: deviceName || existingDevice.device_name || 'Unbenanntes Gerät'
          })
          .eq('id', existingDevice.id);

        if (reactivateError) {
          return new Response(
            JSON.stringify({ error: 'Fehler beim Reaktivieren des Geräts' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          );
        }
      }
    } else {
      // Neues Gerät aktivieren, wenn das Limit nicht erreicht ist
      if (activeDevices.length >= 3) {
        return new Response(
          JSON.stringify({
            error: 'Maximale Anzahl an Geräten erreicht',
            active_devices_count: activeDevices.length
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
        );
      }

      // Neues Gerät hinzufügen
      const { error: activationError } = await supabaseClient
        .from(`${schema}.device_activations`)
        .insert({
          license_id: licenseData.id,
          device_id: deviceId,
          device_name: deviceName || 'Unbenanntes Gerät',
          first_activated_at: new Date().toISOString(),
          last_check_in: new Date().toISOString(),
          is_active: true
        });

      if (activationError) {
        return new Response(
          JSON.stringify({ error: 'Fehler beim Aktivieren des Geräts' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
    }

    // Erfolgreiche Antwort
    return new Response(
      JSON.stringify({
        success: true,
        message: 'Gerät erfolgreich aktiviert',
        active_devices_count: activeDevices.length + 1
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
