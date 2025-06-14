import { describe, it, expect } from "vitest";
import { TEST_CONSTANTS } from "../setup";

describe("Test Setup", () => {
  it("sollte Test-Konstanten korrekt laden", () => {
    expect(TEST_CONSTANTS.DEVICE_ID).toBe("test-device-12345");
    expect(TEST_CONSTANTS.EMAIL).toBe("test@example.com");
    expect(TEST_CONSTANTS.LICENSE_KEY).toBe("SF-TEST-1234-5678");
    expect(TEST_CONSTANTS.TRIAL_DAYS).toBe(7);
  });

  it("sollte grundlegende JavaScript-Features funktionieren", () => {
    const testArray = [1, 2, 3];
    const doubled = testArray.map((x) => x * 2);

    expect(doubled).toEqual([2, 4, 6]);
  });

  it("sollte async/await funktionieren", async () => {
    const asyncFunction = async () => {
      return Promise.resolve("success");
    };

    const result = await asyncFunction();
    expect(result).toBe("success");
  });

  it("sollte Date-Berechnungen funktionieren", () => {
    const now = new Date("2024-01-01T10:00:00Z");
    const future = new Date(now);
    future.setDate(future.getDate() + 7);

    const diffInDays = Math.ceil(
      (future.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );
    expect(diffInDays).toBe(7);
  });

  it("sollte Umgebungsvariablen verfügbar sein", () => {
    // Diese sollten durch .env.test geladen werden
    expect(process.env.NODE_ENV).toBeDefined();
  });
});
