import type { PageDict } from '../types';

/**
 * Strings owned by the settings page (src/pages/Settings.tsx). Keys are namespaced 'settings.*'.
 * Fill both languages; Hebrew reads like a native hosting pro wrote it.
 */
export const settings: PageDict = {
  he: {
    'settings.title': 'הגדרות',
    'settings.description': 'הגדרות גלובליות של כלי המיגרציה.',

    'settings.cf.title': 'Cloudflare',
    'settings.cf.description': 'טוקן ה-API של חשבון ה-Cloudflare שלנו. בעזרתו הכלי מעדכן את רשומות ה-DNS של דומיין שעבר מיגרציה ומפנה אותו לשרת החדש.',
    'settings.cf.tokenLabel': 'טוקן API',
    'settings.cf.tokenPlaceholder': 'הדבק טוקן API חדש',
    'settings.cf.tokenHint': 'הטוקן נשמר מוצפן ולעולם לא מוחזר. השאר ריק כדי לא לשנות את הטוקן השמור.',
    'settings.cf.configured': 'טוקן מוגדר',
    'settings.cf.notConfigured': 'לא הוגדר טוקן',
    'settings.cf.scopeHint': 'צור טוקן עם הרשאות Zone.DNS (עריכה) ו-Zone.Cache Purge על כל הזונות הרלוונטיות.',
    'settings.cf.targetIpLabel': 'IP שרת יעד (גיבוי)',
    'settings.cf.targetIpPlaceholder': 'למשל 203.0.113.10',
    'settings.cf.targetIpHint': 'משמש רק כאשר המיגרציה לא תיעדה את ה-IP של צומת היעד. בדרך כלל אפשר להשאיר ריק.',
    'settings.cf.targetIpv6Label': 'IPv6 שרת יעד (אופציונלי)',
    'settings.cf.targetIpv6Placeholder': 'למשל 2001:db8::10',
    'settings.cf.targetIpv6Hint': 'אם מוגדר, רשומות AAAA יופנו אליו. אחרת רשומות AAAA על @ ו-www יימחקו כדי שהדומיין יפנה ל-IPv4 החדש.',
    'settings.cf.save': 'שמור',
    'settings.cf.clear': 'מחק טוקן',
    'settings.cf.saved': 'ההגדרות נשמרו',
    'settings.cf.cleared': 'הטוקן נמחק',
    'settings.cf.saveFailed': 'שמירת ההגדרות נכשלה',
    'settings.cf.loadFailed': 'טעינת ההגדרות נכשלה',
  },
  en: {
    'settings.title': 'Settings',
    'settings.description': 'Global settings for the migration tool.',

    'settings.cf.title': 'Cloudflare',
    'settings.cf.description': "Our Cloudflare account's API token. The tool uses it to update a migrated domain's DNS records and point them at the new server.",
    'settings.cf.tokenLabel': 'API token',
    'settings.cf.tokenPlaceholder': 'Paste a new API token',
    'settings.cf.tokenHint': 'The token is stored encrypted and never returned. Leave blank to keep the stored token unchanged.',
    'settings.cf.configured': 'Token configured',
    'settings.cf.notConfigured': 'No token configured',
    'settings.cf.scopeHint': 'Create a token with Zone.DNS (edit) and Zone.Cache Purge permissions on the relevant zones.',
    'settings.cf.targetIpLabel': 'Target server IP (fallback)',
    'settings.cf.targetIpPlaceholder': 'e.g. 203.0.113.10',
    'settings.cf.targetIpHint': 'Used only when a migration did not record its target node IP. Usually leave this blank.',
    'settings.cf.targetIpv6Label': 'Target server IPv6 (optional)',
    'settings.cf.targetIpv6Placeholder': 'e.g. 2001:db8::10',
    'settings.cf.targetIpv6Hint': 'When set, AAAA records are pointed at it. Otherwise AAAA records on @ and www are removed so the domain resolves to the new IPv4.',
    'settings.cf.save': 'Save',
    'settings.cf.clear': 'Remove token',
    'settings.cf.saved': 'Settings saved',
    'settings.cf.cleared': 'Token removed',
    'settings.cf.saveFailed': 'Could not save settings',
    'settings.cf.loadFailed': 'Could not load settings',
  },
};
