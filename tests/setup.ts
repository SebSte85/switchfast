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

// Helper für Supabase Query Builder Mock
function createQueryBuilder() {
  const mockSelect = vi.fn(() => ({
    eq: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    })),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }));

  const mockInsert = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({
        data: { id: 1, license_key: "SF-TEST-1234-5678" },
        error: null,
      }),
    })),
    single: vi.fn().mockResolvedValue({
      data: { id: 1, license_key: "SF-TEST-1234-5678" },
      error: null,
    }),
  }));

  const mockUpdate = vi.fn(() => ({
    eq: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: null, error: null }),
      select: vi.fn(() => ({
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      })),
    })),
  }));

  return {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
  };
}

// Mock für Supabase Client
export const mockSupabaseClient = {
  from: vi.fn(() => createQueryBuilder()),
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
