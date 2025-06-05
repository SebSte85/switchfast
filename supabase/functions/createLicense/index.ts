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
    
    const { email, stripeCustomerId, stripePaymentId, deviceId, deviceName } = await req.json();

    // Validierung der Eingaben
    if (!email || !stripeCustomerId || !stripePaymentId || !deviceId) {
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

    // Eindeutigen Lizenzschlüssel generieren (Format: SF-XXXX-XXXX-XXXX)
    const licenseKey = `SF-${generateRandomString(4)}-${generateRandomString(4)}-${generateRandomString(4)}`;

    // Neue Lizenz in der Datenbank erstellen (mit Schema)
    const { data: licenseData, error: licenseError } = await supabaseClient
      .from(`${schema}.licenses`)
      .insert({
        license_key: licenseKey,
        email: email,
        stripe_customer_id: stripeCustomerId,
        stripe_payment_id: stripePaymentId,
        is_active: true
      })
      .select()
      .single();

    if (licenseError) {
      console.error('Fehler beim Erstellen der Lizenz:', licenseError);
      return new Response(
        JSON.stringify({ error: 'Fehler beim Erstellen der Lizenz' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Gerät aktivieren (mit Schema)
    const { error: deviceError } = await supabaseClient
      .from(`${schema}.device_activations`)
      .insert({
        license_id: licenseData.id,
        device_id: deviceId,
        device_name: deviceName || 'Unbenanntes Gerät',
        first_activated_at: new Date().toISOString(),
        last_check_in: new Date().toISOString(),
        is_active: true
      });

    if (deviceError) {
      console.error('Fehler beim Aktivieren des Geräts:', deviceError);
      return new Response(
        JSON.stringify({ error: 'Fehler beim Aktivieren des Geräts' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Erfolgreiche Antwort
    return new Response(
      JSON.stringify({
        success: true,
        license_key: licenseKey,
        message: 'Lizenz erfolgreich erstellt und Gerät aktiviert'
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

// Hilfsfunktion zum Generieren eines zufälligen Strings
function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}
