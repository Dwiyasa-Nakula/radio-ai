import { createHash, timingSafeEqual } from 'node:crypto';
import { SignJWT } from 'jose';
import type { BackendSessionResponse } from '@radio-ai/contracts';

export const MOBILE_SESSION_SECONDS = 60 * 60;
export const MOBILE_REFRESH_WINDOW_SECONDS = 5 * 60;
export const MOBILE_SCOPES = [
  'host:generate',
  'youtube:read',
  'youtube:stream',
  'radio:read',
] as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export function sha256Credential(credential: string): string {
  return createHash('sha256').update(credential, 'utf8').digest('hex');
}

export function configuredCredentialHashes(raw: string | undefined): string[] {
  if (!raw) return [];
  return [...new Set(
    raw
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter((value) => SHA256_PATTERN.test(value))
  )];
}

export function deviceCredentialFromAuthorization(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = /^Device[ \t]+([^\s]{16,1024})$/.exec(value);
  return match?.[1];
}

export function credentialMatches(
  credential: string | undefined,
  configuredHashes: readonly string[]
): boolean {
  if (!credential || configuredHashes.length === 0) return false;
  const candidate = Buffer.from(sha256Credential(credential), 'hex');
  let matched = false;
  for (const configured of configuredHashes) {
    const expected = Buffer.from(configured, 'hex');
    if (expected.length === candidate.length) {
      matched = timingSafeEqual(candidate, expected) || matched;
    }
  }
  return matched;
}

export function normalizePublicBaseUrl(raw: string): string {
  try {
    const value = new URL(raw);
    if (!['http:', 'https:'].includes(value.protocol) || value.username || value.password) return '';
    value.pathname = value.pathname.replace(/\/+$/, '');
    value.search = '';
    value.hash = '';
    return value.toString().replace(/\/$/, '');
  } catch {
    return '';
  }
}

export async function issueMobileSession(
  signingSecret: string,
  baseUrl: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<BackendSessionResponse> {
  if (signingSecret.length < 32) throw new Error('Signing secret is not configured');
  const normalizedBaseUrl = normalizePublicBaseUrl(baseUrl);
  if (!normalizedBaseUrl) throw new Error('Backend public URL is invalid');
  const expiresAt = nowSeconds + MOBILE_SESSION_SECONDS;
  const token = await new SignJWT({ scope: [...MOBILE_SCOPES], client: 'android' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('radio-ai-mobile')
    .setAudience('radio-ai-backend')
    .setSubject('enrolled-device')
    .setIssuedAt(nowSeconds)
    .setExpirationTime(expiresAt)
    .setJti(crypto.randomUUID())
    .sign(new TextEncoder().encode(signingSecret));
  return { baseUrl: normalizedBaseUrl, token, expiresAt: expiresAt * 1000 };
}
