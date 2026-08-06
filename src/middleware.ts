import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { acceptsWebAccess } from './app/lib/webAccessAuth';

export function middleware(request: NextRequest) {
  const password = process.env.WEB_ACCESS_PASSWORD;
  if (!password) return NextResponse.next();

  const username = process.env.WEB_ACCESS_USERNAME?.trim() || 'radio';
  if (acceptsWebAccess(request.headers.get('authorization'), username, password)) {
    return NextResponse.next();
  }

  return new NextResponse('Authentication required', {
    status: 401,
    headers: {
      'Cache-Control': 'no-store',
      'WWW-Authenticate': 'Basic realm="mirAI melody", charset="UTF-8"',
    },
  });
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};