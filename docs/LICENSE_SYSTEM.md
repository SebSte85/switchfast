# SwitchFast Lizenzsystem

Diese Dokumentation beschreibt das Lizenzsystem für die SwitchFast Electron-App, das Stripe für Zahlungen und Supabase für die Datenhaltung und serverlose Backend-Funktionen verwendet.

## Architektur

Das Lizenzsystem besteht aus folgenden Komponenten:

1. **Electron-App**: 
   - LicenseManager im Main-Prozess
   - UI-Komponenten im Renderer-Prozess
   - IPC-Kommunikation zwischen Main und Renderer

2. **Supabase**:
   - Datenbanktabellen für Lizenzen, Geräteaktivierungen und Trial-Blocks in separaten Schemas (`test` und `prod`)
   - Edge Functions für die serverseitige Logik mit Umgebungstrennung

3. **Stripe**:
   - Zahlungsabwicklung über Stripe Checkout (gehostet)
   - Webhook-Integration für Ereignisverarbeitung
   - Separate Test- und Produktionsschlüssel

## Datenmodell

### Tabellen

1. **licenses**:
   - `id` (UUID): Primärschlüssel
   - `license_key` (TEXT): Eindeutiger Lizenzschlüssel
   - `email` (TEXT): E-Mail des Kunden
   - `stripe_customer_id` (TEXT): Stripe Kunden-ID
   - `stripe_payment_id` (TEXT): Stripe Zahlungs-ID
   - `created_at` (TIMESTAMP): Erstellungsdatum
   - `updated_at` (TIMESTAMP): Aktualisierungsdatum
   - `is_active` (BOOLEAN): Lizenzstatus

2. **device_activations**:
   - `id` (UUID): Primärschlüssel
   - `license_id` (UUID): Fremdschlüssel zur licenses-Tabelle
   - `device_id` (TEXT): Eindeutige Geräte-ID
   - `device_name` (TEXT): Name des Geräts
   - `first_activated_at` (TIMESTAMP): Datum der ersten Aktivierung
   - `last_check_in` (TIMESTAMP): Datum der letzten Statusprüfung
   - `is_active` (BOOLEAN): Aktivierungsstatus
   - Unique-Constraint für (license_id, device_id)

3. **trial_blocks**:
   - `device_id` (TEXT): Primärschlüssel
   - `trial_start_date` (TIMESTAMP): Startdatum der Trial-Periode
   - `trial_end_date` (TIMESTAMP): Enddatum der Trial-Periode
   - `is_trial_used` (BOOLEAN): Trial-Status

## Edge Functions

1. **createLicense**: Erstellt eine Lizenz nach erfolgreicher Stripe-Zahlung und aktiviert das Gerät.
2. **activateDevice**: Aktiviert ein Gerät für eine Lizenz (max. 3 Geräte pro Lizenz).
3. **checkLicenseStatus**: Prüft den Lizenz- und Geräteaktivierungsstatus und aktualisiert den letzten Check-in.
4. **deactivateDevice**: Deaktiviert ein Gerät für eine Lizenz.
5. **handleStripeWebhook**: Verarbeitet Stripe-Webhook-Ereignisse (Zahlungserfolg, Rückerstattungen).
6. **checkTrialStatus**: Verwaltet den Trial-Start, -Status und -Ablauf pro Gerät.
7. **createCheckoutSession**: Erstellt Stripe-Checkout-Sessions und gibt URLs für gehostete Checkouts zurück.
8. **getActivatedDevices**: Ruft alle aktivierten Geräte für eine Lizenz ab.

## Electron-Integration

### Main-Prozess

Der `LicenseManager` im Main-Prozess bietet folgende Funktionen:

- Generierung und Hashing von Geräte-IDs mit Salz
- Sichere lokale Speicherung von Lizenz- und Trial-Informationen mit Verschlüsselung
- Regelmäßige Lizenzstatusprüfungen (alle 4 Stunden) mit Offline-Gnadenfrist
- Trial-Statusprüfungen und lokaler Fallback
- Stripe-Checkout-Aufruf über die `createCheckoutSession` Edge Function
- Benutzerdialoge für Lizenzungültigkeit, Trial-Ablauf, maximale Geräteanzahl erreicht, Aktivierungsfehler und Checkout-Fehler
- Aktivierung und Deaktivierung von Geräten über entsprechende Edge Functions

### Renderer-Prozess

Die UI-Komponenten im Renderer-Prozess umfassen:

- **LicenseStatus**: Anzeige des aktuellen Lizenzstatus
- **LicenseActivation**: Formular zur Lizenzaktivierung
- **LicensePage**: Hauptseite für Lizenzkauf und -aktivierung
- **LicenseCheck**: Prüft, ob die App verwendet werden darf
- **DeviceManagement**: Verwaltung aktivierter Geräte
- **LicenseSettings**: Einstellungsseite für die Lizenzverwaltung

## Umgebungstrennung

Das Lizenzsystem unterstützt eine strikte Trennung zwischen Test- und Produktionsumgebung:

### Datenbank
- Verwendung separater PostgreSQL-Schemas (`test` und `prod`) innerhalb derselben Supabase-Instanz
- Jedes Schema enthält identische Tabellen für Lizenzen, Geräteaktivierungen und Trial-Blocks
- Vollständige Datenisolation zwischen den Umgebungen

### Edge Functions
- Dynamische Erkennung der aktiven Umgebung über:
  1. HTTP-Header `x-environment` (`test` oder `prod`)
  2. Query-Parameter `env` (`test` oder `prod`)
  3. Fallback auf die Umgebungsvariable `ACTIVE_ENVIRONMENT`
- Dynamische Auswahl des entsprechenden Datenbankschemas basierend auf der erkannten Umgebung
- Dynamische Auswahl der Stripe-Schlüssel (Test- oder Produktionsschlüssel)
- CORS-Header-Unterstützung für `x-environment`

### Stripe-Integration
- Separate API-Schlüssel für Test- und Produktionsumgebung
- Separate Webhook-Secrets für Test- und Produktionsumgebung
- Separate Preis-IDs für Test- und Produktionsumgebung
- Umgebungsparameter werden an Success- und Cancel-URLs angehängt

### Electron-App
- Muss bei API-Aufrufen die gewünschte Umgebung über Header `x-environment` oder Query-Parameter `env` angeben
- Kann zwischen Test- und Produktionsumgebung wechseln (z.B. für Entwicklungs- und Testzwecke)

## Sicherheitsmaßnahmen

- Verschlüsselte lokale Speicherung mit `electron-store`
- Verschleierung von Lizenzschlüsseln
- Serverseitige Validierung aller Anfragen
- Geräte-ID-Generierung mit Salz und Hashing
- Regelmäßige Lizenzvalidierung
- Strikte Trennung zwischen Test- und Produktionsumgebung

## Umgebungsvariablen

### Supabase
- `SUPABASE_URL`: URL der Supabase-Instanz
- `SUPABASE_SERVICE_ROLE_KEY`: Service-Role-Key für Supabase
- `ACTIVE_ENVIRONMENT`: Standard-Umgebung (`test` oder `prod`), wenn keine andere angegeben ist

### Stripe
- `TEST_STRIPE_SECRET_KEY`: Geheimer Schlüssel für Stripe Testumgebung
- `PROD_STRIPE_SECRET_KEY`: Geheimer Schlüssel für Stripe Produktionsumgebung
- `TEST_STRIPE_WEBHOOK_SECRET`: Webhook-Secret für Stripe Testumgebung
- `PROD_STRIPE_WEBHOOK_SECRET`: Webhook-Secret für Stripe Produktionsumgebung
- `TEST_STRIPE_PRICE_ID`: Preis-ID für Stripe Testumgebung
- `PROD_STRIPE_PRICE_ID`: Preis-ID für Stripe Produktionsumgebung
- `STRIPE_SUCCESS_URL`: URL für erfolgreiche Zahlungen
- `STRIPE_CANCEL_URL`: URL für abgebrochene Zahlungen
- `STRIPE_PRICE_ID`: Preis-ID für das Produkt in Stripe
- `STRIPE_SUCCESS_URL`: URL für erfolgreiche Zahlungen
- `STRIPE_CANCEL_URL`: URL für abgebrochene Zahlungen
- `LICENSE_ENCRYPTION_KEY`: Schlüssel für die Verschlüsselung der lokalen Speicherung
- `DEVICE_ID_SALT`: Salz für das Hashing der Geräte-ID

## Benutzerablauf

1. **Erster Start**:
   - 7-tägige Trial-Periode beginnt
   - Trial-Informationen werden lokal und remote gespeichert

2. **Trial-Ablauf**:
   - Benutzer wird aufgefordert, eine Lizenz zu kaufen oder zu aktivieren
   - Stripe Checkout kann direkt geöffnet werden

3. **Lizenzkauf**:
   - Benutzer kauft eine Lizenz über Stripe Checkout
   - Nach erfolgreicher Zahlung wird eine Lizenz erstellt und das Gerät aktiviert
   - Benutzer kann die App weiter verwenden

4. **Lizenzaktivierung auf weiteren Geräten**:
   - Benutzer kann die Lizenz auf bis zu 3 Geräten aktivieren
   - Lizenzschlüssel wird eingegeben und das Gerät aktiviert

5. **Regelmäßige Prüfung**:
   - App prüft regelmäßig den Lizenzstatus
   - Bei Ungültigkeit wird der Benutzer informiert

## Fehlerbehebung

- **Offline-Betrieb**: 7-tägige Gnadenfrist für Lizenzprüfungen
- **Maximale Geräteanzahl erreicht**: Benutzer kann Geräte deaktivieren
- **Ungültige Lizenz**: Benutzer wird zur Lizenzseite weitergeleitet

## Entwicklung und Tests

Zum Testen des Lizenzsystems:

1. Stellen Sie sicher, dass alle Umgebungsvariablen korrekt gesetzt sind
2. Deployen Sie die Edge Functions in Ihrer Supabase-Umgebung
3. Starten Sie die Electron-App im Entwicklungsmodus
4. Testen Sie den vollständigen Ablauf: Trial, Kauf, Aktivierung, Deaktivierung

## Bekannte Einschränkungen

- Die Offline-Gnadenfrist kann umgangen werden, indem die Systemzeit manipuliert wird
- Bei Netzwerkproblemen kann die Lizenzprüfung fehlschlagen
