import type { Lang } from '../lib/i18n';
import type { Dict } from './types';
import { common } from './common';
import { dashboard } from './pages/dashboard';
import { servers } from './pages/servers';
import { serverdetail } from './pages/serverdetail';
import { sshkeys } from './pages/sshkeys';
import { migrations } from './pages/migrations';
import { newmigration } from './pages/newmigration';
import { migrationdetail } from './pages/migrationdetail';

export type { Dict, PageDict } from './types';

/**
 * Merged dictionaries. Keys are namespaced per file ('common' owns nav/status/units/...,
 * each page owns '<page>.*'); a duplicate key across files is a bug.
 */
export const dictionaries: Record<Lang, Dict> = {
  he: {
    ...common.he,
    ...dashboard.he,
    ...servers.he,
    ...serverdetail.he,
    ...sshkeys.he,
    ...migrations.he,
    ...newmigration.he,
    ...migrationdetail.he,
  },
  en: {
    ...common.en,
    ...dashboard.en,
    ...servers.en,
    ...serverdetail.en,
    ...sshkeys.en,
    ...migrations.en,
    ...newmigration.en,
    ...migrationdetail.en,
  },
};
