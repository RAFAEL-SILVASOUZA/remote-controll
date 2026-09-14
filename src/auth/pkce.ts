import { createHash } from 'node:crypto';

export function verifyPkce(codeVerifier: string, codeChallenge: string, codeChallengeMethod: string): boolean {
  if (codeChallengeMethod !== 'S256') return false;
  const computed = createHash('sha256').update(codeVerifier).digest('base64url');
  return computed === codeChallenge;
}
