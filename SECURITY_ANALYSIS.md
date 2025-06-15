# Sicherheitsanalyse - SwitchFast Projekt

## 🔴 KRITISCHE SICHERHEITSPROBLEME

### 1. Stripe Webhook Sicherheit - KRITISCH
**Problem**: Hardcoded Webhook Secret im Code
```typescript
// ❌ UNSICHER: Hardcoded Secret in Production Code
if (environment === "test" && !stripeWebhookSecret) {
  stripeWebhookSecret = "whsec_IGSFWWT3TV4a9LmA5fBFstEjcNY4KocG";
  console.log("🟡 TEMPORARY: Using hardcoded TEST webhook secret");
}
```
**Risiko**: Angreifer können gefälschte Webhooks senden
**Auswirkung**: Unberechtigt aktivierte Lizenzen, finanzielle Verluste

### 2. Fehlende Row Level Security (RLS) - KRITISCH
**Problem**: Keine RLS-Policies für Supabase-Tabellen implementiert
**Betroffene Tabellen**:
- `licenses`  
- `device_activations`

**Risiko**: Benutzer können auf fremde Daten zugreifen
**Auswirkung**: Datenleckage, DSGVO-Verstöße

### 3. Unsichere Secrets-Verwaltung - HOCH
**Problem**: Environment-Variablen werden im Code exponiert
```typescript
// ❌ Potentielle Exposition
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
```
**Risiko**: Secrets in Build-Artefakten/Logs sichtbar

### 4. Fehlende Authentifizierung bei Supabase Functions - HOCH
**Problem**: Functions verwenden Service Role ohne Benutzer-Authentifizierung
```typescript
// ❌ Verwendet Service Role für alles
const supabaseClient = createClient(
  supabaseUrl ?? "",
  supabaseServiceKey ?? ""
);
```
**Risiko**: Unrestricted Database Access

## 🟡 MITTLERE SICHERHEITSPROBLEME

### 5. Unvalidierte Input-Parameter
**Problem**: Device-IDs und andere Parameter werden nicht validiert
**Risiko**: Injection-Angriffe, Datenkorruption

### 6. Fehlende Rate Limiting
**Problem**: Keine Begrenzung für API-Aufrufe
**Risiko**: DoS-Angriffe, Ressourcen-Erschöpfung

## 🔧 KONKRETE LÖSUNGSVORSCHLÄGE

### 1. Stripe Webhook Sicherheit beheben

#### A) Webhook Secret Environment Variable
```typescript
// ✅ SICHER: Nur Environment Variables verwenden
const stripeWebhookSecret = Deno.env.get(webhookSecretKey);

if (!stripeWebhookSecret) {
  console.error(`🔴 CRITICAL: ${webhookSecretKey} not configured`);
  return new Response(
    JSON.stringify({ error: "Webhook configuration error" }),
    { status: 500, headers: corsHeaders }
  );
}
```

#### B) IP-Whitelist für Stripe
```typescript
// ✅ Stripe IP-Adressen validieren
const STRIPE_IPS = [
  '3.18.12.63/32',
  '3.130.192.231/32',
  // ... weitere Stripe IPs
];

function validateStripeIP(request: Request): boolean {
  const forwardedFor = request.headers.get('x-forwarded-for');
  const clientIP = forwardedFor?.split(',')[0].trim();
  return STRIPE_IPS.some(ip => isIPInRange(clientIP, ip));
}
```

### 2. Row Level Security implementieren

#### A) RLS Migration erstellen
```sql
-- Migration: enable_rls_policies.sql

-- Enable RLS für licenses Tabelle
ALTER TABLE test.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE prod.licenses ENABLE ROW LEVEL SECURITY;

-- Policy: Benutzer sehen nur eigene Lizenzen
CREATE POLICY "users_own_licenses" ON test.licenses
  FOR ALL USING (
    auth.jwt() ->> 'email' = email OR
    auth.role() = 'service_role'
  );

CREATE POLICY "users_own_licenses" ON prod.licenses
  FOR ALL USING (
    auth.jwt() ->> 'email' = email OR
    auth.role() = 'service_role'
  );

-- Enable RLS für device_activations
ALTER TABLE test.device_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE prod.device_activations ENABLE ROW LEVEL SECURITY;

-- Policy: Benutzer sehen nur eigene Geräte-Aktivierungen
CREATE POLICY "users_own_devices" ON test.device_activations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM test.licenses 
      WHERE licenses.id = device_activations.license_id 
      AND (licenses.email = auth.jwt() ->> 'email' OR auth.role() = 'service_role')
    )
  );

CREATE POLICY "users_own_devices" ON prod.device_activations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM prod.licenses 
      WHERE licenses.id = device_activations.license_id 
      AND (licenses.email = auth.jwt() ->> 'email' OR auth.role() = 'service_role')
    )
  );
```

### 3. Sichere Authentifizierung für Functions

#### A) JWT-Authentifizierung implementieren
```typescript
// ✅ JWT-basierte Authentifizierung
async function authenticateUser(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('Missing or invalid authorization header');
  }

  const token = authHeader.substring(7);
  
  // JWT mit Supabase validieren
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!
  );

  const { data: { user }, error } = await supabase.auth.getUser(token);
  
  if (error || !user) {
    throw new Error('Invalid token');
  }

  return user;
}

// In Function verwenden
serve(async (req) => {
  try {
    // Webhook-Endpunkte überspringen Auth
    if (req.url.includes('/handleStripeWebhook')) {
      return await handleWebhook(req);
    }

    // Für alle anderen: Auth required
    const user = await authenticateUser(req);
    
    // Function mit authentifiziertem User ausführen
    return await handleRequest(req, user);
  } catch (error) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: corsHeaders }
    );
  }
});
```

### 4. Input-Validierung implementieren

#### A) Zod Schema Validation
```typescript
import { z } from 'https://deno.land/x/zod/mod.ts';

const DeviceActivationSchema = z.object({
  deviceId: z.string().uuid('Invalid device ID format'),
  deviceName: z.string().min(1).max(100),
  email: z.string().email('Invalid email format')
});

// ✅ Validierung verwenden
async function createLicense(data: unknown) {
  const validatedData = DeviceActivationSchema.parse(data);
  // Weiter mit validierten Daten...
}
```

### 5. Rate Limiting hinzufügen

#### A) Redis-basiertes Rate Limiting
```typescript
// ✅ Rate Limiting implementieren
async function rateLimit(identifier: string, limit: number = 10): Promise<boolean> {
  const redis = new Redis(Deno.env.get('REDIS_URL'));
  const key = `rate_limit:${identifier}`;
  
  const current = await redis.incr(key);
  
  if (current === 1) {
    await redis.expire(key, 60); // 1 Minute Window
  }
  
  return current <= limit;
}

// In Function verwenden
serve(async (req) => {
  const clientIP = req.headers.get('x-forwarded-for') || 'unknown';
  
  if (!await rateLimit(clientIP)) {
    return new Response(
      JSON.stringify({ error: 'Rate limit exceeded' }),
      { status: 429, headers: corsHeaders }
    );
  }
  
  // Request verarbeiten...
});
```

## 🚀 IMPLEMENTIERUNGS-PRIORITÄTEN

### Phase 1 - SOFORT (Kritisch)
1. ✅ Hardcoded Stripe Webhook Secret entfernen
2. ✅ RLS-Policies implementieren  
3. ✅ Webhook IP-Validierung

### Phase 2 - DIESE WOCHE (Hoch)
4. ✅ JWT-Authentifizierung für Functions
5. ✅ Input-Validierung mit Zod
6. ✅ Environment Variables audit

### Phase 3 - NÄCHSTE WOCHE (Mittel)
7. ✅ Rate Limiting implementieren
8. ✅ Audit Logging hinzufügen
9. ✅ Security Headers konfigurieren

## 🔍 EMPFOHLENE SICHERHEITS-TOOLS

1. **Supabase Dashboard**: RLS-Policies testen
2. **Stripe CLI**: Webhook-Events lokal testen  
3. **OWASP ZAP**: Security Scanning
4. **Semgrep**: Static Code Analysis

## 📋 COMPLIANCE-ÜBERPRÜFUNG

- [ ] DSGVO: RLS-Policies implementiert
- [ ] PCI DSS: Sichere Webhook-Verarbeitung
- [ ] SOC 2: Audit Logging aktiviert
- [ ] OWASP Top 10: Injection-Schutz implementiert

---

**Nächste Schritte**: Beginne mit Phase 1 (kritische Probleme) und teste alle Änderungen in der Test-Umgebung bevor Production-Deployment.