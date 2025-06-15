# Sicherheits-Deployment Plan

## 🚨 SOFORTIGE MASSNAHMEN (Phase 1)

### 1. Stripe Webhook Secret beheben - KRITISCH
```bash
# 1. Environment Variables in Supabase setzen
npx supabase secrets set TEST_STRIPE_WEBHOOK_SECRET=whsec_your_test_secret
npx supabase secrets set PROD_STRIPE_WEBHOOK_SECRET=whsec_your_prod_secret

# 2. Webhook Function neu deployen
npx supabase functions deploy handleStripeWebhook --project-ref foqnvgvtyluvektevlab
```

### 2. Row Level Security aktivieren - KRITISCH
```bash
# 1. RLS Migration ausführen
npx supabase db push --project-ref foqnvgvtyluvektevlab

# 2. Migration validieren
npx supabase db diff --project-ref foqnvgvtyluvektevlab

# 3. RLS-Policies testen
# - Im Supabase Dashboard → Authentication → Policies
# - Test-Queries mit verschiedenen User-Kontexten ausführen
```

### 3. Webhook IP-Validierung testen
```bash
# Test mit curl (sollte fehlschlagen ohne Stripe IP)
curl -X POST https://your-project.supabase.co/functions/v1/handleStripeWebhook \
  -H "Content-Type: application/json" \
  -H "stripe-signature: test" \
  -d '{"test": true}'

# Erwartete Antwort: 403 Unauthorized IP address
```

## 📋 VALIDIERUNG DER FIXES

### Pre-Deployment Checklist
- [ ] Environment Variables konfiguriert
- [ ] RLS Migration getestet in Test-Umgebung  
- [ ] Stripe Webhook Test mit gültiger Signatur
- [ ] IP-Validierung funktioniert
- [ ] Alle Tests in CI/CD pipeline bestanden

### Post-Deployment Validation
```bash
# 1. RLS-Policies validieren
psql -h db.your-project.supabase.co -p 5432 -d postgres -U postgres -c "
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual 
FROM pg_policies 
WHERE schemaname IN ('test', 'prod');
"

# 2. Webhook-Endpunkt testen
curl -X POST https://your-project.supabase.co/functions/v1/handleStripeWebhook \
  -H "stripe-signature: t=timestamp,v1=signature" \
  -H "x-forwarded-for: 3.18.12.63" \
  -d '{}'

# 3. Rate Limiting testen (mehrere Requests schnell hintereinander)
for i in {1..15}; do
  curl -X POST https://your-project.supabase.co/functions/v1/activateDevice \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -d '{}' &
done
```

## 🔐 ENVIRONMENT VARIABLES SETUP

### Supabase Secrets konfigurieren
```bash
# Test Environment
npx supabase secrets set TEST_STRIPE_SECRET_KEY=sk_test_... --project-ref foqnvgvtyluvektevlab
npx supabase secrets set TEST_STRIPE_WEBHOOK_SECRET=whsec_test_... --project-ref foqnvgvtyluvektevlab

# Prod Environment  
npx supabase secrets set PROD_STRIPE_SECRET_KEY=sk_live_... --project-ref foqnvgvtyluvektevlab
npx supabase secrets set PROD_STRIPE_WEBHOOK_SECRET=whsec_live_... --project-ref foqnvgvtyluvektevlab

# Database URLs (falls nicht gesetzt)
npx supabase secrets set SUPABASE_URL=https://foqnvgvtyluvektevlab.supabase.co --project-ref foqnvgvtyluvektevlab
npx supabase secrets set SUPABASE_SERVICE_ROLE_KEY=eyJ... --project-ref foqnvgvtyluvektevlab
```

### Lokale Development Setup
```bash
# .env.local erstellen (NICHT committen!)
cat > .env.local << EOF
SUPABASE_URL=http://localhost:54321
SUPABASE_ANON_KEY=your_local_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_local_service_role_key
TEST_STRIPE_SECRET_KEY=sk_test_...
TEST_STRIPE_WEBHOOK_SECRET=whsec_test_...
LICENSE_ENCRYPTION_KEY=your_32_char_encryption_key
DEVICE_ID_SALT=your_device_id_salt
EOF
```

## ⚡ MONITORING & ALERTING

### 1. Security Monitoring einrichten
```sql
-- Supabase Dashboard → Logs & Analytics
-- Alert für fehlgeschlagene Webhook-Versuche
SELECT timestamp, level, msg 
FROM edge_logs 
WHERE msg LIKE '%SECURITY%' 
   OR msg LIKE '%Invalid IP%'
   OR status_code IN (401, 403, 429)
ORDER BY timestamp DESC LIMIT 100;
```

### 2. Rate Limiting Monitoring
```sql
-- Monitor für Rate Limit Hits
SELECT 
  DATE_TRUNC('hour', timestamp) as hour,
  COUNT(*) as rate_limit_hits
FROM edge_logs 
WHERE status_code = 429
GROUP BY hour
ORDER BY hour DESC;
```

### 3. Failed Authentication Attempts
```sql
-- Monitor für Auth-Failures
SELECT 
  timestamp,
  request_id,
  remote_addr,
  msg
FROM edge_logs 
WHERE level = 'ERROR' 
  AND msg LIKE '%Unauthorized%'
ORDER BY timestamp DESC;
```

## 📊 ROLLBACK PLAN

### Falls Probleme auftreten:

#### 1. RLS Rollback
```sql
-- RLS temporär deaktivieren (NUR NOTFALL!)
ALTER TABLE test.licenses DISABLE ROW LEVEL SECURITY;
ALTER TABLE prod.licenses DISABLE ROW LEVEL SECURITY;
ALTER TABLE test.device_activations DISABLE ROW LEVEL SECURITY;  
ALTER TABLE prod.device_activations DISABLE ROW LEVEL SECURITY;
```

#### 2. Webhook Function Rollback
```bash
# Vorherige Version deployen
git checkout HEAD~1
npx supabase functions deploy handleStripeWebhook --project-ref foqnvgvtyluvektevlab
```

#### 3. Environment Variables Rollback
```bash
# Secrets entfernen
npx supabase secrets unset TEST_STRIPE_WEBHOOK_SECRET --project-ref foqnvgvtyluvektevlab
npx supabase secrets unset PROD_STRIPE_WEBHOOK_SECRET --project-ref foqnvgvtyluvektevlab
```

## 🎯 SUCCESS CRITERIA

### Die Deployment ist erfolgreich wenn:
- [ ] Alle Stripe Webhooks funktionieren (Test & Prod)
- [ ] RLS verhindert Cross-User-Datenzugriff  
- [ ] Rate Limiting funktioniert (429 bei Überschreitung)
- [ ] IP-Validierung blockt ungültige IPs
- [ ] Keine Fehler in Supabase Logs
- [ ] Alle bestehenden Tests bestehen
- [ ] Performance nicht beeinträchtigt

## 📞 SUPPORT & ESKALATION

### Bei Problemen kontaktieren:
1. **Stripe Support**: docs.stripe.com/webhooks/troubleshooting
2. **Supabase Support**: supabase.com/support  
3. **Security Team**: Bei verdächtigen Aktivitäten sofort eskalieren

### Wichtige Links:
- [Supabase RLS Docs](https://supabase.com/docs/guides/auth/row-level-security)
- [Stripe Webhook Security](https://stripe.com/docs/webhooks/signatures)
- [OWASP Security Guidelines](https://owasp.org/www-project-top-ten/)

---

**⚠️ WICHTIG**: Teste alle Änderungen zuerst in der Test-Umgebung bevor Production-Deployment!