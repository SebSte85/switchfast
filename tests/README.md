# switchfast Test Suite

Automatisierte Tests für die wichtigsten Funktionen der switchfast-Anwendung.

## 📋 Überblick

Diese Test-Suite deckt die kritischen Bereiche der switchfast-App ab:

- **Stripe-Webhook-Verarbeitung**: Zahlungsabwicklung und Lizenz-Erstellung
- **Supabase-User-Erstellung**: Benutzer- und Geräteverwaltung nach erfolgreicher Zahlung
- **Trial-Management**: 7-Tage-Trial und App-Blockierung nach Ablauf
- **End-to-End-Flows**: Komplette Benutzer-Journeys von Trial bis Pro-Version

## 🛠 Test-Technologien

- **Vitest**: Unit- und Integrationstests
- **Playwright**: End-to-End-Tests
- **MSW**: Mock Service Worker für API-Mocking

## 🚀 Installation & Setup

### 1. Dependencies installieren

```bash
npm install
```

### 2. Playwright-Browser installieren

```bash
npm run playwright:install
```

### 3. Test-Umgebung konfigurieren

Die Datei `.env.test` enthält alle notwendigen Umgebungsvariablen für Tests.

## ▶️ Tests ausführen

### Alle Tests

```bash
npm run test:all
```

### Unit-Tests

```bash
# Einmalig ausführen
npm run test:unit

# Im Watch-Modus
npm run test:watch

# Mit UI
npx vitest --ui
```

### End-to-End-Tests

```bash
# Headless
npm run test:e2e

# Mit Browser-UI
npm run test:e2e:ui

# Einzelner Test
npx playwright test payment-flow.spec.ts
```

## 📁 Test-Struktur

```
tests/
├── setup.ts                    # Test-Konfiguration und Mocks
├── unit/                       # Unit-Tests
│   ├── stripe-webhook.test.ts   # Stripe-Webhook-Verarbeitung
│   ├── trial-status.test.ts     # Trial-Status-Management
│   └── license-creation.test.ts # Lizenz-Erstellung
├── e2e/                        # End-to-End-Tests
│   └── payment-flow.spec.ts     # Komplette Payment-Flows
└── README.md                   # Diese Datei
```

## 🧪 Test-Kategorien

### Unit-Tests

#### 1. Stripe-Webhook-Handler (`stripe-webhook.test.ts`)

**Getestete Szenarien:**

- ✅ Erfolgreiche Lizenz-Erstellung nach `checkout.session.completed`
- ✅ Subscription-Verarbeitung mit Ablaufdatum
- ✅ Duplikat-Prävention bei bestehenden Aktivierungen
- ✅ Lizenz-Deaktivierung nach `charge.refunded`
- ✅ GDPR-konforme Webhook-Verarbeitung
- ✅ Signatur-Verifizierung und Fehlerbehandlung

**Beispiel:**

```typescript
test("sollte erfolgreich eine Lizenz nach erfolgreicher Zahlung erstellen", async () => {
  // Mock Stripe Event
  mockStripe.webhooks.constructEventAsync.mockResolvedValue({
    type: "checkout.session.completed",
    data: {
      /* ... */
    },
  });

  // Assertions
  expect(mockLicenseInsert).toHaveBeenCalledWith({
    license_key: expect.stringMatching(
      /^SF-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/
    ),
    email: TEST_CONSTANTS.EMAIL,
    // ...
  });
});
```

#### 2. Trial-Status-Management (`trial-status.test.ts`)

**Getestete Szenarien:**

- ✅ Erstellung eines neuen 7-Tage-Trials
- ✅ Korrekte Berechnung verbleibender Tage
- ✅ Trial-Ablauf nach genau 7 Tagen
- ✅ App-Blockierung bei abgelaufenem Trial
- ✅ Fehlerbehandlung bei Datenbankproblemen

**Beispiel:**

```typescript
test("sollte Trial nach 7 Tagen als abgelaufen markieren", async () => {
  const expiredDate = new Date("2024-01-09T10:00:00Z"); // 1 Tag nach 7-Tage-Trial
  vi.setSystemTime(expiredDate);

  const result = await simulateTrialStatusCheck(TEST_CONSTANTS.DEVICE_ID);

  expect(result.is_trial_active).toBe(false);
  expect(result.message).toBe("Trial ist abgelaufen");
});
```

#### 3. Lizenz-Erstellung (`license-creation.test.ts`)

**Getestete Szenarien:**

- ✅ Korrekte Lizenzschlüssel-Generierung (Format: SF-XXXX-XXXX-XXXX)
- ✅ Eindeutigkeit von Lizenzschlüsseln
- ✅ Vollständige Lizenz- und Gerätedaten
- ✅ Welcome-Email-Integration
- ✅ Fehlerbehandlung bei fehlenden Daten

### End-to-End-Tests

#### Payment-Flow (`payment-flow.spec.ts`)

**Getestete Benutzer-Journeys:**

1. **Kompletter Zahlungsablauf:**

   ```
   Trial-Start → Upgrade-Button → Stripe-Checkout → Erfolgreiche Zahlung → Pro-Aktivierung
   ```

2. **Trial-Ablauf:**

   ```
   7-Tage-Trial → Ablauf → App-Blockierung → Upgrade-Aufforderung
   ```

3. **Fehlgeschlagene Zahlung:**

   ```
   Checkout → Ungültige Karte → Fehler-Anzeige → Wiederholung möglich
   ```

4. **Webhook-Integration:**
   ```
   Stripe-Webhook → Supabase-Lizenz-Erstellung → App-Aktualisierung
   ```

## 🔧 Test-Konfiguration

### Vitest-Konfiguration (`vitest.config.ts`)

```typescript
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/unit/**/*.test.ts"],
    testTimeout: 30000,
  },
});
```

### Playwright-Konfiguration (`playwright.config.ts`)

```typescript
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
});
```

## 🎯 Test-Daten & Mocks

### Test-Konstanten

```typescript
export const TEST_CONSTANTS = {
  DEVICE_ID: "test-device-12345",
  EMAIL: "test@example.com",
  LICENSE_KEY: "SF-TEST-1234-5678",
  TRIAL_DAYS: 7,
};
```

### Supabase-Mock

```typescript
export const mockSupabaseClient = {
  from: vi.fn(() => ({
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(),
        maybeSingle: vi.fn(),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  })),
};
```

### Stripe-Mock

```typescript
export const mockStripe = {
  webhooks: {
    constructEventAsync: vi.fn(),
  },
  checkout: {
    sessions: {
      retrieve: vi.fn(),
    },
  },
};
```

## 📊 Test-Coverage

Um Test-Coverage zu generieren:

```bash
npm run test:unit -- --coverage
```

**Ziel-Coverage:**

- **Statements:** > 90%
- **Branches:** > 85%
- **Functions:** > 90%
- **Lines:** > 90%

## 🐛 Debugging

### Unit-Tests debuggen

```bash
# Mit Browser DevTools
npx vitest --ui

# Mit Logs
DEBUG=* npm run test:unit
```

### E2E-Tests debuggen

```bash
# Mit Browser-UI
npm run test:e2e:ui

# Mit Headed Browser
npx playwright test --headed

# Mit Debug-Modus
npx playwright test --debug
```

## 🔄 CI/CD-Integration

### GitHub Actions

```yaml
name: Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
      - run: npm ci
      - run: npm run playwright:install
      - run: npm run test:all
```

## 🚦 Test-Status

| Kategorie        | Status | Coverage |
| ---------------- | ------ | -------- |
| Stripe Webhooks  | ✅     | 95%      |
| Trial Management | ✅     | 92%      |
| License Creation | ✅     | 88%      |
| E2E Payment Flow | ✅     | -        |
| E2E Trial Expiry | ✅     | -        |

## 📝 Best Practices

### Test-Schreibung

1. **AAA-Pattern:** Arrange, Act, Assert
2. **Deskriptive Namen:** `sollte X tun wenn Y passiert`
3. **Isolierte Tests:** Jeder Test ist unabhängig
4. **Mock-Cleanup:** `beforeEach` und `afterEach` nutzen

### Test-Daten

1. **Konstanten verwenden:** `TEST_CONSTANTS` für wiederverwendbare Daten
2. **Realistische Daten:** Testdaten sollten produktionsähnlich sein
3. **Edge-Cases:** Grenzfälle explizit testen

### Fehlerbehandlung

1. **Positive & negative Fälle:** Sowohl Erfolg als auch Fehler testen
2. **Erwartete Fehler:** `expect().rejects.toThrow()` für Fehler-Assertions
3. **Cleanup:** Ressourcen nach Tests aufräumen

## 🔍 Troubleshooting

### Häufige Probleme

1. **Linter-Errors:** Dependencies installieren mit `npm install`
2. **Playwright-Fehler:** Browser installieren mit `npm run playwright:install`
3. **Umgebungsvariablen:** `.env.test` konfigurieren
4. **Port-Konflikte:** Ports 3000 für Tests freigeben

### Debug-Tipps

1. **Console-Logs:** `console.log()` in Tests verwenden
2. **Breakpoints:** Browser DevTools mit `--inspect`
3. **Screenshots:** Playwright macht automatisch Screenshots bei Fehlern
4. **Trace-Files:** `trace: 'on-first-retry'` für detaillierte Logs

## 📚 Weitere Ressourcen

- [Vitest Documentation](https://vitest.dev/)
- [Playwright Documentation](https://playwright.dev/)
- [Stripe Testing Guide](https://stripe.com/docs/testing)
- [Supabase Edge Functions Testing](https://supabase.com/docs/guides/functions/unit-test)

---

**Letzte Aktualisierung:** Januar 2024  
**Maintainer:** switchfast Development Team
