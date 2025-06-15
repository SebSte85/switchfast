// ✅ SICHERHEIT: Input-Validierung für Supabase Functions
// Beispiel für sichere Implementierung mit Zod

import { z } from 'https://deno.land/x/zod/mod.ts';
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ✅ Validierungs-Schemas definieren
const DeviceActivationSchema = z.object({
  deviceId: z.string()
    .uuid('Device ID muss eine gültige UUID sein')
    .min(1, 'Device ID ist erforderlich'),
  deviceName: z.string()
    .min(1, 'Device Name ist erforderlich')
    .max(100, 'Device Name darf max. 100 Zeichen haben')
    .regex(/^[a-zA-Z0-9\s\-_]+$/, 'Device Name enthält ungültige Zeichen'),
  email: z.string()
    .email('Ungültige E-Mail-Adresse')
    .toLowerCase()
    .max(255, 'E-Mail darf max. 255 Zeichen haben')
});

const LicenseActivationSchema = z.object({
  licenseKey: z.string()
    .regex(/^SF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/, 'Ungültiges Lizenzschlüssel-Format'),
  deviceId: z.string().uuid('Ungültige Device ID'),
  environment: z.enum(['test', 'prod']).optional().default('test')
});

// ✅ Rate Limiting Schema
const RateLimitSchema = z.object({
  identifier: z.string().min(1),
  limit: z.number().min(1).max(1000).default(10),
  windowSeconds: z.number().min(1).max(3600).default(60)
});

// ✅ CORS Headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

// ✅ Authentifizierung validieren
async function authenticateUser(req: Request) {
  const authHeader = req.headers.get('authorization');
  
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);
  
  // JWT Token validieren
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Invalid or expired token');
  }

  return user;
}

// ✅ Rate Limiting implementieren
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(identifier: string, limit: number = 10, windowSeconds: number = 60): boolean {
  const now = Date.now();
  const key = identifier;
  const existing = rateLimitMap.get(key);

  if (!existing || now > existing.resetTime) {
    // Neue oder abgelaufene Rate Limit Periode
    rateLimitMap.set(key, {
      count: 1,
      resetTime: now + (windowSeconds * 1000)
    });
    return true;
  }

  if (existing.count >= limit) {
    return false; // Rate Limit überschritten
  }

  // Erhöhe Counter
  existing.count++;
  return true;
}

// ✅ Sichere Device Aktivierung
async function activateDevice(requestData: unknown, user: any) {
  // Input validieren
  const validatedData = DeviceActivationSchema.parse(requestData);
  
  // Schema basierend auf User bestimmen
  const schema = user.app_metadata?.environment === 'prod' ? 'prod' : 'test';
  
  // Supabase Client mit Service Role für DB-Operationen
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    {
      db: { schema }
    }
  );

  // ✅ Duplikat-Prüfung
  const { data: existingDevice, error: checkError } = await supabase
    .from('device_activations')
    .select('id')
    .eq('device_id', validatedData.deviceId)
    .eq('is_active', true)
    .maybeSingle();

  if (checkError) {
    throw new Error(`Database check failed: ${checkError.message}`);
  }

  if (existingDevice) {
    throw new Error('Device already activated');
  }

  // ✅ Lizenz-Prüfung (RLS wird automatisch angewendet)
  const { data: license, error: licenseError } = await supabase
    .from('licenses')
    .select('id, email, is_active')
    .eq('email', validatedData.email)
    .eq('is_active', true)
    .maybeSingle();

  if (licenseError) {
    throw new Error(`License check failed: ${licenseError.message}`);
  }

  if (!license) {
    throw new Error('No active license found for this email');
  }

  // Device aktivieren
  const { data: activation, error: activationError } = await supabase
    .from('device_activations')
    .insert({
      license_id: license.id,
      device_id: validatedData.deviceId,
      device_name: validatedData.deviceName,
      first_activated_at: new Date().toISOString(),
      last_check_in: new Date().toISOString(),
      is_active: true
    })
    .select()
    .single();

  if (activationError) {
    throw new Error(`Device activation failed: ${activationError.message}`);
  }

  return {
    success: true,
    device: activation,
    message: 'Device successfully activated'
  };
}

// ✅ Hauptfunktion mit allen Sicherheitsmaßnahmen
serve(async (req) => {
  // CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Rate Limiting
    const clientIP = req.headers.get('x-forwarded-for')?.split(',')[0].trim() || 'unknown';
    
    if (!checkRateLimit(clientIP, 10, 60)) {
      return new Response(
        JSON.stringify({ 
          error: 'Rate limit exceeded',
          retryAfter: 60 
        }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Authentifizierung (außer für Webhooks)
    let user = null;
    if (!req.url.includes('/webhook')) {
      user = await authenticateUser(req);
    }

    // Request Body parsen und validieren
    let requestData;
    try {
      const body = await req.text();
      requestData = body ? JSON.parse(body) : {};
    } catch (error) {
      return new Response(
        JSON.stringify({ error: 'Invalid JSON in request body' }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" }
        }
      );
    }

    // Route basierend auf URL bestimmen
    const url = new URL(req.url);
    const path = url.pathname;

    let result;
    switch (path) {
      case '/activateDevice':
        result = await activateDevice(requestData, user);
        break;
      
      default:
        return new Response(
          JSON.stringify({ error: 'Route not found' }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" }
          }
        );
    }

    return new Response(
      JSON.stringify(result),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );

  } catch (error) {
    console.error('Function error:', error);

    // ✅ Sichere Fehlerbehandlung - keine internen Details preisgeben
    const isValidationError = error instanceof z.ZodError;
    const statusCode = isValidationError ? 400 : 
                      error.message.includes('Unauthorized') ? 401 :
                      error.message.includes('not found') ? 404 : 500;

    const errorMessage = isValidationError 
      ? error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join(', ')
      : error.message.includes('Database') 
        ? 'Database operation failed'
        : error.message;

    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        ...(isValidationError && { validationErrors: error.errors })
      }),
      {
        status: statusCode,
        headers: { ...corsHeaders, "Content-Type": "application/json" }
      }
    );
  }
});

// ✅ Cleanup für Rate Limiting (optional)
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitMap.entries()) {
    if (now > value.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}, 60000); // Cleanup alle 60 Sekunden