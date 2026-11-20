/**
 * Registrable domains (eTLD+1) for publisher independence (#228).
 *
 * Two mastheads under one registrable domain are one publisher:
 * edition.cnn.com and money.cnn.com fold to cnn.com, news.bbc.co.uk to
 * bbc.co.uk. A full Public Suffix List (https://publicsuffix.org/) is not
 * shipped: the table below holds the multi-label suffixes news hosts actually
 * use. A host under a suffix missing from it folds one label too far (to
 * "co.xx"), which merges publishers rather than splitting them, so the error
 * is on the safe side for corroboration.
 */
import { canonicalUrl } from '../services/signal-normalize';

/** Multi-label public suffixes. Single-label TLDs (com, org, de…) need no entry. */
export const MULTI_LABEL_SUFFIXES: ReadonlySet<string> = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'ltd.uk', 'plc.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.nz', 'org.nz', 'govt.nz',
  'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'go.jp',
  'co.kr', 'or.kr',
  'com.cn', 'net.cn', 'org.cn', 'gov.cn',
  'com.hk', 'org.hk',
  'com.tw', 'org.tw',
  'com.sg', 'org.sg',
  'com.my',
  'co.in', 'net.in', 'org.in', 'gov.in',
  'co.za', 'org.za',
  'com.br', 'org.br', 'gov.br',
  'com.ar', 'com.mx', 'com.co', 'com.tr', 'com.ua', 'com.pk', 'com.ng', 'com.eg',
  'co.il', 'org.il',
  'com.pl', 'com.es', 'co.id', 'or.id', 'co.th', 'in.th',
]);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const DOMAINISH = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

/** eTLD+1 of a host name, lower-cased, without a leading "www.". */
export function registrableDomain(host: string): string {
  const h = host.trim().toLowerCase().replace(/\.$/, '').replace(/^www\d*\./, '');
  if (IPV4.test(h) || h.includes(':')) return h;
  const labels = h.split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const lastTwo = labels.slice(-2).join('.');
  return MULTI_LABEL_SUFFIXES.has(lastTwo) ? labels.slice(-3).join('.') : lastTwo;
}

/**
 * The publisher key for a signal: the URL's registrable domain, or, only when
 * there is no URL, the publisher name (folded too when it is itself a domain,
 * as GDELT reports it). NewsAPI display names ("Reuters") are lower-cased.
 * Null when neither is known.
 */
export function publisherDomain(url: string | null | undefined, publisher: string | null | undefined): string | null {
  const canonical = canonicalUrl(url);
  if (canonical) {
    try {
      return registrableDomain(new URL(canonical).hostname);
    } catch {
      // fall through to the publisher name
    }
  }
  const name = (publisher ?? '').trim().toLowerCase();
  if (!name) return null;
  return DOMAINISH.test(name) ? registrableDomain(name) : name;
}
