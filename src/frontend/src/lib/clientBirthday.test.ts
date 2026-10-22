import { describe, expect, it } from "vitest";
import { ageOn, formatBirthday, isBirthdayOn, isValidBirthday, parseBirthdayYear } from "./clientBirthday";

const TODAY = new Date(2026, 9, 21); // 21/10/2026

describe("clientBirthday (HU-69)", () => {
  it("validates day + month together, optional year, real and not future dates", () => {
    expect(isValidBirthday({ day: null, month: null, year: null }, TODAY)).toBe(true);
    expect(isValidBirthday({ day: 15, month: 8, year: null }, TODAY)).toBe(true);
    expect(isValidBirthday({ day: 15, month: 8, year: 1990 }, TODAY)).toBe(true);
    expect(isValidBirthday({ day: 29, month: 2, year: null }, TODAY)).toBe(true);
    expect(isValidBirthday({ day: 15, month: null, year: null }, TODAY)).toBe(false);
    expect(isValidBirthday({ day: null, month: null, year: 1990 }, TODAY)).toBe(false);
    expect(isValidBirthday({ day: 31, month: 4, year: null }, TODAY)).toBe(false);
    expect(isValidBirthday({ day: 29, month: 2, year: 2001 }, TODAY)).toBe(false);
    expect(isValidBirthday({ day: 22, month: 10, year: 2026 }, TODAY)).toBe(false);
    expect(isValidBirthday({ day: 1, month: 1, year: 1899 }, TODAY)).toBe(false);
    expect(isValidBirthday({ day: 1, month: 1, year: parseBirthdayYear("90") }, TODAY)).toBe(false);
  });

  it("celebrates 29/02 on 28/02 in common years", () => {
    expect(isBirthdayOn(29, 2, new Date(2027, 1, 28))).toBe(true);
    expect(isBirthdayOn(29, 2, new Date(2028, 1, 28))).toBe(false);
    expect(isBirthdayOn(29, 2, new Date(2028, 1, 29))).toBe(true);
    expect(isBirthdayOn(21, 10, TODAY)).toBe(true);
  });

  it("computes age and formats the birthday", () => {
    expect(ageOn({ day: 21, month: 10, year: 1990 }, TODAY)).toBe(36);
    expect(ageOn({ day: 22, month: 10, year: 1990 }, TODAY)).toBe(35);
    expect(ageOn({ day: 22, month: 10, year: null }, TODAY)).toBeNull();
    expect(formatBirthday({ day: 15, month: 8, year: null }, "es-PY")).toBe("15 de agosto");
  });
});
