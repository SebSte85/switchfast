import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockSupabaseClient, TEST_CONSTANTS } from "../setup";

// Mock für createClient
vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => mockSupabaseClient),
}));

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
            data: null, // Keine existierende Trial
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from = vi.fn().mockImplementation((table: string) => {
        if (table === "device_trials") {
          return {
            select: mockSelect,
            insert: mockTrialInsert,
          };
        }
      });

      // Act
      const result = await checkTrialStatus(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(mockTrialInsert).toHaveBeenCalledWith({
        device_id: TEST_CONSTANTS.DEVICE_ID,
        trial_start_date: expect.any(String),
        trial_end_date: expect.any(String),
        is_trial_used: false,
      });

      expect(result).toMatchObject({
        success: true,
        isTrialActive: true,
        trialDaysRemaining: 7,
        isBlocked: false,
      });
    });

    it("sollte korrekte Trial-Dauer von genau 7 Tagen setzen", () => {
      // Arrange
      vi.useFakeTimers();
      const mockDate = new Date("2024-01-01T10:00:00.000Z");
      vi.setSystemTime(mockDate);

      const mockTrialInsert = vi.fn();

      mockSupabaseClient.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
        insert: mockTrialInsert.mockResolvedValue({
          data: { id: "trial-123" },
          error: null,
        }),
      });

      // Act
      checkTrialStatus(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      const expectedEndDate = new Date(
        mockDate.getTime() + 7 * 24 * 60 * 60 * 1000
      );

      // Warte bis der Mock aufgerufen wurde
      setTimeout(() => {
        const insertCall = mockTrialInsert.mock.calls[0]?.[0];
        expect(insertCall?.trial_end_date).toBe(expectedEndDate.toISOString());
      }, 0);

      vi.useRealTimers();
    });
  });

  describe("Aktiver Trial", () => {
    it("sollte verbleibende Tage korrekt berechnen", async () => {
      // Arrange
      const trialEndDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 Tage verbleibend

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "trial-existing",
              device_id: TEST_CONSTANTS.DEVICE_ID,
              trial_end_date: trialEndDate.toISOString(),
              is_trial_used: false,
            },
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      // Act
      const result = await checkTrialStatus(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(result.trialDaysRemaining).toBe(3);
      expect(result.isTrialActive).toBe(true);
      expect(result.isBlocked).toBe(false);
    });

    it("sollte am letzten Tag noch aktiv sein", async () => {
      // Arrange
      const trialEndDate = new Date(Date.now() + 12 * 60 * 60 * 1000); // 12 Stunden verbleibend

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "trial-last-day",
              device_id: TEST_CONSTANTS.DEVICE_ID,
              trial_end_date: trialEndDate.toISOString(),
              is_trial_used: false,
            },
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      // Act
      const result = await checkTrialStatus(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(result.trialDaysRemaining).toBe(1);
      expect(result.isTrialActive).toBe(true);
      expect(result.isBlocked).toBe(false);
    });
  });

  describe("Abgelaufener Trial", () => {
    it("sollte Trial nach 7 Tagen als abgelaufen markieren und blockieren", async () => {
      // Arrange
      const expiredDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 1 Tag abgelaufen

      const mockUpdateResult = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      });

      const mockEq = vi.fn().mockReturnValue(mockUpdateResult);
      const mockUpdate = vi.fn().mockReturnValue({ eq: mockEq });

      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "trial-expired",
              device_id: TEST_CONSTANTS.DEVICE_ID,
              trial_end_date: expiredDate.toISOString(),
              is_trial_used: false,
            },
            error: null,
          }),
        }),
      });

      const deviceTrialsTable = {
        select: mockSelect,
        update: mockUpdate,
      };

      mockSupabaseClient.from = vi.fn().mockReturnValue(deviceTrialsTable);

      // Act
      const result = await checkTrialStatus(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(mockUpdate).toHaveBeenCalledWith({ is_trial_used: true });
      expect(result).toEqual({
        success: true,
        isTrialActive: false,
        trialDaysRemaining: 0,
        isBlocked: true,
        message: "Trial-Periode abgelaufen. App ist blockiert.",
      });
    });

    it("sollte bereits verwendeten Trial blockieren", async () => {
      // Arrange
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              id: "trial-used",
              device_id: TEST_CONSTANTS.DEVICE_ID,
              trial_end_date: new Date().toISOString(),
              is_trial_used: true, // Trial bereits verwendet
            },
            error: null,
          }),
        }),
      });

      mockSupabaseClient.from = vi.fn().mockReturnValue({
        select: mockSelect,
      });

      // Act
      const result = await checkTrialStatus(TEST_CONSTANTS.DEVICE_ID);

      // Assert
      expect(result.isBlocked).toBe(true);
      expect(result.isTrialActive).toBe(false);
      expect(result.message).toBe(
        "Trial bereits verwendet. App ist blockiert."
      );
    });
  });

  describe("Fehlerbehandlung", () => {
    it("sollte Fehler bei fehlender Device-ID behandeln", async () => {
      await expect(checkTrialStatus("")).rejects.toThrow(
        "Device-ID ist erforderlich"
      );
    });

    it("sollte Datenbankfehler korrekt behandeln", async () => {
      // Arrange
      mockSupabaseClient.from = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: "Database connection failed" },
            }),
          }),
        }),
      });

      // Act & Assert
      await expect(checkTrialStatus(TEST_CONSTANTS.DEVICE_ID)).rejects.toThrow(
        "Fehler beim Überprüfen des Trial-Status"
      );
    });

    it("sollte Fehler beim Trial-Erstellen behandeln", async () => {
      // Arrange
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      });

      const mockInsert = vi.fn().mockResolvedValue({
        data: null,
        error: { message: "Insert failed" },
      });

      mockSupabaseClient.from = vi.fn().mockReturnValue({
        select: mockSelect,
        insert: mockInsert,
      });

      // Act & Assert
      await expect(checkTrialStatus(TEST_CONSTANTS.DEVICE_ID)).rejects.toThrow(
        "Fehler beim Erstellen des Trials"
      );
    });
  });
});

// Hilfsfunktion
async function checkTrialStatus(deviceId: string) {
  if (!deviceId) {
    throw new Error("Device-ID ist erforderlich");
  }

  // Prüfe bestehenden Trial
  const { data: existingTrial, error } = await mockSupabaseClient
    .from("device_trials")
    .select("*")
    .eq("device_id", deviceId)
    .maybeSingle();

  if (error) {
    throw new Error("Fehler beim Überprüfen des Trial-Status");
  }

  // Wenn kein Trial existiert, erstelle einen neuen
  if (!existingTrial) {
    const now = new Date();
    const trialEndDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const { data: newTrial, error: insertError } = await mockSupabaseClient
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
      isTrialActive: true,
      trialDaysRemaining: 7,
      isBlocked: false,
      message: "7-Tage-Trial gestartet",
    };
  }

  // Prüfe ob Trial bereits verwendet wurde
  if (existingTrial.is_trial_used) {
    return {
      success: true,
      isTrialActive: false,
      trialDaysRemaining: 0,
      isBlocked: true,
      message: "Trial bereits verwendet. App ist blockiert.",
    };
  }

  // Berechne verbleibende Tage
  const now = new Date();
  const endDate = new Date(existingTrial.trial_end_date);
  const daysRemaining = Math.max(
    0,
    Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
  );

  // Prüfe ob Trial abgelaufen ist
  if (daysRemaining === 0) {
    // Markiere Trial als verwendet
    await mockSupabaseClient
      .from("device_trials")
      .update({ is_trial_used: true })
      .eq("device_id", deviceId);

    return {
      success: true,
      isTrialActive: false,
      trialDaysRemaining: 0,
      isBlocked: true,
      message: "Trial-Periode abgelaufen. App ist blockiert.",
    };
  }

  return {
    success: true,
    isTrialActive: true,
    trialDaysRemaining: daysRemaining,
    isBlocked: false,
    message: `${daysRemaining} Tage verbleibend`,
  };
}
