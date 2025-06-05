# SwitchFast Lizenzsystem - Deployment-Anleitung

Diese Anleitung beschreibt, wie Sie die Edge Functions für das SwitchFast-Lizenzsystem in Ihrer Supabase-Umgebung bereitstellen, mit Unterstützung für Test- und Produktionsumgebungen.

## Voraussetzungen

- Supabase-Projekt (erstellt unter [supabase.com](https://supabase.com))
- Docker Desktop (für lokale Entwicklung und Deployment)
- Stripe-Konto (mit API-Schlüsseln für Test- und Produktionsumgebung)
- Node.js und npm

## Umgebungsvariablen einrichten

1. Erstellen Sie eine `.env`-Datei im Hauptverzeichnis des Projekts mit folgenden Variablen:

```
# Supabase-Konfiguration
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Stripe Produktionsumgebung
PROD_STRIPE_SECRET_KEY=sk_live_...
PROD_STRIPE_WEBHOOK_SECRET=whsec_...
PROD_STRIPE_PRICE_ID=price_...
PROD_STRIPE_SUCCESS_URL=https://your-app-domain.com/success
PROD_STRIPE_CANCEL_URL=https://your-app-domain.com/cancel

# Stripe Testumgebung
TEST_STRIPE_SECRET_KEY=sk_test_...
TEST_STRIPE_WEBHOOK_SECRET=whsec_test_...
TEST_STRIPE_PRICE_ID=price_test_...
TEST_STRIPE_SUCCESS_URL=http://localhost:3000/success
TEST_STRIPE_CANCEL_URL=http://localhost:3000/cancel

# Aktive Umgebung (test oder prod)
ACTIVE_ENVIRONMENT=test
```

2. Stellen Sie sicher, dass diese Umgebungsvariablen auch in Ihrer Supabase-Projektumgebung konfiguriert sind:
   - Gehen Sie zu Ihrem Supabase-Dashboard
   - Navigieren Sie zu "Settings" > "API"
   - Scrollen Sie nach unten zu "Project Settings" > "Environment Variables"
   - Fügen Sie alle oben genannten Variablen hinzu

## Datenbanktabellen erstellen

Führen Sie die folgenden SQL-Befehle in der Supabase SQL-Konsole aus, um separate Schemas für Test- und Produktionsumgebung zu erstellen:

```sql
-- Schemas für Test- und Produktionsumgebung erstellen
CREATE SCHEMA IF NOT EXISTS prod;
CREATE SCHEMA IF NOT EXISTS test;

-- Gemeinsame Funktionen im public Schema
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Produktionsumgebung Tabellen
-- Lizenztabelle
CREATE TABLE prod.licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_key TEXT UNIQUE NOT NULL,
  email TEXT,
  stripe_customer_id TEXT,
  stripe_payment_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- Geräteaktivierungstabelle
CREATE TABLE prod.device_activations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_id UUID REFERENCES prod.licenses(id),
  device_id TEXT NOT NULL,
  device_name TEXT,
  first_activated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_check_in TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(license_id, device_id)
);

-- Trial-Blocks-Tabelle
CREATE TABLE prod.trial_blocks (
  device_id TEXT PRIMARY KEY,
  trial_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  trial_end_date TIMESTAMP WITH TIME ZONE,
  is_trial_used BOOLEAN DEFAULT TRUE
);

-- Indizes für schnellere Abfragen (Produktion)
CREATE INDEX idx_prod_licenses_license_key ON prod.licenses(license_key);
CREATE INDEX idx_prod_device_activations_license_id ON prod.device_activations(license_id);
CREATE INDEX idx_prod_device_activations_device_id ON prod.device_activations(device_id);

-- Trigger für automatische Aktualisierung des updated_at-Felds (Produktion)
CREATE TRIGGER update_prod_licenses_updated_at
BEFORE UPDATE ON prod.licenses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();

-- Testumgebung Tabellen (identische Struktur)
-- Lizenztabelle
CREATE TABLE test.licenses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_key TEXT UNIQUE NOT NULL,
  email TEXT,
  stripe_customer_id TEXT,
  stripe_payment_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE
);

-- Geräteaktivierungstabelle
CREATE TABLE test.device_activations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  license_id UUID REFERENCES test.licenses(id),
  device_id TEXT NOT NULL,
  device_name TEXT,
  first_activated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_check_in TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  UNIQUE(license_id, device_id)
);

-- Trial-Blocks-Tabelle
CREATE TABLE test.trial_blocks (
  device_id TEXT PRIMARY KEY,
  trial_start_date TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  trial_end_date TIMESTAMP WITH TIME ZONE,
  is_trial_used BOOLEAN DEFAULT TRUE
);

-- Indizes für schnellere Abfragen (Test)
CREATE INDEX idx_test_licenses_license_key ON test.licenses(license_key);
CREATE INDEX idx_test_device_activations_license_id ON test.device_activations(license_id);
CREATE INDEX idx_test_device_activations_device_id ON test.device_activations(device_id);

-- Trigger für automatische Aktualisierung des updated_at-Felds (Test)
CREATE TRIGGER update_test_licenses_updated_at
BEFORE UPDATE ON test.licenses
FOR EACH ROW
EXECUTE FUNCTION update_updated_at();
```

## Edge Functions bereitstellen

### Mit npx (empfohlen)

Die Supabase CLI kann direkt mit npx verwendet werden, ohne eine globale Installation:

1. Stellen Sie sicher, dass Docker Desktop installiert und gestartet ist.

2. Stellen Sie die Edge Functions bereit:

```bash
npx supabase functions deploy activateDevice --project-ref your-project-id
npx supabase functions deploy checkLicenseStatus --project-ref your-project-id
npx supabase functions deploy checkTrialStatus --project-ref your-project-id
npx supabase functions deploy createCheckoutSession --project-ref your-project-id
npx supabase functions deploy createLicense --project-ref your-project-id
npx supabase functions deploy deactivateDevice --project-ref your-project-id
npx supabase functions deploy getActivatedDevices --project-ref your-project-id
npx supabase functions deploy handleStripeWebhook --project-ref your-project-id
```

Ersetzen Sie `your-project-id` durch Ihre tatsächliche Supabase-Projekt-ID.

### Alternative Installationsmethoden für die Supabase CLI

#### Mit Windows-Paketmanagern

```bash
# Mit Scoop
scoop bucket add supabase https://github.com/supabase/scoop-bucket.git
scoop install supabase

# Mit Chocolatey (wenn verfügbar)
choco install supabase
```

#### Lokale Installation im Projekt

```bash
npm install supabase --save-dev
```

Dann in package.json:
```json
"scripts": {
  "supabase": "supabase"
}
```

Und verwenden mit:
```bash
npm run supabase functions deploy activateDevice --project-ref your-project-id
```

## Stripe-Webhooks einrichten

Sie müssen separate Webhooks für Test- und Produktionsumgebung einrichten:

### Webhook für die Testumgebung

1. Gehen Sie zu Ihrem Stripe-Dashboard und stellen Sie sicher, dass Sie im **Testmodus** sind (oben rechts)
2. Navigieren Sie zu "Developers" > "Webhooks"
3. Klicken Sie auf "Add Endpoint"
4. Geben Sie die URL Ihrer handleStripeWebhook-Funktion mit dem Query-Parameter `env=test` ein:
   ```
   https://foqnvgvtyluvektevlab.supabase.co/functions/v1/handleStripeWebhook?env=test
   ```
   (Ersetzen Sie `foqnvgvtyluvektevlab` durch Ihre tatsächliche Projekt-ID)
5. Wählen Sie die folgenden Ereignisse aus:
   - `checkout.session.completed`
   - `charge.refunded`
6. Klicken Sie auf "Add Endpoint"
7. Kopieren Sie das Webhook-Secret und fügen Sie es als `TEST_STRIPE_WEBHOOK_SECRET` in Ihre Umgebungsvariablen in Supabase ein

### Webhook für die Produktionsumgebung

1. Wechseln Sie im Stripe-Dashboard in den **Live-Modus** (oben rechts)
2. Navigieren Sie zu "Developers" > "Webhooks"
3. Klicken Sie auf "Add Endpoint"
4. Geben Sie die URL Ihrer handleStripeWebhook-Funktion mit dem Query-Parameter `env=prod` ein:
   ```
   https://foqnvgvtyluvektevlab.supabase.co/functions/v1/handleStripeWebhook?env=prod
   ```
5. Wählen Sie die folgenden Ereignisse aus:
   - `checkout.session.completed`
   - `charge.refunded`
6. Klicken Sie auf "Add Endpoint"
7. Kopieren Sie das Webhook-Secret und fügen Sie es als `PROD_STRIPE_WEBHOOK_SECRET` in Ihre Umgebungsvariablen in Supabase ein

## Testen der Bereitstellung

1. Überprüfen Sie den Status der bereitgestellten Edge Functions im Supabase Dashboard:
   - Gehen Sie zu "Edge Functions"
   - Alle acht Funktionen sollten aufgelistet sein: activateDevice, checkLicenseStatus, checkTrialStatus, createCheckoutSession, createLicense, deactivateDevice, getActivatedDevices und handleStripeWebhook

2. Testen Sie die Edge Functions mit curl oder einem API-Client wie Postman:

   **Testumgebung:**
   ```bash
   # Beispiel für checkTrialStatus in der Testumgebung
   curl -X POST "https://foqnvgvtyluvektevlab.supabase.co/functions/v1/checkTrialStatus" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer your-anon-key" \
     -H "x-environment: test" \
     -d '{"deviceId": "test-device-id", "deviceName": "Test Device"}'
   ```

   **Produktionsumgebung:**
   ```bash
   # Beispiel für checkTrialStatus in der Produktionsumgebung
   curl -X POST "https://foqnvgvtyluvektevlab.supabase.co/functions/v1/checkTrialStatus" \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer your-anon-key" \
     -H "x-environment: prod" \
     -d '{"deviceId": "prod-device-id", "deviceName": "Production Device"}'
   ```

3. Überprüfen Sie die Logs in Ihrem Supabase-Dashboard:
   - Navigieren Sie zu "Edge Functions" > [Funktionsname] > "Logs"
   - Hier können Sie alle Anfragen und Fehler sehen
   - Achten Sie auf die Umgebungsangabe in den Logs (test/prod)

## Fehlerbehebung

- **Docker-Fehler**: Stellen Sie sicher, dass Docker Desktop installiert und gestartet ist
- **CORS-Fehler**: Überprüfen Sie, dass die CORS-Header in allen Edge Functions korrekt konfiguriert sind
- **Authentifizierungsfehler**: Stellen Sie sicher, dass die richtigen API-Schlüssel verwendet werden
- **Datenbankfehler**: Überprüfen Sie die Tabellenschemas und -berechtigungen
- **Stripe-Fehler**: Stellen Sie sicher, dass die Stripe-API-Schlüssel korrekt sind und die Webhook-URL erreichbar ist

## Umgebungsvariablen in Supabase konfigurieren

Nach dem Deployment der Edge Functions müssen Sie die Umgebungsvariablen in Supabase konfigurieren:

1. Gehen Sie zum Supabase Dashboard und wählen Sie Ihr Projekt
2. Navigieren Sie zu "Settings" > "API"
3. Scrollen Sie nach unten zu "Project Settings" > "Environment Variables"
4. Fügen Sie die folgenden Variablen hinzu:

   **Allgemeine Konfiguration:**
   - `ACTIVE_ENVIRONMENT`: `test` oder `prod` (bestimmt die Standardumgebung)

   **Produktionsumgebung:**
   - `PROD_STRIPE_SECRET_KEY`: Ihr Stripe Live Secret Key (beginnt mit `sk_live_`)
   - `PROD_STRIPE_WEBHOOK_SECRET`: Das Secret Ihres Stripe Live Webhooks
   - `PROD_STRIPE_PRICE_ID`: Die Preis-ID Ihres Lizenzprodukts in Stripe Live
   - `PROD_STRIPE_SUCCESS_URL`: URL für erfolgreiche Zahlungen (z.B. `https://your-app-domain.com/success`)
   - `PROD_STRIPE_CANCEL_URL`: URL für abgebrochene Zahlungen (z.B. `https://your-app-domain.com/cancel`)

   **Testumgebung:**
   - `TEST_STRIPE_SECRET_KEY`: Ihr Stripe Test Secret Key (beginnt mit `sk_test_`)
   - `TEST_STRIPE_WEBHOOK_SECRET`: Das Secret Ihres Stripe Test Webhooks
   - `TEST_STRIPE_PRICE_ID`: Die Preis-ID Ihres Lizenzprodukts in Stripe Test
   - `TEST_STRIPE_SUCCESS_URL`: URL für erfolgreiche Testzahlungen (z.B. `http://localhost:3000/success`)
   - `TEST_STRIPE_CANCEL_URL`: URL für abgebrochene Testzahlungen (z.B. `http://localhost:3000/cancel`)

## Nächste Schritte

Nach erfolgreicher Bereitstellung der Edge Functions:

1. Integrieren Sie den LicenseManager in Ihre Electron-App gemäß der INTEGRATION.md-Anleitung
2. Testen Sie den vollständigen Ablauf: Trial, Kauf, Aktivierung, Deaktivierung
3. Überwachen Sie die Logs auf Fehler oder unerwartetes Verhalten
4. Richten Sie ein Monitoring-System für die Edge Functions ein, um Ausfälle frühzeitig zu erkennen
