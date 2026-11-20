/**
 * If-None-Match comparison (weak, per RFC 9110 §13.1.2). Kept dependency-free
 * so response.util can use it without importing the cache middleware, which
 * pulls in the subscription service and closes an import cycle back through
 * error.middleware.
 */
export function checkETagMatch(ifNoneMatch: string, etag: string): boolean {
  if (ifNoneMatch.trim() === '*') return true;
  const targetClean = etag.replace(/^W\//, '').trim();
  const list = ifNoneMatch.split(',').map((s) => s.trim().replace(/^W\//, ''));
  return list.includes(targetClean);
}
