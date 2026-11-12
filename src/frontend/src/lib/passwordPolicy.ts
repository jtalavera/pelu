/**
 * Mirrors the backend password policy (`AuthService#validatePasswordStrength`, HU-23 AC-8): at
 * least 8 characters with an uppercase letter, a lowercase letter, a digit and a special character.
 * Checked before submitting so a weak password gets a field error instead of a server round-trip.
 */
const SPECIAL = /[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/;

export function isStrongPassword(password: string): boolean {
  return (
    password.length >= 8 &&
    /[A-Z]/.test(password) &&
    /[a-z]/.test(password) &&
    /[0-9]/.test(password) &&
    SPECIAL.test(password)
  );
}
