import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
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
    
    const { deviceId, deviceName, email } = await req.json();

    // Validierung der Eingaben
    if (!deviceId) {
      return new Response(
        JSON.stringify({ error: 'Fehlende Geräte-ID' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Stripe-Client initialisieren mit dem umgebungsspezifischen Key
    const stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2023-10-16',
    });

    // Preis-ID aus der Umgebungsvariable abrufen (umgebungsspezifisch)
    const priceIdKey = environment === 'prod' ? 'PROD_STRIPE_PRICE_ID' : 'TEST_STRIPE_PRICE_ID';
    const priceId = Deno.env.get(priceIdKey);
    if (!priceId) {
      return new Response(
        JSON.stringify({ error: `Preis-ID für Umgebung ${environment} ist nicht konfiguriert` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
      );
    }

    // Success- und Cancel-URLs aus den Umgebungsvariablen abrufen oder Standard-Protokoll-URLs verwenden
    // Für Electron-Apps verwenden wir das benutzerdefinierte Protokoll switchfast://
    const baseSuccessUrl = Deno.env.get('STRIPE_SUCCESS_URL') || 'switchfast://payment-success';
    const baseCancelUrl = Deno.env.get('STRIPE_CANCEL_URL') || 'switchfast://payment-cancel';
    
    // Füge Umgebungsparameter zu den URLs hinzu
    const successUrl = `${baseSuccessUrl}${baseSuccessUrl.includes('?') ? '&' : '?'}env=${environment}`;
    const cancelUrl = `${baseCancelUrl}${baseCancelUrl.includes('?') ? '&' : '?'}env=${environment}`;

    // Checkout-Session erstellen
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${successUrl}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: cancelUrl,
      customer_email: email, // Optional: Vorausgefüllte E-Mail-Adresse
      // Wichtig: Device-ID als client_reference_id übergeben
      // Dies wird vom Webhook verwendet, um die Lizenz zu aktivieren
      client_reference_id: deviceId,
      metadata: {
        deviceName: deviceName || 'Unbenanntes Gerät'
      },
    });

    // Erfolgreiche Antwort mit der Checkout-URL
    return new Response(
      JSON.stringify({
        success: true,
        url: session.url
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
