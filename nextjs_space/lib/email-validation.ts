const BLOCKED_DOMAINS = [
  'gmail.com', 'yahoo.com', 'rocketmail.com', 'hotmail.com',
  'outlook.com', 'aol.com', 'mail.com', 'protonmail.com',
  'icloud.com', 'yandex.com', 'live.com', 'msn.com',
];

export function isBusinessEmail(email: string): { valid: boolean; error?: string } {
  if (!email || typeof email !== 'string') {
    return { valid: false, error: 'Email is required' };
  }
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!emailRegex.test(email)) {
    return { valid: false, error: 'Invalid email format' };
  }
  const domain = email.split('@')?.[1]?.toLowerCase?.() ?? '';
  if (BLOCKED_DOMAINS.includes(domain)) {
    return { valid: false, error: 'Please use a business email (not Gmail, Yahoo, etc.)' };
  }
  return { valid: true };
}

export function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url?.startsWith('http') ? url : `https://${url}`);
    return !!parsed?.hostname && parsed.hostname.includes('.');
  } catch {
    return false;
  }
}
