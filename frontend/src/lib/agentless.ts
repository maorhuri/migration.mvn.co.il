/**
 * Helpers for "agentless" sources: a site reached over FTP or a wp-admin login instead of a
 * control panel with root. Pure functions shared by the servers pages, the wizard and the
 * migration pages.
 */
import type { Server } from '../types';

export const AGENTLESS_PANEL_TYPES = ['ftp', 'wordpress'] as const;
export type AgentlessPanelType = (typeof AGENTLESS_PANEL_TYPES)[number];

/** True for ftp / wordpress: no root on the source, so suspend / mail / cron / DNS are out of reach. */
export function isAgentlessPanel(panelType: string | null | undefined): panelType is AgentlessPanelType {
  return panelType === 'ftp' || panelType === 'wordpress';
}

/** The `site_url` stored in the server metadata, or '' when missing. */
export function serverSiteUrl(server: Pick<Server, 'metadata'> | null | undefined): string {
  const v = server?.metadata?.site_url;
  return typeof v === 'string' ? v : '';
}

/** The `docroot` stored in the server metadata ('' = auto-detect). */
export function serverDocroot(server: Pick<Server, 'metadata'> | null | undefined): string {
  const v = server?.metadata?.docroot;
  return typeof v === 'string' ? v : '';
}

/** The `ftps` flag stored in the server metadata. */
export function serverFtps(server: Pick<Server, 'metadata'> | null | undefined): boolean {
  return server?.metadata?.ftps === true;
}

/** "example.com" -> "https://example.com"; trims and drops a trailing slash. */
export function normalizeSiteUrl(value: string): string {
  let v = value.trim();
  if (!v) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  return v.replace(/\/+$/, '');
}

/** A usable http(s) site URL with a hostname. */
export function isValidSiteUrl(value: string): boolean {
  const v = normalizeSiteUrl(value);
  if (!v) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.length > 0 && !/\s/.test(v);
  } catch {
    return false;
  }
}

/** Hostname of a site URL ("https://www.example.com/blog" -> "www.example.com"), '' when unparsable. */
export function hostFromUrl(value: string): string {
  try {
    return new URL(normalizeSiteUrl(value)).hostname;
  } catch {
    return '';
  }
}

export type ProbeErrorKind = 'waf' | 'credentials' | 'noWpConfig' | 'unreachable' | 'generic';

/**
 * Classify a failed probe message from the backend so the UI can lead with a translated
 * headline (the raw message is always shown as well).
 */
export function classifyProbeError(message: string | undefined | null): ProbeErrorKind {
  const m = (message ?? '').toLowerCase();
  if (!m) return 'generic';
  if (/wp-config|docroot|document root|no wordpress|not a wordpress|wordpress not found/.test(m)) return 'noWpConfig';
  if (/credential|password|login|530|authenticat|incorrect|unauthori[sz]ed|\b401\b|access denied/.test(m)) return 'credentials';
  if (/\bwaf\b|\b403\b|forbidden|blocked|cloudflare|mod_?security|captcha|challenge|imunify|bot protection/.test(m)) return 'waf';
  if (/timeout|timed out|refused|no route|resolve|dns|unreachable|econn|network|no such host|eof/.test(m)) return 'unreachable';
  return 'generic';
}
