/**
 * Formatting and validation utilities for Okada Book Ghana
 */

/**
 * Standardize Ghana phone number display (+233 or 0XX XXX XXXX)
 */
export function formatGhanaPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('233') && cleaned.length === 12) {
    return `+233 ${cleaned.slice(3, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`;
  }
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  }
  return phone;
}

/**
 * Basic Ghana phone number validation (10 digits starting with 0, or 12 starting with 233)
 */
export function isValidGhanaPhone(phone: string): boolean {
  const cleaned = phone.replace(/\D/g, '');
  return (
    (cleaned.startsWith('0') && cleaned.length === 10) ||
    (cleaned.startsWith('233') && cleaned.length === 12)
  );
}
