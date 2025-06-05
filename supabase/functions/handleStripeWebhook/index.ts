import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import Stripe from 'https://esm.sh/stripe@12.0.0';

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
    
    // Stripe-Konfiguration basierend auf der Umgebung auswählen
    const stripeSecretKey = environment === 'prod' 
      ? Deno.env.get('PROD_STRIPE_SECRET_KEY') 
      : Deno.env.get('TEST_STRIPE_SECRET_KEY');
      
    const stripeWebhookSecret = environment === 'prod'
      ? Deno.env.get('PROD_STRIPE_WEBHOOK_SECRET')
      : Deno.env.get('TEST_STRIPE_WEBHOOK_SECRET');
    
    // Stripe-Webhook-Signatur aus dem Header extrahieren
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      return new Response(
        JSON.stringify({ error: 'Fehlende Stripe-Signatur' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Stripe-Client initialisieren mit dem entsprechenden API-Key
    const stripe = new Stripe(stripeSecretKey ?? '', {
      apiVersion: '2023-10-16',
    });

    // Prüfen, ob das Webhook-Secret konfiguriert ist
    if (!stripeWebhookSecret) {
      console.error(`${environment.toUpperCase()}_STRIPE_WEBHOOK_SECRET ist nicht konfiguriert`);
      return new Response(
        JSON.stringify({ error: 'Webhook-Secret ist nicht konfiguriert' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Request-Body als Text abrufen
    const body = await req.text();

    // Stripe-Event konstruieren und verifizieren
    let event;
    try {
      event = stripe.webhooks.constructEvent(body, signature, stripeWebhookSecret);
    } catch (err) {
      console.error(`Webhook-Signatur-Verifizierung fehlgeschlagen:`, err);
      return new Response(
        JSON.stringify({ error: 'Ungültige Signatur' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Supabase-Client initialisieren
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Event-Typ verarbeiten
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        
        // Prüfen, ob die Zahlung erfolgreich war
        if (session.payment_status === 'paid') {
          const customerId = session.customer;
          const paymentId = session.payment_intent;
          const email = session.customer_details?.email;
          const deviceId = session.metadata?.deviceId;
          const deviceName = session.metadata?.deviceName || 'Unbenanntes Gerät';

          if (!email || !deviceId) {
            console.error('Fehlende erforderliche Metadaten:', { email, deviceId });
            return new Response(
              JSON.stringify({ error: 'Fehlende erforderliche Metadaten' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
            );
          }

          // Eindeutigen Lizenzschlüssel generieren (Format: SF-XXXX-XXXX-XXXX)
          const licenseKey = `SF-${generateRandomString(4)}-${generateRandomString(4)}-${generateRandomString(4)}`;

          // Neue Lizenz in der Datenbank erstellen (mit Schema)
          const { data: licenseData, error: licenseError } = await supabaseClient
            .from(`${schema}.licenses`)
            .insert({
              license_key: licenseKey,
              email: email,
              stripe_customer_id: customerId,
              stripe_payment_id: paymentId,
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
              device_name: deviceName,
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

          console.log(`Lizenz erfolgreich erstellt für ${email} mit Gerät ${deviceId}`);
        }
        break;
      }
      
      case 'charge.refunded': {
        const charge = event.data.object;
        const paymentIntentId = charge.payment_intent;
        
        if (paymentIntentId) {
          // Lizenz finden und deaktivieren (mit Schema)
          const { data: licenseData, error: licenseError } = await supabaseClient
            .from(`${schema}.licenses`)
            .select('id')
            .eq('stripe_payment_id', paymentIntentId)
            .single();

          if (licenseError || !licenseData) {
            console.error('Lizenz für Rückerstattung nicht gefunden:', paymentIntentId);
            return new Response(
              JSON.stringify({ error: 'Lizenz nicht gefunden' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
            );
          }

          // Lizenz deaktivieren (mit Schema)
          const { error: updateError } = await supabaseClient
            .from(`${schema}.licenses`)
            .update({ is_active: false })
            .eq('id', licenseData.id);

          if (updateError) {
            console.error('Fehler beim Deaktivieren der Lizenz:', updateError);
            return new Response(
              JSON.stringify({ error: 'Fehler beim Deaktivieren der Lizenz' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
            );
          }

          // Alle Geräte für diese Lizenz deaktivieren (mit Schema)
          const { error: devicesError } = await supabaseClient
            .from(`${schema}.device_activations`)
            .update({ is_active: false })
            .eq('license_id', licenseData.id);

          if (devicesError) {
            console.error('Fehler beim Deaktivieren der Geräte:', devicesError);
            return new Response(
              JSON.stringify({ error: 'Fehler beim Deaktivieren der Geräte' }),
              { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
            );
          }

          console.log(`Lizenz deaktiviert aufgrund von Rückerstattung für Payment Intent ${paymentIntentId}`);
        }
        break;
      }

      // Weitere Event-Typen können hier hinzugefügt werden

      default:
        console.log(`Unbehandelter Event-Typ: ${event.type}`);
    }

    // Erfolgreiche Antwort
    return new Response(
      JSON.stringify({ received: true }),
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
