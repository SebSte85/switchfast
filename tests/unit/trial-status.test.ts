import { describe, it, expect, vi, beforeEach } from "vitest";
import { mockSupabaseClient, TEST_CONSTANTS } from "../setup";

describe("Trial Status Management", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Neuer Trial", () => {
    it("sollte einen neuen 7-Tage-Trial für unbekannte Device erstellen", async () => {
      // Arrange
      const mockTrialInsert = vi.fn().mockResolvedValue({
        data: {
          id: "trial-123",
          device_id: TEST_CONSTANTS.DEVICE_ID,
          trial_start_date: new Date().toISOString(),
          trial_end_date: new Date(
            Date.now() + 7 * 24 * 60 * 60 * 1000
          ).toISOString(),
          is_trial_used: false,
        },
        error: null,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === "device_trials") {
          return {
            select: mockSelect,
            insert: mockTrialInsert,
          };
        }
        return {};
      });

      // Act
      const result = await createTrial(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(mockTrialInsert).toHaveBeenCalledWith({
        device_id: TEST_CONSTANTS.DEVICE_ID,
        trial_start_date: expect.any(String),
        trial_end_date: expect.any(String),
        is_trial_used: false,
      });

      expect(result.success).toBe(true);
      expect(result.trial_days_remaining).toBe(7);
      expect(result.is_trial_active).toBe(true);
    });

    it("sollte korrekte Trial-Dauer von genau 7 Tagen setzen", async () => {
      // Arrange
      const fixedDate = new Date("2024-01-01T10:00:00.000Z");
      const expectedEndDate = new Date("2024-01-08T10:00:00.000Z");

      vi.useFakeTimers();
      vi.setSystemTime(fixedDate);

      const mockTrialInsert = vi.fn().mockResolvedValue({
        data: {
          id: "trial-123",
          device_id: TEST_CONSTANTS.DEVICE_ID,
          trial_end_date: expectedEndDate.toISOString(),
        },
        error: null,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === "device_trials") {
          return {
            select: mockSelect,
            insert: mockTrialInsert,
          };
        }
        return {};
      });

      // Act
      await createTrial(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      const insertCall = mockTrialInsert.mock.calls[0]?.[0];
      expect(insertCall?.trial_end_date).toBe(expectedEndDate.toISOString());

      vi.useRealTimers();
    });
  });

  describe("Aktiver Trial", () => {
    it("sollte verbleibende Tage korrekt berechnen", async () => {
      // Arrange
      const now = new Date("2024-01-03T10:00:00.000Z");
      const trialEndDate = new Date("2024-01-08T10:00:00.000Z");

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "trial-123",
              device_id: TEST_CONSTANTS.DEVICE_ID,
              trial_end_date: trialEndDate.toISOString(),
              is_trial_used: false,
            },
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === "device_trials") {
          return { select: mockSelect };
        }
        return {};
      });

      // Act
      const result = await checkTrialStatus(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(result.trial_days_remaining).toBe(5);
      expect(result.is_trial_active).toBe(true);
      expect(result.can_use_app).toBe(true);

      vi.useRealTimers();
    });

    it("sollte am letzten Tag noch aktiv sein", async () => {
      // Arrange
      const now = new Date("2024-01-08T09:00:00.000Z");
      const trialEndDate = new Date("2024-01-08T23:59:59.999Z");

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "trial-123",
              device_id: TEST_CONSTANTS.DEVICE_ID,
              trial_end_date: trialEndDate.toISOString(),
              is_trial_used: false,
            },
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === "device_trials") {
          return { select: mockSelect };
        }
        return {};
      });

      // Act
      const result = await checkTrialStatus(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(result.trial_days_remaining).toBe(1);
      expect(result.is_trial_active).toBe(true);
      expect(result.can_use_app).toBe(true);

      vi.useRealTimers();
    });
  });

  describe("Abgelaufener Trial", () => {
    it("sollte Trial nach 7 Tagen als abgelaufen markieren und blockieren", async () => {
      // Arrange
      const now = new Date("2024-01-09T10:00:00.000Z");
      const trialEndDate = new Date("2024-01-08T10:00:00.000Z");

      vi.useFakeTimers();
      vi.setSystemTime(now);

      const mockUpdate = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "trial-123",
              device_id: TEST_CONSTANTS.DEVICE_ID,
              trial_end_date: trialEndDate.toISOString(),
              is_trial_used: false,
            },
            error: null,
          }),
        }),
      });

      const mockUpdateChain = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue(mockUpdate),
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === "device_trials") {
          return {
            select: mockSelect,
            update: mockUpdateChain,
          };
        }
        return {};
      });

      // Act
      const result = await checkTrialStatus(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(mockUpdateChain).toHaveBeenCalledWith({ is_trial_used: true });
      expect(result).toEqual({
        success: true,
        trial_days_remaining: 0,
        is_trial_active: false,
        can_use_app: false,
        message:
          "Trial-Periode ist abgelaufen. Bitte erwerben Sie eine Lizenz.",
      });

      vi.useRealTimers();
    });

    it("sollte bereits verwendeten Trial blockieren", async () => {
      // Arrange
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "trial-123",
              device_id: TEST_CONSTANTS.DEVICE_ID,
              trial_end_date: new Date(
                Date.now() + 24 * 60 * 60 * 1000
              ).toISOString(),
              is_trial_used: true,
            },
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === "device_trials") {
          return { select: mockSelect };
        }
        return {};
      });

      // Act
      const result = await checkTrialStatus(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(result).toEqual({
        success: true,
        trial_days_remaining: 0,
        is_trial_active: false,
        can_use_app: false,
        message: "Trial bereits verwendet. Bitte erwerben Sie eine Lizenz.",
      });
    });
  });

  describe("Fehlerbehandlung", () => {
    it("sollte Fehler bei fehlender Device-ID behandeln", async () => {
      // Act & Assert
      await expect(checkTrialStatus("")).rejects.toThrow(
        "Device-ID ist erforderlich"
      );
      await expect(createTrial("")).rejects.toThrow(
        "Device-ID ist erforderlich"
      );
    });

    it("sollte Datenbankfehler korrekt behandeln", async () => {
      // Arrange
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: {
              message: "Database connection failed",
              code: "CONNECTION_ERROR",
            },
          }),
        }),
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === "device_trials") {
          return { select: mockSelect };
        }
        return {};
      });

      // Act & Assert
      await expect(checkTrialStatus(TEST_CONSTANTS.DEVICE_ID)).rejects.toThrow(
        "Fehler beim Prüfen des Trial-Status"
      );
    });

    it("sollte Fehler beim Trial-Erstellen behandeln", async () => {
      // Arrange
      const mockTrialInsert = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Unique constraint violation", code: "23505" },
      });

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === "device_trials") {
          return {
            select: mockSelect,
            insert: mockTrialInsert,
          };
        }
        return {};
      });

      // Act & Assert
      await expect(createTrial(TEST_CONSTANTS.DEVICE_ID)).rejects.toThrow(
        "Fehler beim Erstellen des Trials"
      );
    });
  });
});

// Hilfsfunktionen für Tests
async function createTrial(deviceId: string) {
  if (!deviceId) {
    throw new Error("Device-ID ist erforderlich");
  }

  // Prüfe, ob bereits ein Trial existiert
  const { data: existingTrial, error: selectError } = await mockSupabaseClient
    .from("device_trials")
    .select("*")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (selectError) {
    throw new Error("Fehler beim Prüfen bestehender Trials");
  }

  if (existingTrial) {
    throw new Error("Trial bereits für diese Device erstellt");
  }

  // Erstelle neuen Trial
  const now = new Date();
  const trialEndDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const { data: trialData, error: insertError } = await mockSupabaseClient
    .from("device_trials")
    .insert({
      device_id: deviceId,
      trial_start_date: now.toISOString(),
      trial_end_date: trialEndDate.toISOString(),
      is_trial_used: false,
    });

  if (insertError) {
    throw new Error("Fehler beim Erstellen des Trials");
  }

  return {
    success: true,
    trial_days_remaining: 7,
    is_trial_active: true,
    can_use_app: true,
    message: "7-Tage-Trial erfolgreich gestartet",
  };
}

async function checkTrialStatus(deviceId: string) {
  if (!deviceId) {
    throw new Error("Device-ID ist erforderlich");
  }

  // Hole Trial-Information
  const { data: trial, error } = await mockSupabaseClient
    .from("device_trials")
    .select("*")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    throw new Error("Fehler beim Prüfen des Trial-Status");
  }

  if (!trial) {
    // Kein Trial gefunden - erlaube App-Nutzung für neuen Trial
    return {
      success: true,
      trial_days_remaining: 7,
      is_trial_active: false,
      can_use_app: true,
      message: "Neuer Trial kann gestartet werden",
    };
  }

  // Prüfe, ob Trial bereits verwendet wurde
  if (trial.is_trial_used) {
    return {
      success: true,
      trial_days_remaining: 0,
      is_trial_active: false,
      can_use_app: false,
      message: "Trial bereits verwendet. Bitte erwerben Sie eine Lizenz.",
    };
  }

  // Berechne verbleibende Tage
  const now = new Date();
  const trialEndDate = new Date(trial.trial_end_date);
  const daysRemaining = Math.ceil(
    (trialEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)
  );

  if (daysRemaining <= 0) {
    // Trial abgelaufen - markiere als verwendet
    await mockSupabaseClient
      .from("device_trials")
      .update({ is_trial_used: true })
      .eq("device_id", deviceId);

    return {
      success: true,
      trial_days_remaining: 0,
      is_trial_active: false,
      can_use_app: false,
      message: "Trial-Periode ist abgelaufen. Bitte erwerben Sie eine Lizenz.",
    };
  }

  return {
    success: true,
    trial_days_remaining: daysRemaining,
    is_trial_active: true,
    can_use_app: true,
    message: `Trial aktiv - ${daysRemaining} Tage verbleibend`,
  };
}
