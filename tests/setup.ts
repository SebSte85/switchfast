import { vi } from "vitest";
import { config } from "dotenv";

// Lade Umgebungsvariablen für Tests
config({ path: ".env.test" });

// Mock für Electron-spezifische APIs
global.mockElectronAPIs = {
  ipcRenderer: {
    invoke: vi.fn(),
    send: vi.fn(),
    on: vi.fn(),
  },
};

// Mock für Supabase Client
export const mockSupabaseClient = {
  from: vi.fn(),
};

// Mock für Stripe
export const mockStripe = {
  checkout: {
    sessions: {
      retrieve: vi.fn(),
    },
  },
  webhooks: {
    constructEventAsync: vi.fn(),
  },
  subscriptions: {
    retrieve: vi.fn(),
  },
};

// Globale Test-Konstanten
export const TEST_CONSTANTS = {
  DEVICE_ID: "test-device-12345",
  EMAIL: "test@example.com",
  LICENSE_KEY: "SF-TEST-1234-5678",
  STRIPE_WEBHOOK_SECRET: "whsec_test_secret",
  TRIAL_DAYS: 7,
};
