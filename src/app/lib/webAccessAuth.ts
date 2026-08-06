function constantTimeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

function decodeBasicCredentials(authorization: string): { username: string; password: string } | undefined {
  const match = /^Basic\s+([^\s]+)$/i.exec(authorization);
  if (!match) return undefined;
  try {
    const binary = atob(match[1]);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const decoded = new TextDecoder().decode(bytes);
    const separator = decoded.indexOf(':');
    if (separator < 0) return undefined;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return undefined;
  }
}

export function acceptsWebAccess(
  authorization: string | null,
  expectedUsername: string,
  expectedPassword: string
): boolean {
  if (!authorization) return false;
  const credentials = decodeBasicCredentials(authorization);
  if (!credentials) return false;
  return constantTimeEqual(credentials.username, expectedUsername)
    && constantTimeEqual(credentials.password, expectedPassword);
}