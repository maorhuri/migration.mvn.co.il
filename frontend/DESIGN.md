# MVNMigrate — Design System Reference

MVNMigrate is a calm control room for moving websites from DirectAdmin to Enhance, built for one
Israeli hosting professional who reads it in Hebrew at 2am and must trust every number on it.
This file documents what is **actually built** in `src/components/ui`, `src/components/layout`,
`src/lib` and `src/i18n`. Use it instead of reading every component. Keep all routes, API calls,
polling loops, handlers and form fields exactly as they are: the craft is in rhythm, typography,
hierarchy, state-driven motion and copy that reads like a native wrote it.

---

## 0. Import paths

`tsconfig.json` defines `"@/*" -> "src/*"` and `vite.config.ts` has the matching alias. Use the barrel:

```tsx
import { Button, Card, CardHeader, CardTitle, StatusBadge, Mono, Figure, Timeline } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatBytes, formatRelativeTime, formatDate, formatDuration, formatShortDuration, formatNumber, runWindow, shortId, percent } from '@/lib/format';
import { useT, useLanguage } from '@/lib/i18n';
import { deriveTimeline, parseInventory } from '@/lib/migrationSteps';
import { useCountUp } from '@/lib/useCountUp';
```

Relative equivalents from `src/pages/*.tsx`: `'../components/ui'`, `'../lib/cn'`, `'../lib/format'`, `'../lib/i18n'`.
Every UI component also has a `default` export, but prefer named imports from the barrel.
Layout components (`AppShell`, `CommandPalette`, `ThemeToggle`, `LanguageToggle`) are **not** in the
barrel — pages never render them; `App.tsx` wraps all routes in `<AppShell>`.

Icons: `@heroicons/react`. `/24/outline` for empty states / stats, `/20/solid` or `/16/solid` inside
buttons, badges and table headers. Toasts: `react-hot-toast` (`toast.success(t('x.saved'))`), themed
and direction-aware in `main.tsx`. No new npm dependencies (no framer-motion: CSS keyframes + Tailwind).

---

## 1. The bar: MalCare-quiet composition rules

1. **Page = bold title + one solid brand primary action** (`PageHeader title actions`). Everything else is
   `secondary` / `ghost`. Row actions are `IconButton size="sm"`.
2. **A grid of self-contained cards, each answering exactly one question** the operator actually has
   (what needs my attention, how big is what I am about to move, where is the run right now, how long did
   each step take, what do I do next). One card = one question = one `CardTitle`.
3. **Big tabular figure + small eyebrow label + chip for state.** Numbers are `Stat` / `Figure` (28px /
   `text-2xl`, `tabular`), labels are `.eyebrow`, state is a `Badge`/`StatusBadge` chip. Never a colored span.
4. **Off-states get a drawn illustration plus three short benefit bullets** (`EmptyState illustration=...`
   with a `<ul>` in `description`), never a lonely icon.
5. **Hairlines, no shadows, 24px padding, 14px radii.** Surfaces have `shadow: none` at rest; only floating
   things (modals, palette, tooltips, hover-lifted interactive cards) cast a shadow.
6. **One accent.** Brand plum-to-magenta is used only where the product is acting: primary button, active
   nav, live progress, the one live number, focus rings, selected rows. Green / amber / red are reserved for
   state (success / warning / danger). Panel identity keeps violet (Enhance), blue (DirectAdmin), orange (cPanel).
7. **The migration is the hero:** a run timeline derived from the real log (`deriveTimeline` + `Timeline`),
   an inventory of what moved (`parseInventory` + `FigureStrip`), a console that reads like telemetry
   (`LogViewer` with `sectionFor`, `jumpToId` and the blinking cursor) and a cutover checklist
   (`Checklist` / `ChecklistItem`) that walks through hosts entry, verification, DNS and suspending the source.
8. **Motion is sparse and always carries state:** stagger on page load, a step ring that pops, a bar that
   flows only while bytes move, a check that draws itself once. Every animation is `motion-safe:` and the
   global reduced-motion rule kills the rest.
9. **Dark mode is a designed second theme**, never an inversion: sidebar on the same plane as the page
   (`bg-slate-950`), hairlines at `white/[0.08]`, lighter brand tints (`brand-300`/`brand-400`) for text and rings.

---

## 2. Tokens (as configured in `tailwind.config.js` / `index.css`)

| Token | Value / class | Notes |
|---|---|---|
| Font sans | `font-sans` → **Heebo**, Inter, system-ui | loaded in `index.html` (400/500/600/700), used for Hebrew and English |
| Font mono | `font-mono` → JetBrains Mono, **Heebo**, ui-monospace… | `code, kbd, pre, samp` automatically; every technical value. Heebo sits second so Hebrew glyphs inside a mono run ("2.0 שנ׳", console section titles) come from the UI face; Latin and digits stay mono |
| Base leading | `line-height: 1.45`; `[dir=rtl] body` 1.6 | Hebrew gets more air; headings lose `tracking-tight` in RTL |
| Text sizes | `text-2xs` 11px, `text-xs` 12, `text-sm` 14 (base), `text-[13px]` dense tables, `text-base` 16 card titles, `text-2xl` page h1, `text-[28px]` Stat value | |
| Brand scale | `brand-50 #fdf2f8 · 100 #fbe4f1 · 200 #f5c6e2 · 300 #f0a8d3 · 400 #e052a7 · 500 #c62c85 · 600 #ad1f74 · 700 #8a1a5f · 800 #6f1449 · 900 #570f3a · 950 #3a0a27` | `primary-*` is an alias of the same scale. **No indigo anywhere.** |
| Brand usage light | fills `bg-brand-700` (hover 600, active 800), text `text-brand-700`, tints `bg-brand-50` / `bg-brand-500/15`, ring `ring-brand-500` | |
| Brand usage dark | text `dark:text-brand-300`, rings `dark:ring-brand-300` / `brand-400`, fills `dark:bg-brand-600`, tints `dark:bg-brand-500/15` | **never `brand-900` text on dark** |
| Signature gradient | `.bg-gradient-brand` / `.text-gradient-brand` (900 → 600 → 400; dark 300 → 400 → 300) | logo, live progress fill, one hero number at most |
| Semantic | `success`=emerald, `warning`=amber, `danger`=rose, `info`=sky; `enhance`=violet, `directadmin`=blue, `cpanel`=orange | raw scales also work |
| Page bg | `bg-slate-50` / `dark:bg-slate-950` | `body` and AppShell |
| Surface | `surfaceClasses` = `rounded-xl border border-slate-200 bg-white dark:border-white/[0.08] dark:bg-slate-900` | Card, Modal, Table wrapper, Stat |
| Sunken surface | `bg-slate-50 dark:bg-white/[0.03]` | table head, modal footer, pinned context card |
| Border | `border-slate-200 dark:border-white/[0.08]` | cards, dividers (`divide-slate-100 dark:divide-white/[0.06]`) |
| Control border | `border-slate-200 dark:border-white/[0.1]` | inputs, secondary buttons |
| Text | primary `text-slate-900 dark:text-slate-100`; body `700/300`; muted `500/400`; faint `400/500` | |
| Radius | `rounded-md` 6px badges, `rounded-lg` **10px** inputs/buttons, `rounded-xl` **14px** cards/modals/tables, `rounded-2xl` 16px, `rounded-full` dots/progress | |
| Shadow | `shadow-sm` (barely there), `shadow-card` = none, `shadow-pop` (hover lift, tooltips), `shadow-pop-dark`, `shadow-2xl dark:shadow-black/50` (modals) | **surfaces have no shadow at rest** |
| Focus ring | `ring-2 ring-brand-500 ring-offset-2 ring-offset-white dark:ring-brand-300 dark:ring-offset-slate-900` | global `:focus-visible` |
| Spacing rhythm | page `p-6`; sections `space-y-6`; grids `gap-4`; card `p-6` (24px); table cells `px-4 py-2.5`; buttons `h-8/h-9/h-10` | |
| Layout | sidebar 64px (`<lg`) / 264px (`lg`) on the **start** side, top bar 56px, content `max-w-[1440px] mx-auto` | mirrors in RTL through logical utilities |

### Motion (exact names, all in `tailwind.config.js`)

| Class | What | Use |
|---|---|---|
| `motion-safe:animate-rise` + `.stagger` | 360ms rise-in, delay `var(--i) * 45ms` | page-load stagger of cards |
| `motion-safe:animate-fade-in` / `animate-scale-in` | 150ms | route change (AppShell), modals |
| `motion-safe:animate-shimmer` | 1.6s sweep | Skeleton (built in) |
| `motion-safe:animate-ring-pop` | 500ms pop | current step ring (Stepper, built in) |
| `motion-safe:animate-dash` | flowing dashes | `Wire` while running (built in) |
| `motion-safe:animate-bar-slide` | gradient flow | `ProgressBar live` (built in) |
| `motion-safe:animate-cursor-blink` | 1s blink | LogViewer cursor (built in) |
| `motion-safe:animate-log-in` / `animate-log-flash` | new line fade / jump flash | LogViewer (built in) |
| `motion-safe:animate-draw` + `.draw-path` | a check draws itself once | `Illustration attention`, success moments |
| `motion-safe:animate-pulse-ring` | soft brand halo | running Timeline ring (built in) |
| `animate-indeterminate` / `rtl:animate-indeterminate-rtl` | sliding bar | ProgressBar indeterminate (built in) |

The stagger pattern (the only page-level motion you should add yourself). `PageHeader` already rises in
first (`--i` 0, built in), so the sections that follow start at `--i` 1; a page's own state changes
(wizard steps, filters) use a plain `motion-safe:animate-rise` without `.stagger`:

```tsx
import type { CSSProperties } from 'react';
<PageHeader … />                                   {/* rises at --i 0 on its own */}
{cards.map((c, i) => (
  <Card key={c.id} className="motion-safe:animate-rise stagger" style={{ '--i': i + 1 } as CSSProperties}>…</Card>
))}
```

### Utilities (in `index.css`)

`.tabular` (tabular-nums), `.text-balance`, `.scrollbar-none`, `.stagger`, `.text-gradient-brand`,
`.bg-gradient-brand`, `.eyebrow` (every small label; 11px uppercase tracked in English, 12px untracked and
**never uppercased** in Hebrew, so Latin words inside a Hebrew label stay as written; it lives in the
components layer, so a single utility on the same element wins: `normal-case` keeps a hostname as typed,
`text-brand-700` colors a page eyebrow), `.ltr` (direction + isolate), `.flip-rtl` (mirrors in RTL),
`.draw-path`, `.dot-grid`.
Legacy `.card .btn .btn-primary .btn-secondary .btn-danger .input .label` are still defined (restyled to the
brand) but **do not use them in new code**.

---

## 3. Hebrew, RTL and i18n

Hebrew is the **default** (first visit with nothing stored = `he`, `dir="rtl"`). English is one click away
(`LanguageToggle` in the top bar, "Switch language" in the command palette). The choice persists in
`localStorage["lang"]`; `?lang=he|en` on first load overrides and persists (this is how you screenshot
English: append `?lang=en`).

### API (`@/lib/i18n`)

```tsx
const t = useT();
t('servers.title');                       // plain
t('servers.hint', { name: server.name }); // {name} interpolation
t('units.files', { count: n });           // plural: picks units.files_one / units.files_other by count === 1
t.rich('confirm.typeToConfirm', { text: <Mono>{name}</Mono> }); // ReactNode interpolation
const { lang, setLang, dir, locale } = useLanguage(); // 'he'|'en', 'rtl'|'ltr', 'he-IL'|'en-US'
translate('codeblock.copied');            // no-hook variant for code outside components (toasts in helpers)
```

Missing keys fall back to `en[key]`, then to the key itself, and `console.warn` once per key in dev.
`formatDate`, `formatTime`, `formatRelativeTime`, `formatDuration`, `formatShortDuration` and `formatNumber`
already follow the active locale — never hand-format dates.

### Dictionaries (`src/i18n`)

- `common.ts` (system agent): `brand.*`, `nav.*`, `common.*` (save/cancel/close/delete/edit/retry/tryAgain/refresh/back/continue/next/previous/clear/clearFilters/search/done/copy/copied/loading/actions/viewAll/showAll/select/selectAll/deselectAll/none/unknown/optional/notAvailable/total/of/on/to/from/open/view/details/confirm/yes/no),
  `units.*` (files/databases/tables/mailboxes/cronJobs/accounts/servers/keys/nodes/lines/warnings/migrations/steps/domains, each `_one`/`_other`),
  `status.*` (pending/running/awaiting_review/completed/failed/cancelled/skipped/error/warning/unknown/testing/success/connected/disconnected/online/offline/active/suspended/sourceSuspended/sourceActive),
  `panel.*` (directadmin/enhance/cpanel/cloudpanel/ftp/wordpress/unknown), `auth.*` (password/ssh_key/api_key),
  `steps.<id>.name` / `steps.<id>.details` for the 13 wizard step ids + `steps.phase.export|import|scan` (`{name}`),
  `log.*`, `time.*` (h/m/s/noWork/justNow/elapsed/duration/started/completed/created), `theme.*`, `lang.*`,
  `palette.*`, `empty.couldNotLoad.title|description`, `empty.retry`, `a11y.*` (back/close/search/loadingX/selectAll/selectX/copyX/sidebar/breadcrumb/mainNav/progress/home),
  `confirm.confirm|cancel|typeToConfirm`, `codeblock.*`, `table.actions|sortBy`, `stepper.progress`, `timeline.jumpToLog`.
- `pages/<page>.ts` (one per page agent: dashboard, servers, serverdetail, sshkeys, migrations, newmigration,
  migrationdetail): `export const <page>: PageDict = { he: {...}, en: {...} }`. **Only edit your own file.**
  Keys are namespaced `'<page>.'` (`'dashboard.title'`, `'servers.card.host'`). A duplicate key across files is a bug.
- `index.ts` merges them; nothing else to wire.

### Glossary (every page must use these words)

| English | Hebrew | | English | Hebrew |
|---|---|---|---|---|
| server | שרת | | hosts entry | רשומת hosts |
| cluster node | צומת | | switch DNS | העברת DNS |
| account | חשבון | | suspend source | השעיית החשבון במקור |
| migration | מיגרציה | | run timeline | ציר הריצה |
| source / target | מקור / יעד | | console | קונסולה |
| scan | סריקה | | fingerprint | טביעת אצבע |
| warnings | אזהרות | | install command | פקודת התקנה |
| mailbox | תיבת דואר | | test connection | בדיקת חיבור |
| database | מסד נתונים | | refresh accounts | רענון חשבונות |
| disk | נפח | | add server | הוספת שרת |
| files | קבצים | | new migration | מיגרציה חדשה |
| elapsed / duration | זמן שעבר / משך | | started / completed / created | התחלה / סיום / נוצר |

Keep **DirectAdmin, Enhance, WordPress, PHP, SSH, DNS, IP, SSL, hosts, cron, rsync, MySQL** in Latin inside
Hebrew. Hebrew copy is short, direct and professional ("רענון חשבונות", not "לחץ כאן כדי לרענן את רשימת החשבונות").
No em-dashes, no emoji in UI copy.

### The LTR rule

Domains, hosts, IPs, ids, paths, usernames, commands, versions, log lines and code are **always LTR in mono**:
`<Mono>` (inline), `<CodeBlock>` (blocks and inline chips), `TD mono`, `Input mono`, `KeyValue item.mono`,
`Badge mono`. `LogViewer` and `CodeBlock` are LTR entirely, even in Hebrew. Never put a raw domain in Hebrew text.
Do not translate log lines coming from the backend.

### The logical-utility rule

Use `ms-/me-/ps-/pe-/start-/end-/text-start/text-end/rounded-s-/rounded-e-/border-s/border-e/inset-inline`
instead of `ml/mr/pl/pr/left/right/...`; replace `space-x-*` with `gap-*`. Before finishing a page run:

```sh
grep -nE "\b(-?m[lr]|p[lr]|left|right|text-left|text-right|rounded-[lr]|border-[lr]|space-x)-" src/pages/X.tsx src/components/x/*.tsx
grep -nE "'[A-Z][a-z].*'|\"[A-Z][a-z].*\"" src/pages/X.tsx   # leftover English literals (aria-labels and toasts included)
```

Hits are allowed only inside a `dir="ltr"` container. Then screenshot Hebrew (default) and `?lang=en`, light and dark.

### Directional icons

Arrows, chevrons, "back", "next" and any icon that points along the reading direction get `className="flip-rtl"`
(`ChevronRightIcon` in a breadcrumb, `ArrowRightIcon` between source and target). Do not combine `flip-rtl` with
`rotate-180` on the same element (the RTL transform replaces it): pick the icon that is right in LTR and flip it.
Icons that do not encode direction (trash, key, refresh) are never flipped.
Never put a text arrow (`→`) inside a sentence or a text run: the bidi algorithm keeps Latin runs LTR, so a
flipped arrow points the wrong way. Render "source → target" as a flex row of separate spans with an
`ArrowRightIcon className="flip-rtl"` between them (the row itself mirrors). Do not force `dir="ltr"` on
translated text (durations like "3 דק׳ 02 שנ׳" must stay in the page direction); only technical values are LTR.

### `.eyebrow`

Every small label (card kicker, stat label, table-less definition labels, nav group titles) uses `.eyebrow`.
It handles size, weight, casing, tracking and its RTL override for you (Hebrew eyebrows are never uppercased,
so "Host" and "Enhance" read as typed). Add `normal-case` when an English eyebrow carries a hostname.

---

## 4. Component reference

All components take `className` (appended last via `cn`) and forward native HTML attributes unless noted.
"Ref" = `forwardRef`.

### Button — `@/components/ui`
`ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>` (ref)

| Prop | Type | Default |
|---|---|---|
| variant | `'primary' \| 'secondary' \| 'ghost' \| 'danger' \| 'outline'` | `'secondary'` |
| size | `'sm' \| 'md' \| 'lg'` (h-8 / h-9 / h-10) | `'md'` |
| loading | `boolean` — Spinner, `disabled` + `aria-busy` | `false` |
| leftIcon / rightIcon | `ReactNode` — **start / end** icon (names are historical; they mirror in RTL) | — |
| fullWidth | `boolean` | — |

Also exported: `buttonClasses({ variant, size, fullWidth })` for `<Link>` / `<a>`, `buttonBaseClasses`, `buttonVariantClasses`, `buttonSizeClasses`.

```tsx
<Button variant="primary" leftIcon={<PlusIcon />} onClick={openCreate}>{t('servers.add')}</Button>
<Link to="/migrations/new" className={buttonClasses({ variant: 'primary' })}>{t('nav.newMigration')}</Link>
```

### IconButton — `@/components/ui`
`'aria-label'` **required**, `icon`, `variant` = `'ghost'`, `size: 'xs'|'sm'|'md'|'lg'` = `'md'`, `loading`, `tone: 'default'|'danger'|'success'|'brand'`.

### Card family — `@/components/ui`
- `Card`: `flush?` (no padding — tables), `interactive?` (hover lift + pointer), `accent?` (4px start strip), **`edge?: BadgeTone`** (2px colored top edge; quieter than accent — use it for state at a glance on list cards).
- `CardHeader` (`actions?`, `divided?`), `CardTitle` (`as?`), `CardDescription`, `CardContent` (`padded?`), `CardFooter` (`divided?`).
- `surfaceClasses` (string) when you need the surface recipe on a custom element.

```tsx
<Card edge="success">
  <CardHeader actions={<Badge tone="success" dot>{t('status.online')}</Badge>}>
    <CardTitle>{t('dashboard.fleet.title')}</CardTitle>
    <CardDescription>{t('dashboard.fleet.hint')}</CardDescription>
  </CardHeader>
  …
</Card>
```

### Badge / StatusBadge / PanelBadge / PanelMonogram — `@/components/ui`
- `Badge`: `tone`, `size: 'sm'|'md'|'lg'` (h-5/6/7), `dot`, `pulse`, `icon`, `mono`, **`glow?`** (soft tone halo — the one live chip on a card).
- `StatusBadge status` → translated via `t('status.<key>')`, raw text for unknown statuses; `label?` overrides. `statusMeta(status)` → `{ tone, label, pulse }` (English label; use it to pick tones). `useStatusLabel()` returns a translator for status text outside a badge.
- `PanelBadge panelType` (`compact?` = dot only) → `t('panel.<type>')`. `panelTone(type)`, `usePanelLabel()`.
- `PanelMonogram({ panelType, size?: 'sm'|'md'|'lg', className })` — 24/32/40px tile with DA / EN / cP / CP / FTP / WP / SR in the panel tone, `aria-label` = panel label. Use it as the leading avatar of server rows/cards.

```tsx
<Badge tone="brand" glow dot pulse>{t('status.running')}</Badge>
<div className="flex items-center gap-3"><PanelMonogram panelType={s.panel_type} /><Mono>{s.host}</Mono></div>
```

### Mono — `@/components/ui`
`Mono({ children, className?, as?: 'span'|'code', block? })` → `<bdi dir="ltr" class="font-mono ltr inline-block max-w-full truncate">`.
**Every** domain, host, IP, id, path, username, command in Hebrew mode goes through Mono, CodeBlock or `TD mono`.

```tsx
<p>{t('migrationdetail.target', { node: '' })}<Mono>{m.target_node}</Mono></p>
```

### Stat — `@/components/ui`
`label` (rendered as `.eyebrow`), `value` (28px tabular; **numbers count up** via `useCountUp`), `hint?`, `icon?` (heroicon component, 16px at the end of the label row, colored by `tone`), `tone?`, `interactive?`, `loading?`, **`quiet?`** (muted value for "0 failed"), **`valueClassName?`**, **`trend?: ReactNode`** (a `<Sparkline/>` at the end of the value row). Its own card.

```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
  <Stat label={t('dashboard.stats.running')} value={running} icon={BoltIcon} tone="brand" />
  <Stat label={t('dashboard.stats.failed')} value={failed} icon={ExclamationTriangleIcon} tone={failed ? 'danger' : 'neutral'} quiet={failed === 0} />
  <Stat label={t('dashboard.stats.week')} value={week} trend={<Sparkline values={perDay} className="text-brand-500" />} />
</div>
```

### Figure / FigureStrip — `@/components/ui`
`Figure({ label, value, hint?, tone?: 'neutral'|'brand'|'success'|'warning'|'danger', mono?, live?, size?: 'sm'|'md'|'lg', countUp?, className })` = eyebrow + big tabular value (`text-lg` / `text-2xl` / `text-4xl`; `live` = brand color; `mono` for durations/sizes).
`FigureStrip({ children })` = a `<dl>` strip (2 / 3 / 6 columns, hairline dividers, quiet background) whose Figures render `dt`/`dd`.

```tsx
<FigureStrip>
  <Figure label={t('migrationdetail.inv.files')} value={formatNumber(inv.files ?? 0)} countUp />
  <Figure label={t('migrationdetail.inv.size')} value={inv.bytesLabel ?? '—'} mono />
  <Figure label={t('time.elapsed')} value={formatDuration(win.startedAt, win.endedAt)} mono live={win.live} />
</FigureStrip>
```

### Sparkline — `@/components/ui`
`Sparkline({ values: number[], className?, height = 28 })` — inline SVG polyline + soft area in `currentColor`, `aria-hidden`; renders nothing with fewer than two points.

### ProgressBar — `@/components/ui`
`value`, `tone`, `indeterminate`, **`live?`** (brand gradient flows while bytes move), `size: 'xs'|'sm'|'md'`, `showValue`, `label`. RTL-safe (the indeterminate bar slides the other way).

```tsx
<ProgressBar value={pct} live={isRunning} tone={status === 'failed' ? 'danger' : status === 'completed' ? 'success' : 'brand'} showValue label={t('a11y.progress')} />
```

### Stepper — `@/components/ui`
Same API as before (`steps`, `current`, `completedUpTo`, `error`, `running`, `orientation`, `onStepClick`). The connector fills toward the next step, the current ring pops in, `description` renders under the label (hidden under `lg` horizontally).

### Timeline — `@/components/ui`
`Timeline({ items: TimelineItem[], live?, onJump?: (logId) => void, phaseLabels?: Record<string, ReactNode>, className })`.
Phase labels accept nodes: pass `t.rich('steps.phase.export', { name: <Mono>{host}</Mono> })` so the hostname
stays LTR mono and never uppercases. Step errors render `dir="auto"`, mono when Latin, clamped to four lines
(the full text is in the `title`); Hebrew durations drop the mono face automatically.
Renders one row per step (state ring, translated name via `t('steps.<id>.name')`, end-aligned mono duration that ticks while live, line/warning counts, the running step's details with a typing indicator, error text). Rows become buttons when `firstLogId` and `onJump` exist. Not a Card — wrap it.

```tsx
const items = useMemo(() => deriveTimeline(logs, migration), [logs, migration]);
<Card flush>
  <CardHeader divided><CardTitle>{t('migrationdetail.timeline')}</CardTitle></CardHeader>
  <Timeline items={items} live={isRunning} onJump={setJumpToId}
    phaseLabels={{
      export: t.rich('steps.phase.export', { name: <Mono>{source.name}</Mono> }),
      import: t.rich('steps.phase.import', { name: <Mono>{target.name}</Mono> }),
    }} />
</Card>
```

### LogViewer — `@/components/ui`
`items`, `follow`, `filterable`, `height`, `live`, `title?` (default `t('log.title')`), `emptyMessage?` (default `t('log.empty')`), **`jumpToId?: string|null`** (centers + flashes a line the moment the id changes, clears the level filter if needed, and its own scroll never counts as the user scrolling away; set it back to `null` before sending the same id twice, nothing else is needed on the page side), **`sectionFor?: (item) => string|null`** (section headers before step-boundary lines), **`cursor?`** (blinking cursor, default = `live`). Always dark and LTR. Lines have `id="log-<id>"` / `data-log-id`.

```tsx
<LogViewer items={logs} live={isRunning} height="32rem" title={t('migrationdetail.console')} jumpToId={jumpToId}
  sectionFor={(l) => { const id = matchStepId(l.message); return id && seen.add(id) ? t(`steps.${id}.name`) : null; }} />
```

### Wire — `@/components/ui`
`Wire({ status: 'pending'|'running'|'completed'|'failed'|'cancelled', orientation?: 'horizontal'|'vertical'|'responsive', className })` — the source→target connection (flowing dashes while running, check when done, cross when failed). Points from source to target in both directions (mirrors in RTL). `responsive` (default) is vertical under `lg`.

```tsx
<div className="flex flex-col items-center gap-4 lg:flex-row"><ServerCard … /><Wire status={m.status} /><ServerCard … /></div>
```

### Checklist / ChecklistItem — `@/components/ui`
`Checklist({ progress?: { done, total }, children, className })` — segmented bar + `<ol>`.
`ChecklistItem({ index, title, done, onToggle?, toggleLabel?, description?, action?, children? })` — numbered circle (check when done), title (struck through when done), description, children (a `CodeBlock`), action (a Button), and a `Checkbox` at the end when `onToggle` exists.

```tsx
<Card>
  <CardHeader><CardTitle>{t('migrationdetail.cutover.title')}</CardTitle></CardHeader>
  <Checklist progress={{ done, total: 4 }}>
    <ChecklistItem index={1} title={t('migrationdetail.cutover.hosts')} done={steps.hosts} onToggle={() => toggle('hosts')} toggleLabel={t('migrationdetail.cutover.markDone')}>
      <CodeBlock title="/etc/hosts" code={hostsEntry} />
    </ChecklistItem>
    <ChecklistItem index={4} title={t('migrationdetail.cutover.suspend')} done={!!m.source_suspended_at} action={<Button variant="secondary" onClick={…}>{t('migrationdetail.suspend')}</Button>} />
  </Checklist>
</Card>
```

### Checkbox — `@/components/ui`
`Checkbox(props: InputHTMLAttributes<HTMLInputElement>)` (ref → the native input; `indeterminate` via ref works). Custom-drawn box, brand fill, check/minus icons. `checkboxClasses` (string) styles a raw native checkbox when you must keep one.

### EmptyState / Illustration — `@/components/ui`
`EmptyState({ icon?, illustration?: 'servers'|'migrations'|'keys'|'accounts'|'search'|'log'|'system'|'attention'|'error', title, description?, action?, secondaryAction?, size?: 'sm'|'md' })`. Prefer `illustration` (drawn line art on a dot-grid backdrop); `icon` still works. `Illustration({ name, className })` is also exported for off-state cards.

Which drawing: `error` for every "could not load" / disconnected state (two nodes, a broken wire, a rose
exclamation), `attention` only for the all-clear moment (its check draws itself once), `system` for "no
system info yet", `search` for a filter with no matches, and the entity drawings (`servers`, `migrations`,
`keys`, `accounts`, `log`) for first-run empties.

```tsx
<EmptyState illustration="migrations" title={t('migrations.empty.title')}
  description={<ul className="mt-2 space-y-1 text-start"><li>{t('migrations.empty.b1')}</li><li>{t('migrations.empty.b2')}</li><li>{t('migrations.empty.b3')}</li></ul>}
  action={<Button variant="primary" onClick={() => navigate('/migrations/new')}>{t('nav.newMigration')}</Button>} />
```

### Logo / LogoMark — `@/components/ui`
`Logo({ size?: 'sm'|'md'|'lg', wordmark? = true, className })` — mark + "MVNMigrate" wordmark (always LTR; "MVN" brand, "Migrate" slate). `LogoMark({ className })` — the gradient mark alone. The favicon in `index.html` is the same mark.

### Input / Select / Textarea / Field — `@/components/ui`
As before; `leftIcon` is the **start** icon and `rightSlot` the **end** slot (mirror in RTL). `mono` inputs are forced LTR. `Field` adds the required asterisk with `ms-0.5`.

### Table primitives — `@/components/ui`
`Table` (`dense`, `stickyHeader`, `bare`, `maxHeight`, `wrapperClassName`), `THead`, `TBody`, `TR` (`hoverable`, `selected` = brand tint + 2px start bar, `clickable`), `TH` (`sortable`, `sorted`, `onSort`, `align: 'start'|'center'|'end'` — `'left'`/`'right'` still accepted and mean start/end, `numeric`), `TD` (`mono` = LTR mono, `align`, `numeric`, `muted`, `truncate`), `TDPrimary`.

### Tabs, Modal, ConfirmDialog, CodeBlock, KeyValue, Skeleton, Spinner, Tooltip, Kbd, PageHeader
- `Tabs`: unchanged API; underline active is brand.
- `Modal`: unchanged API; close button `aria-label` is translated.
- `ConfirmDialog`: `confirmLabel` / `cancelLabel` default to `t('confirm.confirm')` / `t('confirm.cancel')`; the "type X to confirm" helper is translated.
- `CodeBlock`: unchanged API, always LTR; `copyToClipboard(text, message?)` toasts translated text.
- `KeyValue`: unchanged API; `mono` values render inside `<Mono>`; grid labels are `.eyebrow`.
- `Skeleton` / `SkeletonTable` / `SkeletonCard`: shimmer instead of pulse; `aria-label` translated.
- `Spinner`: default label translated.
- `Tooltip side`: `'top'|'bottom'|'start'|'end'` (`'left'`/`'right'` map to start/end).
- `Kbd`: unchanged.
- `PageHeader`: `eyebrow` is brand-colored `.eyebrow`, `h1` is `text-2xl font-bold`, `backTo` renders a chevron that mirrors, breadcrumb chevrons mirror.

### Layout (not in barrel)
- `AppShell`: sidebar (Logo, pinned "Production · migration.mvn.co.il" card, primary New migration, grouped nav with `.eyebrow` titles, version footer) + top bar (breadcrumb, ⌘K search box, `LanguageToggle`, `ThemeToggle`). Route changes fade in. Exports `breadcrumbFromPath(pathname, t)`.
- `CommandPalette`: pages, servers (with `PanelMonogram`), migrations and an Actions group (switch language, toggle theme).
- `LanguageToggle`: "עברית | English" segmented control. `ThemeToggle`: light → dark → system.

### lib helpers
- `@/lib/cn` — `cn(...)`.
- `@/lib/i18n` — `LanguageProvider`, `useT`, `useLanguage`, `translate`, `getLocale`, `getLang`, `setLocale`, `LANG_LABELS`, `LANG_STORAGE_KEY`, types `Lang`, `T`, `TVars`.
- `@/lib/format` — `formatBytes`, `formatNumber(n)`, `formatRelativeTime` (strips the "(n)" hint Chrome's ICU appends to Hebrew phrases), `formatDate`, `formatTime`, `formatDuration`, **`formatShortDuration(ms)`** (`0.8s` / `43s` / `3m 02s`), `realDate`, **`runWindow(migration, logs)`** → `{ startedAt?, endedAt?, live }` (fixes the empty Duration/Started cells caused by the Go zero `started_at`), **`parseSizeToBytes('608M' | '3.2G' | '324.8 MB')`**, `shortId`, `percent`, `PANEL_LABELS`, `panelLabel` (English fallback; prefer `t('panel.<type>')`).
- `@/lib/migrationSteps` (pure) — `MIGRATION_STEPS` (13 ids with phase), `STEP_MATCHERS`, `matchStepId(message)`, **`deriveTimeline(logs, migration, { scan?, now? })`** → `TimelineItem[]`, **`parseInventory(logs)`** → `{ files?, bytesLabel?, uploadSeconds?, databases, tables, mailboxes, cronJobs, ssl, websites }`, types `TimelineItem`, `TimelineStatus`, `Inventory`, `StepPhase`.
- `@/lib/useCountUp` — `useCountUp(value, ms = 600)` (rAF ease-out, respects reduced motion).
- `@/lib/theme` — `ThemeProvider`, `useTheme()`, `THEME_STORAGE_KEY`.
- `@/types` — `MigrationLog.metadata?`, `Migration.export_data.account?` are now typed.

---

## 5. Page anatomy

```tsx
export default function Servers() {
  const t = useT();
  return (
    <div className="space-y-6">
      <PageHeader title={t('servers.title')} description={t('servers.description')}
        actions={<Button variant="primary" leftIcon={<PlusIcon />} onClick={openCreate}>{t('servers.add')}</Button>} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{/* Stat tiles answering one question each */}</div>

      <Card flush className="motion-safe:animate-rise stagger" style={{ '--i': 2 } as CSSProperties}>
        <CardHeader divided><CardTitle>{t('servers.all')}</CardTitle></CardHeader>
        {/* SkeletonTable | EmptyState illustration | Table bare stickyHeader */}
      </Card>

      <Modal … /> <ConfirmDialog … />
    </div>
  );
}
```

Rules:
1. **`PageHeader` first**, then a `space-y-6` column of sections. No extra page padding. Do not add your own `h1`.
   The header rises in on its own (`--i` 0); give every section `motion-safe:animate-rise stagger` from `--i` 1
   so all pages load with the same rhythm.
2. **Sections are Cards**, one question each. Two-column layouts: `grid gap-6 lg:grid-cols-3` with `lg:col-span-2`.
3. **Tables live in `<Card flush>` with `<Table bare stickyHeader>`.** Cap tall tables with `maxHeight`.
4. **Gaps**: `gap-4` in grids/toolbars, `gap-2` between buttons, `space-y-4` between fields, `space-y-6` between sections. Never `space-x-*`.
5. **One primary button per view.**
6. **Status → `StatusBadge`**, panel → `PanelBadge` / `PanelMonogram`. Never plain text or hand-colored spans.
7. **Technical values LTR in mono** (`Mono`, `TD mono`, `Input mono`, `KeyValue mono`, `CodeBlock`).
8. **Three states for every list**: `SkeletonTable`, `EmptyState illustration`, data.
9. **Every destructive action** goes through `ConfirmDialog`; high-impact deletes use `confirmText`.
10. **Pending requests**: `Button loading`, `ProgressBar live` for moving bytes, `Badge pulse` via `StatusBadge`.
11. **Forms**: `Field` around each control; errors via `Field error`; submit in Modal `footer` with `form="id"`.
12. **Dates** through `@/lib/format` only (they follow the locale).
13. **Every string through `t()`**, aria-labels and toasts included. Grep for leftovers before finishing.
14. **Headings**: h1 (PageHeader) → h2 (CardTitle) → h3. `aria-label` on every IconButton.

---

## 6. Dark mode pairs (copy these)

| Purpose | Light → Dark |
|---|---|
| Page background | `bg-slate-50 dark:bg-slate-950` |
| Surface | `bg-white dark:bg-slate-900` (or `surfaceClasses`) |
| Sunken surface / table head | `bg-slate-50 dark:bg-white/[0.03]` |
| Border | `border-slate-200 dark:border-white/[0.08]` |
| Control border | `border-slate-200 dark:border-white/[0.1]` |
| Divider | `divide-slate-100 dark:divide-white/[0.06]` |
| Primary text | `text-slate-900 dark:text-slate-100` |
| Body text | `text-slate-700 dark:text-slate-300` |
| Muted text | `text-slate-500 dark:text-slate-400` |
| Faint / icon at rest | `text-slate-400 dark:text-slate-500` |
| Hover row | `hover:bg-slate-50 dark:hover:bg-white/[0.03]` |
| Brand text / link | `text-brand-700 dark:text-brand-300` (`hover:text-brand-600 dark:hover:text-brand-200`) |
| Brand fill | `bg-brand-700 dark:bg-brand-600` with `text-white` |
| Brand tint (selected) | `bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300` |
| Success tint | `bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300` |
| Warning tint | `bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300` |
| Danger tint | `bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300` |
| Danger text | `text-rose-600 dark:text-rose-400` |
| Info tint | `bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300` |
| Focus ring | `ring-brand-500 dark:ring-brand-300` + `ring-offset-white dark:ring-offset-slate-900` |
| Inline code chip | `bg-slate-100 text-slate-900 dark:bg-white/[0.08] dark:text-slate-100` |

Notes:
- Solid semantic dots/bars (`bg-emerald-500`, `bg-rose-500`, `bg-brand-500`) read fine in both themes.
- `CodeBlock` (block) and `LogViewer` are dark in both themes — no `dark:` overrides.
- Never `gray-*`, `indigo-*`, `black`, or hex in pages. Never `bg-white` / `text-slate-900` without a dark pair.
- Audit before finishing: `grep -nE "(bg|text|border|ring|divide)-(white|black|slate|gray|indigo|emerald|amber|rose|sky|violet|blue|orange|brand)-?[0-9]*" src/pages/X.tsx` and check each hit sits next to a `dark:` twin or lives inside a component.

---

## 7. Acceptance checklist for a page

- [ ] Every user-visible string (aria-labels, toasts, placeholders, empty states) goes through `t()`; both languages filled in `src/i18n/pages/<page>.ts`; Hebrew reads native and follows the glossary.
- [ ] No physical direction utilities outside `dir="ltr"` containers; directional icons carry `flip-rtl`.
- [ ] Every domain / IP / id / path / username / command is inside `Mono`, `CodeBlock` or `TD mono`.
- [ ] No `indigo`; brand only where the product is acting; every color utility has its `dark:` pair.
- [ ] Every card answers one question; big tabular figures with `.eyebrow` labels; chips for state; illustrations for off-states.
- [ ] Motion is `motion-safe:` and carries state (header first, sections stagger from `--i` 1, live bar, ring pop).
- [ ] Load errors use `illustration="error"`; `attention` is reserved for the all-clear check.
- [ ] Screenshots: Hebrew + `?lang=en`, light + dark, 1440 and 1280; nothing overflows or misaligns in RTL.
- [ ] `npx tsc --noEmit` clean; no API call, polling loop, route, handler or form field changed.
