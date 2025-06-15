-- Migration: Enable Row Level Security Policies
-- Erstellt: $(date +"%Y-%m-%d")
-- Zweck: Implementiert RLS für Datenschutz und Sicherheit

-- 1. RLS für licenses Tabelle aktivieren
ALTER TABLE test.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE prod.licenses ENABLE ROW LEVEL SECURITY;

-- 2. Policy: Benutzer sehen nur eigene Lizenzen
CREATE POLICY "users_own_licenses_test" ON test.licenses
  FOR ALL USING (
    auth.jwt() ->> 'email' = email OR
    auth.role() = 'service_role'
  );

CREATE POLICY "users_own_licenses_prod" ON prod.licenses
  FOR ALL USING (
    auth.jwt() ->> 'email' = email OR
    auth.role() = 'service_role'
  );

-- 3. RLS für device_activations aktivieren
ALTER TABLE test.device_activations ENABLE ROW LEVEL SECURITY;
ALTER TABLE prod.device_activations ENABLE ROW LEVEL SECURITY;

-- 4. Policy: Benutzer sehen nur eigene Geräte-Aktivierungen
CREATE POLICY "users_own_devices_test" ON test.device_activations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM test.licenses 
      WHERE licenses.id = device_activations.license_id 
      AND (licenses.email = auth.jwt() ->> 'email' OR auth.role() = 'service_role')
    )
  );

CREATE POLICY "users_own_devices_prod" ON prod.device_activations
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM prod.licenses 
      WHERE licenses.id = device_activations.license_id 
      AND (licenses.email = auth.jwt() ->> 'email' OR auth.role() = 'service_role')
    )
  );

-- 5. Service Account Policy für interne Operations
CREATE POLICY "service_full_access_test" ON test.licenses
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_full_access_prod" ON prod.licenses
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_device_access_test" ON test.device_activations
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_device_access_prod" ON prod.device_activations
  FOR ALL USING (auth.role() = 'service_role');

-- 6. Kommentare für Dokumentation
COMMENT ON POLICY "users_own_licenses_test" ON test.licenses IS 
'Benutzer können nur ihre eigenen Lizenzen einsehen und bearbeiten';

COMMENT ON POLICY "users_own_devices_test" ON test.device_activations IS 
'Benutzer können nur Geräte-Aktivierungen ihrer eigenen Lizenzen einsehen';

-- 7. Index für Performance (falls nicht bereits vorhanden)
CREATE INDEX IF NOT EXISTS idx_test_licenses_email ON test.licenses(email);
CREATE INDEX IF NOT EXISTS idx_prod_licenses_email ON prod.licenses(email);

-- 8. Verification Query (für Tests)
-- SELECT COUNT(*) FROM test.licenses; -- Sollte nur eigene Lizenzen zeigen
-- SELECT COUNT(*) FROM test.device_activations; -- Sollte nur eigene Geräte zeigen