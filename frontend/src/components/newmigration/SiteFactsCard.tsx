import { CheckIcon } from '@heroicons/react/16/solid';
import { Badge, Figure, FigureStrip, Mono, PanelMonogram } from '../ui';
import { useT } from '../../lib/i18n';
import { serverSiteUrl } from '../../lib/agentless';
import type { Account, Server } from '../../types';

export interface SiteFactsCardProps {
  account: Account;
  server: Server | undefined;
}

/**
 * The one site an FTP / WordPress source holds, with the facts the helper reported
 * (GET /servers/:id/accounts). It is always the selection, so there is no checkbox.
 */
export function SiteFactsCard({ account, server }: SiteFactsCardProps) {
  const t = useT();
  const siteUrl = serverSiteUrl(server);
  const dbName = account.databases?.[0];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <PanelMonogram panelType={server?.panel_type} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Mono className="text-base font-semibold text-slate-900 dark:text-slate-100">{account.domain || account.username}</Mono>
            {account.is_wordpress ? (
              <Badge tone="cyan" size="sm">
                {t('newmigration.site.wordpress')}
              </Badge>
            ) : (
              <Badge tone="warning" size="sm">
                {t('newmigration.site.notWordpress')}
              </Badge>
            )}
            {account.php_version && (
              <Badge tone="neutral" size="sm" mono>
                PHP {account.php_version}
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 dark:text-slate-400">
            <Mono>{account.username}</Mono>
            {siteUrl && (
              <>
                <span className="text-slate-300 dark:text-slate-600" aria-hidden="true">
                  ·
                </span>
                <Mono>{siteUrl}</Mono>
              </>
            )}
          </div>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300">
          <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {t('newmigration.site.selected')}
        </span>
      </div>

      <FigureStrip columns={3}>
        <Figure size="sm" label={t('newmigration.site.disk')} value={account.disk_used ? <Mono>{account.disk_used}</Mono> : '—'} />
        <Figure size="sm" label={t('newmigration.site.database')} value={dbName ? <Mono>{dbName}</Mono> : t('newmigration.site.noDatabase')} tone={dbName ? 'neutral' : 'warning'} hint={account.db_size ? <Mono className="text-xs">{account.db_size}</Mono> : undefined} />
        <Figure size="sm" label={t('newmigration.site.php')} value={account.php_version ? <Mono>{account.php_version}</Mono> : '—'} />
      </FigureStrip>

      <p className="text-xs text-slate-500 dark:text-slate-400">{t('newmigration.site.refreshHint')}</p>
    </div>
  );
}

export default SiteFactsCard;
