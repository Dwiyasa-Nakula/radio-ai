import { SignJWT } from 'jose';
import { NextResponse } from 'next/server';
import type { BackendSessionResponse } from '@radio-ai/contracts';
import { legacyBackendApiEnabled } from '@/app/lib/localFilesystemGuard';

export const runtime = 'nodejs';

const SESSION_SECONDS = 10 * 60;

export async function GET(request: Request) {
  const baseUrl = process.env.BACKEND_URL?.trim().replace(/\/$/, '');
  const secret = process.env.BACKEND_SESSION_SECRET;
  if (!baseUrl || !secret) {
    if (!legacyBackendApiEnabled()) {
      return NextResponse.json(
        { error: 'Cloud Run backend is not configured' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } }
      );
    }
    return new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
        'X-Backend-Mode': 'local',
      },
    });
  }
  if (secret.length < 32) {
    return NextResponse.json(
      { error: 'BACKEND_SESSION_SECRET must be at least 32 characters' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + SESSION_SECONDS;
  const origin = request.headers.get('origin') ?? new URL(request.url).origin;
  const token = await new SignJWT({
    scope: ['host:generate', 'youtube:read', 'youtube:stream', 'radio:read'],
    origin,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('radio-ai-vercel')
    .setAudience('radio-ai-backend')
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .setJti(crypto.randomUUID())
    .sign(new TextEncoder().encode(secret));

  const response: BackendSessionResponse = {
    baseUrl,
    token,
    expiresAt: expiresAt * 1000,
  };
  return NextResponse.json(response, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
