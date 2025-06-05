import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.0.0';
import { generateLicenseKey } from '../_shared/licenseUtils.ts';

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
    
    // Stripe-Key basierend auf der Umgebung auswählen
    const stripeSecretKey = environment === 'prod' 
      ? Deno.env.get('PROD_STRIPE_SECRET_KEY') 
      : Deno.env.get('TEST_STRIPE_SECRET_KEY');
    
    if (!stripeSecretKey) {
      return new Response(
        JSON.stringify({ error: `Stripe Secret Key für Umgebung ${environment} ist nicht konfiguriert` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Request-Daten abrufen
    const { sessionId, deviceId, deviceName } = await req.json();

    // Validierung der Eingaben
    if (!sessionId || !deviceId) {
      return new Response(
        JSON.stringify({ error: 'Fehlende Session-ID oder Geräte-ID' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Stripe-Client initialisieren mit dem umgebungsspezifischen Key
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
    });

    // Checkout-Session abrufen und überprüfen
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    
    // Prüfen, ob die Session erfolgreich bezahlt wurde
    if (session.payment_status !== 'paid') {
      return new Response(
        JSON.stringify({ error: 'Die Zahlung wurde nicht abgeschlossen', success: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Supabase-Client initialisieren
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ error: 'Supabase-Konfiguration fehlt', success: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }
    
    const supabaseClient = createClient(supabaseUrl, supabaseServiceKey, {
      db: { schema: environment === 'prod' ? 'prod' : 'test' }
    });

    // Kundeninformationen aus der Session abrufen
    const customerEmail = session.customer_details?.email;
    const stripeCustomerId = session.customer;
    const stripePaymentId = session.payment_intent as string;
    
    if (!customerEmail) {
      return new Response(
        JSON.stringify({ error: 'Keine Kunden-E-Mail in der Session gefunden', success: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Prüfen, ob bereits eine Lizenz für diese E-Mail existiert
    const { data: existingLicense, error: existingLicenseError } = await supabaseClient
      .from('licenses')
      .select('license_key')
      .eq('email', customerEmail)
      .eq('stripe_payment_id', stripePaymentId)
      .single();

    let licenseKey;
    
    if (existingLicense) {
      // Wenn bereits eine Lizenz existiert, verwende diese
      licenseKey = existingLicense.license_key;
      console.log(`Bestehende Lizenz gefunden: ${licenseKey}`);
    } else {
      // Neue Lizenz erstellen
      licenseKey = generateLicenseKey();
      
      // Lizenz in der Datenbank speichern
      const { error: licenseError } = await supabaseClient
        .from('licenses')
        .insert({
          license_key: licenseKey,
          email: customerEmail,
          stripe_customer_id: stripeCustomerId,
          stripe_payment_id: stripePaymentId,
          is_active: true
        });
      
      if (licenseError) {
        console.error('Fehler beim Erstellen der Lizenz:', licenseError);
        return new Response(
          JSON.stringify({ error: 'Fehler beim Erstellen der Lizenz', success: false }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
      
      console.log(`Neue Lizenz erstellt: ${licenseKey}`);
    }

    // Gerät aktivieren
    const { error: deviceError } = await supabaseClient
      .from('devices')
      .insert({
        license_key: licenseKey,
        device_id: deviceId,
        device_name: deviceName || 'Unbenanntes Gerät',
        is_active: true
      });
    
    if (deviceError) {
      console.error('Fehler beim Aktivieren des Geräts:', deviceError);
      return new Response(
        JSON.stringify({ error: 'Fehler beim Aktivieren des Geräts', success: false }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Erfolgreiche Antwort mit der Lizenz
    return new Response(
      JSON.stringify({
        success: true,
        licenseKey: licenseKey,
        email: customerEmail,
        purchaseDate: new Date().toISOString()
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Unerwarteter Fehler:', error);
    return new Response(
      JSON.stringify({ error: 'Ein unerwarteter Fehler ist aufgetreten', success: false }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
