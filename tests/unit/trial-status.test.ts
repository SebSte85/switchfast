import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mockSupabaseClient, TEST_CONSTANTS } from '../setup'

describe('Trial Status Management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Neuer Trial', () => {
    it('sollte einen neuen 7-Tage-Trial für unbekannte Device erstellen', async () => {
      // Arrange
      const mockTrialInsert = vi.fn().mockResolvedValue({
        data: {
          device_id: TEST_CONSTANTS.DEVICE_ID,
          trial_start_date: new Date().toISOString(),
          trial_end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          is_trial_used: false,
          privacy_consent_given: false,
        },
        error: null,
      })

      mockSupabaseClient.from.mockImplementation((table: string) => {
        if (table === 'trial_blocks') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: null, // Kein existierender Trial
                  error: null,
                }),
              }),
            }),
            insert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: mockTrialInsert,
              }),
            }),
          }
        }
      })

      // Act - Simuliere Aufruf der checkTrialStatus Function
      const result = await simulateTrialStatusCheck(TEST_CONSTANTS.DEVICE_ID)

      // Assert
      expect(mockTrialInsert).toHaveBeenCalled()
      expect(result).toEqual({
        success: true,
        is_trial_active: true,
        remaining_days: 7,
        privacy_consent_given: false,
        message: 'Trial gestartet',
      })
    })

    it('sollte korrekte Trial-Dauer von genau 7 Tagen setzen', async () => {
      // Arrange
      const startDate = new Date('2024-01-01T10:00:00Z')
      vi.setSystemTime(startDate)

      const expectedEndDate = new Date(startDate)
      expectedEndDate.setDate(expectedEndDate.getDate() + 7)

      const mockTrialInsert = vi.fn().mockResolvedValue({
        data: {
          device_id: TEST_CONSTANTS.DEVICE_ID,
          trial_start_date: startDate.toISOString(),
          trial_end_date: expectedEndDate.toISOString(),
          is_trial_used: false,
          privacy_consent_given: false,
        },
        error: null,
      })

      mockSupabaseClient.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: mockTrialInsert,
          }),
        }),
      }))

      // Act
      await simulateTrialStatusCheck(TEST_CONSTANTS.DEVICE_ID)

      // Assert
      const insertCall = mockTrialInsert.mock.calls[0]?.[0]
      expect(insertCall?.trial_end_date).toBe(expectedEndDate.toISOString())

      vi.useRealTimers()
    })
  })

  describe('Aktiver Trial', () => {
    it('sollte verbleibende Tage korrekt berechnen', async () => {
      // Arrange
      const now = new Date('2024-01-03T10:00:00Z') // 2 Tage nach Start
      const startDate = new Date('2024-01-01T10:00:00Z')
      const endDate = new Date('2024-01-08T10:00:00Z') // 7 Tage Trial
      
      vi.setSystemTime(now)

      const trialData = {
        device_id: TEST_CONSTANTS.DEVICE_ID,
        trial_start_date: startDate.toISOString(),
        trial_end_date: endDate.toISOString(),
        is_trial_used: false,
        privacy_consent_given: true,
      }

      mockSupabaseClient.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: trialData,
              error: null,
            }),
          }),
        }),
      }))

      // Act
      const result = await simulateTrialStatusCheck(TEST_CONSTANTS.DEVICE_ID)

      // Assert
      expect(result).toEqual({
        success: true,
        is_trial_active: true,
        trial_start_date: startDate.toISOString(),
        trial_end_date: endDate.toISOString(),
        remaining_days: 5, // 5 Tage verbleibend
        privacy_consent_given: true,
        message: 'Trial ist aktiv',
      })

      vi.useRealTimers()
    })

    it('sollte am letzten Tag noch aktiv sein', async () => {
      // Arrange
      const startDate = new Date('2024-01-01T10:00:00Z')
      const endDate = new Date('2024-01-08T10:00:00Z')
      const lastDay = new Date('2024-01-07T23:59:59Z') // Letzter Tag, kurz vor Ablauf
      
      vi.setSystemTime(lastDay)

      mockSupabaseClient.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                trial_start_date: startDate.toISOString(),
                trial_end_date: endDate.toISOString(),
                is_trial_used: false,
              },
              error: null,
            }),
          }),
        }),
      }))

      // Act
      const result = await simulateTrialStatusCheck(TEST_CONSTANTS.DEVICE_ID)

      // Assert
      expect(result.is_trial_active).toBe(true)
      expect(result.remaining_days).toBe(1)

      vi.useRealTimers()
    })
  })

  describe('Abgelaufener Trial', () => {
    it('sollte Trial nach 7 Tagen als abgelaufen markieren und blockieren', async () => {
      // Arrange
      const startDate = new Date('2024-01-01T10:00:00Z')
      const endDate = new Date('2024-01-08T10:00:00Z')
      const expiredDate = new Date('2024-01-09T10:00:00Z') // 1 Tag nach Ablauf
      
      vi.setSystemTime(expiredDate)

      const mockUpdate = vi.fn().mockResolvedValue({
        data: null,
        error: null,
      })

      mockSupabaseClient.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                trial_start_date: startDate.toISOString(),
                trial_end_date: endDate.toISOString(),
                is_trial_used: false,
                privacy_consent_given: true,
              },
              error: null,
            }),
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: mockUpdate,
        }),
      }))

      // Act
      const result = await simulateTrialStatusCheck(TEST_CONSTANTS.DEVICE_ID)

      // Assert
      expect(mockUpdate).toHaveBeenCalledWith({ is_trial_used: true })
      expect(result).toEqual({
        success: true,
        is_trial_active: false,
        trial_start_date: startDate.toISOString(),
        trial_end_date: endDate.toISOString(),
        remaining_days: 0,
        privacy_consent_given: true,
        message: 'Trial ist abgelaufen',
      })

      vi.useRealTimers()
    })

    it('sollte bereits verwendeten Trial blockieren', async () => {
      // Arrange
      const trialData = {
        device_id: TEST_CONSTANTS.DEVICE_ID,
        trial_start_date: new Date('2024-01-01').toISOString(),
        trial_end_date: new Date('2024-01-08').toISOString(),
        is_trial_used: true, // Bereits verwendet
        privacy_consent_given: true,
      }

      mockSupabaseClient.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: trialData,
              error: null,
            }),
          }),
        }),
      }))

      // Act
      const result = await simulateTrialStatusCheck(TEST_CONSTANTS.DEVICE_ID)

      // Assert
      expect(result).toEqual({
        success: true,
        is_trial_active: false,
        trial_start_date: trialData.trial_start_date,
        trial_end_date: trialData.trial_end_date,
        remaining_days: 0,
        privacy_consent_given: true,
        message: 'Trial wurde bereits verwendet',
      })
    })
  })

  describe('Fehlerbehandlung', () => {
    it('sollte Fehler bei fehlender Device-ID behandeln', async () => {
      // Act & Assert
      await expect(simulateTrialStatusCheck('')).rejects.toThrow()
    })

    it('sollte Datenbankfehler korrekt behandeln', async () => {
      // Arrange
      mockSupabaseClient.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database connection failed', code: 'DB_ERROR' },
            }),
          }),
        }),
      }))

      // Act & Assert
      await expect(simulateTrialStatusCheck(TEST_CONSTANTS.DEVICE_ID)).rejects.toThrow()
    })

    it('sollte Fehler beim Trial-Erstellen behandeln', async () => {
      // Arrange
      mockSupabaseClient.from.mockImplementation(() => ({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Insert failed', code: 'INSERT_ERROR' },
            }),
          }),
        }),
      }))

      // Act & Assert
      await expect(simulateTrialStatusCheck(TEST_CONSTANTS.DEVICE_ID)).rejects.toThrow()
    })
  })
})

// Hilfsfunktion zur Simulation der Trial Status Check Function
async function simulateTrialStatusCheck(deviceId: string) {
  if (!deviceId) {
    throw new Error('Fehlende Geräte-ID')
  }

  // Simuliere die Logik der checkTrialStatus Supabase Function
  const trialQuery = await mockSupabaseClient
    .from('trial_blocks')
    .select('*')
    .eq('device_id', deviceId)
    .maybeSingle()

  if (trialQuery.error) {
    throw new Error(`Fehler beim Abrufen des Trial-Status: ${trialQuery.error.message}`)
  }

  const trialData = trialQuery.data

  // Neuen Trial erstellen wenn keiner existiert
  if (!trialData) {
    const trialStartDate = new Date()
    const trialEndDate = new Date(trialStartDate)
    trialEndDate.setDate(trialEndDate.getDate() + TEST_CONSTANTS.TRIAL_DAYS)

    const insertResult = await mockSupabaseClient
      .from('trial_blocks')
      .insert({
        device_id: deviceId,
        trial_start_date: trialStartDate.toISOString(),
        trial_end_date: trialEndDate.toISOString(),
        is_trial_used: false,
        privacy_consent_given: false,
      })
      .select('*')
      .maybeSingle()

    if (insertResult.error) {
      throw new Error(`Fehler beim Erstellen des Trial-Status: ${insertResult.error.message}`)
    }

    return {
      success: true,
      is_trial_active: true,
      remaining_days: TEST_CONSTANTS.TRIAL_DAYS,
      privacy_consent_given: false,
      message: 'Trial gestartet',
    }
  }

  // Prüfen ob Trial bereits verwendet wurde
  if (trialData.is_trial_used) {
    return {
      success: true,
      is_trial_active: false,
      trial_start_date: trialData.trial_start_date,
      trial_end_date: trialData.trial_end_date,
      remaining_days: 0,
      privacy_consent_given: trialData.privacy_consent_given,
      message: 'Trial wurde bereits verwendet',
    }
  }

  // Prüfen ob Trial abgelaufen ist
  const now = new Date()
  const trialEndDate = new Date(trialData.trial_end_date)

  if (now > trialEndDate) {
    // Trial als verwendet markieren
    await mockSupabaseClient
      .from('trial_blocks')
      .update({ is_trial_used: true })
      .eq('device_id', deviceId)

    return {
      success: true,
      is_trial_active: false,
      trial_start_date: trialData.trial_start_date,
      trial_end_date: trialData.trial_end_date,
      remaining_days: 0,
      privacy_consent_given: trialData.privacy_consent_given,
      message: 'Trial ist abgelaufen',
    }
  }

  // Trial ist aktiv - verbleibende Tage berechnen
  const remainingDays = Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  return {
    success: true,
    is_trial_active: true,
    trial_start_date: trialData.trial_start_date,
    trial_end_date: trialData.trial_end_date,
    remaining_days: remainingDays,
    privacy_consent_given: trialData.privacy_consent_given,
    message: 'Trial ist aktiv',
  }
}