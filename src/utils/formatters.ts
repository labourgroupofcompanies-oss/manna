/**
 * Formatting and validation utilities for Okada Book Ghana
 */

export interface PhoneValidationResult {
  isValid: boolean;
  error?: string;
  formatted?: string;
  carrier?: string;
}

/**
 * Standardize Ghana phone number display
 * Formats: "024 566 0622" or "+233 24 566 0622"
 */
export function formatGhanaPhone(phone: string): string {
  const cleaned = phone.replace(/[^\d+]/g, '');

  if (cleaned.startsWith('+233') && cleaned.length === 13) {
    return `+233 ${cleaned.slice(4, 6)} ${cleaned.slice(6, 9)} ${cleaned.slice(9)}`;
  }
  if (cleaned.startsWith('233') && cleaned.length === 12) {
    return `+233 ${cleaned.slice(3, 5)} ${cleaned.slice(5, 8)} ${cleaned.slice(8)}`;
  }
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  }
  return phone;
}

/**
 * Validate Ghanaian phone numbers
 * Valid prefixes:
 * - MTN: 024, 054, 055, 059, 053
 * - Telecel (Vodafone): 020, 050
 * - AT (AirtelTigo): 027, 057, 026, 056
 * - Landline/other: 030, 031, 032, 033, 034, 035, 036, 037, 038, 039
 */
export function validateGhanaPhone(phone: string): PhoneValidationResult {
  const trimmed = phone.trim();
  if (!trimmed) {
    return { isValid: false, error: 'Phone number is required.' };
  }

  // Remove non-digit characters except leading plus
  let normalized = trimmed.replace(/\s|-/g, '');

  if (normalized.startsWith('+233')) {
    normalized = '0' + normalized.slice(4);
  } else if (normalized.startsWith('233')) {
    normalized = '0' + normalized.slice(3);
  }

  // Must be 10 digits starting with 0
  if (!/^0\d{9}$/.test(normalized)) {
    if (normalized.length < 10) {
      return {
        isValid: false,
        error: `Incomplete phone number (${normalized.length}/10 digits). Example: 0245660622`
      };
    }
    return {
      isValid: false,
      error: 'Invalid format. Use a 10-digit Ghana number like 0245660622'
    };
  }

  const prefix = normalized.slice(0, 3);
  const validPrefixes = [
    '020', '050', // Telecel
    '024', '054', '055', '059', '053', // MTN
    '026', '056', '027', '057', // AT
    '030', '031', '032', '033', '034', '035', '036', '037', '038', '039' // Fixed / others
  ];

  if (!validPrefixes.includes(prefix)) {
    return {
      isValid: false,
      error: `Unknown network prefix "${prefix}". Please verify your number.`
    };
  }

  let carrier = 'Ghana Mobile';
  if (['024', '054', '055', '059', '053'].includes(prefix)) {
    carrier = 'MTN';
  } else if (['020', '050'].includes(prefix)) {
    carrier = 'Telecel';
  } else if (['026', '056', '027', '057'].includes(prefix)) {
    carrier = 'AT';
  }

  return {
    isValid: true,
    formatted: formatGhanaPhone(normalized),
    carrier
  };
}

/**
 * Backward compatibility helper
 */
export function isValidGhanaPhone(phone: string): boolean {
  return validateGhanaPhone(phone).isValid;
}

/**
 * Format duration in seconds to "MM:SS" format
 */
export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${pad(minutes)}:${pad(seconds)}`;
}
