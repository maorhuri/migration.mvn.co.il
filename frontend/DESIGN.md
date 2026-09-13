# Migration Tool — Design System Reference

Internal hosting-migration console (MVN). It must read as a premium, trustworthy infrastructure
product (Vercel / Linear / Railway), not a Tailwind demo. This file documents what is **actually
built** in `src/components/ui`, `src/components/layout` and `src/lib`. Use it instead of reading
every component. Keep all routes and API behaviour exactly as they are.

---

## 0. Import paths

`tsconfig.json` defines `"@/*" -> "src/*"` and `vite.config.ts` has the matching `resolve.alias`
(verified: `@/` imports type-check **and** build). Use the barrel:

```tsx
import { Button, Card, CardHeader, CardTitle, StatusBadge, Table, THead, TBody, TR, TH, TD } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatBytes, formatRelativeTime, formatDate, formatDuration, shortId, percent, panelLabel } from '@/lib/format';
import { useTheme } from '@/lib/theme';
```

Relative equivalents from `src/pages/*.tsx`: `'../components/ui'`, `'../lib/cn'`, `'../lib/format'`, `'../lib/theme'`.
Every UI component also has a `default` export, but prefer named imports from the barrel.
Layout components (`AppShell`, `CommandPalette`, `ThemeToggle`) are **not** in the barrel — pages never
render them; `App.tsx` already wraps all routes in `<AppShell>`.

Icons: `@heroicons/react` (installed). Use `/24/outline` for empty states / stats, `/20/solid` or
`/16/solid` inside buttons, badges and table headers. Toasts: `react-hot-toast` (`toast.success(...)`),
already themed in `main.tsx`.

---

## 1. Brief (condensed) and tokens

- **Typography**: Inter (UI), JetBrains Mono (IPs, hosts, ids, paths, logs, code) — both loaded in
  `index.html`. Headings use `tracking-tight` (global). Base 14px (`text-sm` on `body`), 13px in dense tables.
- **Color**: slate neutrals. Light: `bg-slate-50` page, `bg-white` surfaces, `border-slate-200`.
  Dark: `bg-slate-950` page, `bg-slate-900` surfaces, `border-slate-800`. Accent **indigo** (sparingly:
  primary button, active nav, focus rings). Semantic: emerald = success, amber = warning, rose = danger,
  sky = info. Panel identity: violet = Enhance, blue = DirectAdmin, orange = cPanel (sky = CloudPanel,
  neutral = FTP, indigo = WordPress).
- **Shape**: `rounded-xl` (12px) cards/modals, `rounded-lg` (10px) inputs/buttons, `rounded-md` badges.
  1px borders + `shadow-sm`. 24px page padding (AppShell `<main class="p-6">`), 20–24px card padding,
  `space-y-6` between page sections, `gap-4` in grids.
- **Dark mode**: `darkMode: 'class'`; `<html class="dark">` is set before first paint by an inline script
  and managed by `ThemeProvider`. **Every color utility must have a `dark:` counterpart** or come from a component.
- **Motion**: `transition-colors` (150ms default), fade/scale on modals (built in), `animate-ping` dot on
  running status (built into Badge `pulse`), smooth width transition on ProgressBar.
- **Density**: ops tool. Dense, scannable tables; monospace for technical values; status is always a Badge with a dot.
- **States**: every list/table has a `SkeletonTable` loading state and a designed `EmptyState`. Every
  destructive action goes through `ConfirmDialog`. Buttons show a Spinner and are disabled while pending (`loading`).
- **Accessibility**: focus rings are global (`:focus-visible`), `IconButton` requires `aria-label`, use real headings (`h1` from PageHeader, `h2` from CardTitle).

### Token table (as configured in `tailwind.config.js` / `index.css`)

| Token | Value / class | Notes |
|---|---|---|
| Font sans | `font-sans` → Inter, system fallbacks | default on `body` |
| Font mono | `font-mono` → "JetBrains Mono", ui-monospace… | `code, kbd, pre, samp` automatically |
| Text sizes | `text-2xs` = 11px/16px (custom), `text-xs` 12, `text-sm` 14 (base), `text-[13px]` dense tables, `text-base` 16 card titles, `text-2xl` page h1 / Stat value | |
| Page bg | `bg-slate-50` / `dark:bg-slate-950` | set on `body` and AppShell |
| Surface | `bg-white` / `dark:bg-slate-900` | Card, Modal, inputs, sidebar |
| Sunken surface | `bg-slate-50` / `dark:bg-slate-800/60` | table head, modal footer, pills track |
| Border | `border-slate-200` / `dark:border-slate-800` | cards, dividers |
| Control border | `border-slate-200` / `dark:border-slate-700` | inputs, secondary buttons, badges ring |
| Text primary | `text-slate-900` / `dark:text-slate-100` (h1: `dark:text-slate-50`) | |
| Text body | `text-slate-700` / `dark:text-slate-300` | table cells, labels |
| Text muted | `text-slate-500` / `dark:text-slate-400` | descriptions, hints, `th` |
| Text faint | `text-slate-400` / `dark:text-slate-500` | placeholders, icons at rest |
| Accent | `indigo-600` light / `indigo-500` dark for fills; `indigo-600` / `dark:indigo-400` for text | aliases `primary-*` and `brand-*` = indigo scale |
| Semantic aliases | `success-*`=emerald, `warning-*`=amber, `danger-*`=rose, `info-*`=sky, `enhance-*`=violet, `directadmin-*`=blue, `cpanel-*`=orange | raw scales also work; components use the raw scales |
| Radius | `rounded-md` 6px (badges, sm buttons), `rounded-lg` **10px** (custom; inputs, md/lg buttons, code blocks), `rounded-xl` **12px** (custom; cards, modals, table wrapper), `rounded-full` (dots, progress) | |
| Shadow | `shadow-sm` (custom, very soft), `shadow-card`, `shadow-pop` (popovers, hover-lift, tooltip) | |
| Focus ring | `focus-visible:ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-slate-900` | global via `:focus-visible` |
| Motion | `transition-colors` 150ms default; `animate-fade-in`, `animate-scale-in` (150ms), `animate-indeterminate` (1.4s) | |
| Spacing rhythm | page `p-6` (24px); sections `space-y-6`; grids `gap-4`; card `p-5 sm:p-6`; table cells `px-4 py-2.5`; buttons `h-8/h-9/h-10` | |
| Layout | sidebar 64px (`<lg`) / 264px (`lg`), top bar 56px, content `max-w-[1440px] mx-auto` | AppShell |
| Utilities | `.tabular` (tabular-nums), `.text-balance`, `.scrollbar-none` | custom in `index.css` |
| Legacy classes | `.card .btn .btn-primary .btn-secondary .btn-danger .input .label` | still defined (restyled) but **do not use in new code** |

---

## 2. Component reference

All components take `className` (appended last via `cn`, so overrides win) and forward native HTML
attributes unless noted. "Ref" = `forwardRef`.

### Button — `@/components/ui`
`ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>` (ref → `HTMLButtonElement`)

| Prop | Type | Default |
|---|---|---|
| variant | `'primary' \| 'secondary' \| 'ghost' \| 'danger' \| 'outline'` | `'secondary'` |
| size | `'sm' \| 'md' \| 'lg'` (h-8 / h-9 / h-10) | `'md'` |
| loading | `boolean` — shows Spinner, sets `disabled` + `aria-busy` | `false` |
| leftIcon / rightIcon | `ReactNode` (svg auto-sized 16px, 20px at lg) | — |
| fullWidth | `boolean` | — |
| type | native | `'button'` (so it never submits by accident) |

Also exported: `buttonBaseClasses`, `buttonVariantClasses`, `buttonSizeClasses`, types `ButtonVariant`, `ButtonSize`.

```tsx
<Button variant="primary" leftIcon={<PlusIcon />} onClick={openCreate}>Add server</Button>
<Button variant="secondary" size="sm" onClick={refresh} loading={refreshing}>Refresh</Button>
<Button variant="danger" onClick={() => setConfirmOpen(true)}>Delete</Button>
<Button type="submit" form="server-form" variant="primary" loading={saving}>Save</Button>
```
**Do**: one `primary` per view; `ghost` for toolbar/inline row actions; `danger` only behind `ConfirmDialog`; pass `loading` while awaiting a request.
**Don't**: use `.btn` classes; add your own spinner; set `disabled` *and* `loading` (loading already disables).

### IconButton — `@/components/ui`
`IconButtonProps extends Omit<ButtonHTMLAttributes, 'children'>` (ref → `HTMLButtonElement`)

| Prop | Type | Default |
|---|---|---|
| `'aria-label'` | `string` — **required** | — |
| icon | `ReactNode` — **required** | — |
| variant | `ButtonVariant` | `'ghost'` |
| size | `'xs' \| 'sm' \| 'md' \| 'lg'` (24 / 32 / 36 / 40 px square) | `'md'` |
| loading | `boolean` | — |
| tone | `'default' \| 'danger' \| 'success' \| 'brand'` — hover color of the icon | `'default'` |

```tsx
<Tooltip content="Delete key">
  <IconButton aria-label="Delete key" icon={<TrashIcon />} tone="danger" size="sm" onClick={() => askDelete(key)} />
</Tooltip>
```
**Do**: use in table row action cells (`size="sm"`), wrap in `Tooltip` or pass `title`. **Don't**: put text children in it.

### Card family — `@/components/ui`
- `Card` (`CardProps extends HTMLAttributes<HTMLDivElement>`, ref): `flush?: boolean` (no inner padding — use when it holds a Table / SkeletonTable / EmptyState list), `interactive?: boolean` (hover lift + pointer), `accent?: 'brand'|'success'|'warning'|'danger'|'info'|'violet'|'blue'|'orange'` (4px left strip).
- `CardHeader` (`actions?: ReactNode`, `divided?: boolean`): title row; `divided` draws a bottom border and adds its own padding (use inside `flush` cards). Non-divided gets `mb-4`.
- `CardTitle` (`as?: 'h2'|'h3'|'h4'` = `'h2'`), `CardDescription`.
- `CardContent` (`padded?: boolean` — only needed inside a `flush` card).
- `CardFooter` (`divided?: boolean` = `true`): right-aligned button row with top border.

```tsx
<Card>
  <CardHeader actions={<Button size="sm" variant="secondary">Edit</Button>}>
    <CardTitle>Connection</CardTitle>
    <CardDescription>SSH settings used for this server.</CardDescription>
  </CardHeader>
  <KeyValue items={[{ label: 'Host', value: server.host, mono: true }, { label: 'Port', value: server.port }]} />
</Card>

<Card flush>
  <CardHeader divided actions={<Button variant="primary" size="sm">New</Button>}><CardTitle>Servers</CardTitle></CardHeader>
  <Table bare stickyHeader>…</Table>
</Card>
```
**Do**: tables/lists in `<Card flush>` + `<Table bare>`; sections = one Card each; `space-y-6` between cards. **Don't**: use `.card`; nest Cards; put padding on a `flush` card's Table.

### Badge — `@/components/ui`
`BadgeProps extends HTMLAttributes<HTMLSpanElement>` (ref)

| Prop | Type | Default |
|---|---|---|
| tone | `'neutral'\|'brand'\|'success'\|'warning'\|'danger'\|'info'\|'violet'\|'blue'\|'orange'` | `'neutral'` |
| size | `'sm' \| 'md'` (h-5 / h-6) | `'md'` |
| dot | `boolean` — leading status dot | — |
| pulse | `boolean` — animate the dot (running/live) | — |
| icon | `ReactNode` (auto-sized) | — |
| mono | `boolean` — monospace label (versions, ids) | — |

Also exported: `badgeToneClasses`, `badgeDotClasses`, types `BadgeTone`, `BadgeSize`.

```tsx
<Badge tone="info" size="sm">{count} accounts</Badge>
<Badge tone="neutral" mono>v{server.panel_version}</Badge>
<Badge tone="success" dot>Verified</Badge>
```
**Do**: short labels only; counts, flags, versions. **Don't**: hand-roll status badges — use `StatusBadge` / `PanelBadge`.

### StatusBadge — `@/components/ui`
`StatusBadgeProps extends Omit<BadgeProps, 'tone'|'dot'|'pulse'|'children'>` — `status: AnyStatus` (required), `label?: string` (override auto label). Always renders `dot`.
Mapping (`STATUS_META`, case-insensitive; unknown strings → neutral badge with raw text):

| status | tone | label | pulse |
|---|---|---|---|
| pending | neutral | Pending | |
| running | brand (indigo) | Running | yes |
| completed | success | Completed | |
| failed | danger | Failed | |
| cancelled | warning | Cancelled | |
| error / warning | danger / warning | Error / Warning | |
| unknown | neutral | Not tested | |
| testing | info | Testing | yes |
| success / connected | success | Connected | |
| disconnected / offline / suspended | danger | Disconnected / Offline / Suspended | |
| online / active | success | Online / Active | |

Also exported: `statusMeta(status)` → `{ tone, label, pulse? }` (use it to pick a ProgressBar/Card tone), `STATUS_META`, types `MigrationStatus`, `ConnectionStatus`, `StepStatus`, `AccountStatus`, `AnyStatus`.

```tsx
<StatusBadge status={migration.status} />
<StatusBadge status={server.connection_status ?? 'unknown'} size="sm" />
<StatusBadge status="running" label="Syncing files" />
```
**Do**: use for every status in tables, headers (`PageHeader meta`), cards. **Don't**: render status as plain text or a colored `<span>`.

### PanelBadge — `@/components/ui`
`PanelBadgeProps extends Omit<BadgeProps, 'tone'|'children'>` — `panelType: string | null | undefined` (required), `compact?: boolean` (dot only, for dense tables). Label comes from `panelLabel()`: DirectAdmin / Enhance / cPanel / CloudPanel / FTP Only / WordPress Only / Unknown. Also exported: `PANEL_TONES`, `panelTone(panelType)` → `BadgeTone`.

```tsx
<PanelBadge panelType={server.panel_type} />
<PanelBadge panelType={server.panel_type} size="sm" compact />
```

### Input — `@/components/ui`
`InputProps extends Omit<InputHTMLAttributes, 'size'>` (ref → `HTMLInputElement`)

| Prop | Type | Default |
|---|---|---|
| mono | `boolean` — IPs, hosts, ids, paths | — |
| invalid | `boolean` — rose border, `aria-invalid` (Field sets it from `error`) | — |
| size | `'sm' \| 'md'` (h-8 / h-9) | `'md'` |
| leftIcon | `ReactNode` (16px, wraps input in a relative div) | — |
| rightSlot | `ReactNode` (e.g. a small IconButton, unit text) | — |

Also exported: `inputBaseClasses`, `inputBorderClasses(invalid)`, `inputSizeClasses` (for custom controls).

```tsx
<Field label="Host" required hint="IP or hostname">
  <Input mono placeholder="203.0.113.10" value={form.host} onChange={(e) => set('host', e.target.value)} />
</Field>
<Input size="sm" leftIcon={<MagnifyingGlassIcon />} placeholder="Filter servers…" value={q} onChange={(e) => setQ(e.target.value)} />
```
**Do**: `mono` for every technical value; `size="sm"` for toolbar filters. **Don't**: use `.input`; pass `size` expecting the HTML attribute (it is the visual size).

### Select — `@/components/ui`
`SelectProps extends Omit<SelectHTMLAttributes, 'size'>` (ref) — `invalid?: boolean`, `size?: 'sm'|'md'` = `'md'`, `options?: SelectOption[]` (`{ value: string; label: string; disabled?: boolean }`), `placeholder?: string` (adds an `<option value="">`). Pass either `options` or `<option>` children. Native select with custom chevron.

```tsx
<Field label="Panel type">
  <Select value={form.panel_type} onChange={(e) => set('panel_type', e.target.value)}
    options={[{ value: 'enhance', label: 'Enhance' }, { value: 'directadmin', label: 'DirectAdmin' }]} placeholder="Choose…" />
</Field>
```

### Textarea — `@/components/ui`
`TextareaProps extends TextareaHTMLAttributes` (ref) — `invalid?: boolean`, `mono?: boolean` (SSH keys, code; also drops to `text-xs`), `rows` default `4`.

```tsx
<Field label="Private key" error={errors.private_key}>
  <Textarea mono rows={8} value={form.private_key} onChange={…} placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" />
</Field>
```

### Field — `@/components/ui`
Not a native wrapper. Props: `label: ReactNode` (required), `htmlFor?: string` (auto-generated id otherwise), `hint?: ReactNode`, `error?: ReactNode`, `required?: boolean` (red asterisk), `labelAddon?: ReactNode` (right of label, e.g. "Optional"), `className?`, `children: ReactNode` — **exactly one** child control. It clones the child injecting `id`, `aria-describedby` and `invalid: true` when `error` is set. `error` wins over `hint` and renders with `role="alert"`.

```tsx
<div className="grid gap-4 sm:grid-cols-2">
  <Field label="Name" required error={errors.name}><Input value={name} onChange={…} /></Field>
  <Field label="SSH port" hint="Default 22" labelAddon="Optional"><Input mono inputMode="numeric" value={port} onChange={…} /></Field>
</div>
```
**Do**: every form control goes through Field; group with `grid gap-4 sm:grid-cols-2` or `space-y-4`. **Don't**: pass two children (throws — `Children.only`); use `.label`.

### Table primitives — `@/components/ui`
`Table` (`TableProps extends HTMLAttributes<HTMLTableElement>`, ref): `dense?: boolean` = `true` (13px text), `stickyHeader?: boolean`, `bare?: boolean` (no own border/radius — **set when inside `<Card flush>`**), `maxHeight?: string` (e.g. `'60vh'`, makes the wrapper scroll), `wrapperClassName?: string`. Renders `div.overflow-auto > table`.
`THead`, `TBody` (divide-y hairlines), `TR` (`hoverable?` = `true`, `selected?`, `clickable?` → pointer + `role="button"` + `tabIndex` + Enter/Space triggers `onClick`), `TH` (`sortable?`, `sorted?: 'asc'|'desc'|false|null`, `onSort?`, `align?: 'left'|'center'|'right'`, `numeric?` → right + tabular), `TD` (`mono?`, `align?`, `numeric?`, `muted?`, `truncate?` — set a `max-w-*` via className), `TDPrimary` (dark, medium weight — the row's name/domain). Type `SortDirection`.

```tsx
<Card flush>
  <CardHeader divided actions={<Input size="sm" leftIcon={<MagnifyingGlassIcon />} placeholder="Filter…" />}><CardTitle>Servers</CardTitle></CardHeader>
  {loading ? <SkeletonTable rows={6} columns={5} /> : servers.length === 0 ? (
    <EmptyState icon={ServerStackIcon} title="No servers yet" description="Add a source or target server to start migrating."
      action={<Button variant="primary" leftIcon={<PlusIcon />} onClick={openCreate}>Add server</Button>} />
  ) : (
    <Table bare stickyHeader maxHeight="70vh">
      <THead><TR hoverable={false}>
        <TH sortable sorted={sort.key === 'name' && sort.dir} onSort={() => toggleSort('name')}>Name</TH>
        <TH>Host</TH><TH>Panel</TH><TH>Status</TH><TH numeric>Accounts</TH><TH align="right"><span className="sr-only">Actions</span></TH>
      </TR></THead>
      <TBody>
        {servers.map((s) => (
          <TR key={s.id} clickable onClick={() => navigate(`/servers/${s.id}`)}>
            <TDPrimary>{s.name}</TDPrimary>
            <TD mono>{s.host}</TD>
            <TD><PanelBadge panelType={s.panel_type} size="sm" /></TD>
            <TD><StatusBadge status={s.connection_status ?? 'unknown'} size="sm" /></TD>
            <TD numeric>{s.account_count}</TD>
            <TD align="right" onClick={(e) => e.stopPropagation()}><IconButton aria-label="Delete" icon={<TrashIcon />} size="sm" tone="danger" /></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )}
</Card>
```
**Do**: `TH` for column headers (adds `scope="col"`), `TDPrimary` for the name column, `mono` for host/IP/id/path, `numeric` for counts/sizes, `stopPropagation` on action cells in clickable rows. **Don't**: raw `<table className="min-w-full divide-y …">`; pad the table; use `size="md"` badges in dense rows (use `sm`).

### EmptyState — `@/components/ui`
Props: `icon?: ComponentType<SVGProps<SVGSVGElement>>` (pass the heroicon component, **not** an element), `title: ReactNode` (required), `description?: ReactNode`, `action?: ReactNode` (a primary Button), `secondaryAction?: ReactNode`, `size?: 'sm'|'md'` = `'md'` (`sm` inside cards/logs), `className?`.

```tsx
<EmptyState icon={ArrowsRightLeftIcon} title="No migrations" description="Start a migration to move an account between servers."
  action={<Button variant="primary" onClick={() => navigate('/migrations/new')}>New migration</Button>} />
```
**Do**: always give a next step unless read-only. **Don't**: `icon={<Icon />}` (type error).

### Skeleton, SkeletonTable, SkeletonCard — `@/components/ui`
- `Skeleton` (`SkeletonProps extends HTMLAttributes<HTMLDivElement>`): `shape?: 'rect'|'text'|'circle'` = `'rect'`; size it with className (`h-4 w-32`). `aria-hidden`.
- `SkeletonTable`: `rows?` = `5`, `columns?` = `5`, `header?` = `true`, `className?`. Drop inside `<Card flush>`; has `role="status"`.
- `SkeletonCard`: `lines?` = `3`, `className?`. Full card-shaped placeholder (own border).

```tsx
{loading ? <SkeletonTable rows={6} columns={4} /> : …}
{loading ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0,1,2,3].map((i) => <Stat key={i} label="…" value="" loading />)}</div> : …}
<Skeleton className="h-4 w-48" /> <Skeleton shape="circle" className="h-8 w-8" />
```
**Do**: mirror the final layout (same columns). **Don't**: show a page-centred Spinner for list loading.

### Spinner — `@/components/ui`
Props: `size?: 'sm'|'md'|'lg'|'xl'` (14/18/24/32px) = `'md'`, `className?`, `label?` = `'Loading'` (`role="status"`). Uses `currentColor` — wrap in a text color (`className="text-indigo-500"`).
```tsx
<Spinner size="lg" className="text-slate-400" label="Loading migration" />
```
**Do**: inline "working" indicators (testing a connection). **Don't**: add it to a Button manually (`loading` does that).

### PageHeader — `@/components/ui`
Props: `title: ReactNode` (required, renders `h1`), `description?`, `eyebrow?` (small indigo uppercase text above title; hidden when `breadcrumb` given), `breadcrumb?: Crumb[]` (`{ label: ReactNode; to?: string }`), `actions?: ReactNode` (right), `meta?: ReactNode` (badges beside title), `backTo?: string` (32px back button), `className?`. The AppShell top bar already shows a route breadcrumb — use `breadcrumb` only for extra depth (e.g. server name).

```tsx
<PageHeader
  backTo="/migrations"
  eyebrow="Migration"
  title={migration.account_username}
  description={`${source?.name ?? '?'} → ${target?.name ?? '?'} · started ${formatRelativeTime(migration.created_at)}`}
  meta={<StatusBadge status={migration.status} />}
  actions={<><Button variant="secondary" leftIcon={<ArrowPathIcon />} onClick={reload}>Refresh</Button><Button variant="danger" onClick={() => setCancelOpen(true)}>Cancel</Button></>}
/>
```
**Do**: first element of every page, followed by `space-y-6` sections. **Don't**: add another `h1`.

### Stat — `@/components/ui`
Props: `label: ReactNode`, `value: ReactNode` (required; big tabular `text-2xl`), `hint?`, `icon?: ComponentType<SVGProps<SVGSVGElement>>`, `tone?: StatTone` (`'neutral'|'brand'|'success'|'warning'|'danger'|'info'|'violet'|'blue'|'orange'`) = `'neutral'` (tints the icon box), `interactive?`, `loading?` (value skeleton), `className?`. It is its own card — do not wrap in `Card`.

```tsx
<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
  <Stat label="Servers" value={servers.length} icon={ServerStackIcon} tone="brand" />
  <Stat label="Running" value={running} icon={ArrowsRightLeftIcon} tone="info" hint={`${completedToday} completed today`} />
  <Stat label="Failed" value={failed} icon={ExclamationTriangleIcon} tone="danger" loading={loading} />
</div>
```

### ProgressBar — `@/components/ui`
Props: `value?: number` (0–100, clamped/rounded) = `0`, `tone?: 'brand'|'success'|'warning'|'danger'|'info'|'neutral'` = `'brand'`, `indeterminate?`, `size?: 'xs'|'sm'|'md'` (4/6/8px) = `'sm'`, `showValue?` ("42%" on the right), `label?` (aria-label), `className?`. Width animates 500ms.

```tsx
<ProgressBar value={percent(migration.completed_steps, migration.total_steps)} showValue label="Migration progress"
  tone={migration.status === 'failed' ? 'danger' : migration.status === 'completed' ? 'success' : 'brand'} />
<ProgressBar indeterminate size="xs" label="Testing connection" />
```
**Do**: running = brand, completed = success, failed = danger. Use `percent()` from `@/lib/format`.

### Stepper — `@/components/ui`
Props: `steps: Step[]` (`{ id: string; label: ReactNode; description?: ReactNode }`), `current: number` (index), `completedUpTo?: number` = `current - 1`, `error?: number | null` (index rendered rose), `running?: boolean` (spinner in the current circle), `orientation?: 'horizontal'|'vertical'` = `'horizontal'`, `onStepClick?: (index) => void` (only completed steps become clickable), `className?`. Also exported: `stepState(index, current, completedUpTo, error)` → `'complete'|'current'|'upcoming'|'error'`, types `Step`, `StepState`.

```tsx
// Wizard rail
<Stepper steps={[{ id: 'source', label: 'Source' }, { id: 'account', label: 'Account' }, { id: 'target', label: 'Target' }, { id: 'review', label: 'Review' }]}
  current={step} onStepClick={setStep} />
// Running migration
<Stepper orientation="vertical" running={m.status === 'running'} steps={m.steps.map((s) => ({ id: s.id, label: s.name, description: s.message }))}
  current={currentIdx} completedUpTo={currentIdx - 1} error={failedIdx} />
```

### Modal — `@/components/ui`
Headless UI dialog with backdrop + fade/scale. Props: `open: boolean`, `onClose: () => void` (required), `title?`, `description?`, `size?: 'sm'|'md'|'lg'|'xl'` (max-w-sm / lg / 2xl / 4xl) = `'md'`, `footer?: ReactNode` (right-aligned button row on a sunken strip), `hideClose?`, `flush?` (no body padding — lists), `initialFocus?: MutableRefObject<HTMLElement | null>`, `children`, `className?`. Body scrolls; panel max height = viewport − 2rem.

Forms: give the `<form>` an `id` and put `type="submit" form="that-id"` buttons in `footer`.
```tsx
<Modal open={open} onClose={close} title="Add server" description="Connect a new panel or SSH host." size="lg"
  footer={<><Button variant="secondary" onClick={close}>Cancel</Button><Button variant="primary" type="submit" form="server-form" loading={saving}>Save server</Button></>}>
  <form id="server-form" onSubmit={handleSubmit} className="grid gap-4 sm:grid-cols-2">
    <Field label="Name" required><Input value={form.name} onChange={…} /></Field>
    …
  </form>
</Modal>
```
**Do**: keep Modal mounted and toggle `open` (transitions need it). **Don't**: nest a Modal in a Modal; build your own overlay.

### ConfirmDialog — `@/components/ui`
Props: `open`, `onClose`, `onConfirm: () => void | Promise<void>` (dialog shows loading until the promise settles), `title: ReactNode` (required), `message?`, `confirmLabel?` = `'Confirm'`, `cancelLabel?` = `'Cancel'`, `tone?: 'danger'|'warning'|'brand'` = `'danger'` (danger → red confirm button; others → primary), `loading?` (external override), `confirmText?: string` (user must type it exactly — use for server/migration deletes), `children?` (extra content under the message). Cancel gets initial focus; closing is blocked while loading.

```tsx
<ConfirmDialog open={!!toDelete} onClose={() => setToDelete(null)} title="Delete server?"
  message={<>This removes <span className="font-medium">{toDelete?.name}</span> and its stored credentials. Migrations referencing it keep their history.</>}
  confirmLabel="Delete server" confirmText={toDelete?.name}
  onConfirm={async () => { await deleteServer(toDelete!.id); toast.success('Server deleted'); setToDelete(null); reload(); }} />
```
**Do**: every delete / cancel-migration / disconnect goes through it. **Don't**: `window.confirm`.

### Tabs — `@/components/ui`
Generic `Tabs<T extends string>`. Props: `tabs: TabItem<T>[]` (`{ id: T; label: ReactNode; count?: number | string; icon?: ReactNode; disabled?: boolean }`), `value: T`, `onChange: (id: T) => void`, `variant?: 'underline'|'pills'` = `'underline'` (underline = page-level sections, pills = filter chips inside cards/toolbars), `size?: 'sm'|'md'` = `'md'`, `className?`. Renders only the strip (`role="tablist"`); render the panel yourself.

```tsx
const [tab, setTab] = useState<'overview' | 'accounts' | 'logs'>('overview');
<Tabs value={tab} onChange={setTab} tabs={[{ id: 'overview', label: 'Overview' }, { id: 'accounts', label: 'Accounts', count: accounts.length }, { id: 'logs', label: 'Logs' }]} />
<Tabs variant="pills" size="sm" value={statusFilter} onChange={setStatusFilter} tabs={[{ id: 'all', label: 'All' }, { id: 'running', label: 'Running', count: n }]} />
```

### KeyValue — `@/components/ui`
Props: `items: KeyValueItem[]` (`{ label: ReactNode; value: ReactNode; mono?: boolean; span?: boolean }`), `layout?: 'rows'|'grid'` = `'rows'` (rows = label left/value right in cards; grid = uppercase label above value, for info panels), `columns?: 2|3|4|6` = `4` (grid only), `mono?` (all values), `divided?` (rows only, hairlines), `className?`. `null`/`undefined` values render "—".

```tsx
<KeyValue layout="grid" columns={3} items={[
  { label: 'Host', value: server.host, mono: true },
  { label: 'Panel', value: <PanelBadge panelType={server.panel_type} size="sm" /> },
  { label: 'Last tested', value: formatRelativeTime(server.last_tested_at) },
]} />
<KeyValue divided items={[{ label: 'Migration id', value: shortId(m.id), mono: true }, { label: 'Duration', value: formatDuration(m.started_at, m.finished_at) }]} />
```

### CodeBlock — `@/components/ui`
Props: `code: string` (required), `title?` (caption, e.g. `/etc/hosts`), `language?` (display chip), `wrap?` = `true`, `noCopy?`, `copiedMessage?`, `inline?` (single-line chip with copy button, light surface), `className?`. Block variant is **always dark** (slate-950, emerald text) in both themes. Also exported: `copyToClipboard(text, message?)` → `Promise<boolean>` (fires a toast).

```tsx
<CodeBlock title="/etc/hosts" code={`${target.ip}  ${domain} www.${domain}`} />
<CodeBlock inline code={migration.id} />
```

### LogViewer — `@/components/ui`
Props: `items: LogItem[]` (`{ id: string; level: 'info'|'warn'|'error'|'debug'|string; message: string; created_at: string }`), `follow?` = `true` (auto-scroll until the user scrolls up; "Jump to latest" button re-enables), `filterable?` = `true` (All / Info / Warn / Error pills with counts), `height?` = `'24rem'`, `live?` (pulsing green dot), `title?` = `'Log'`, `emptyMessage?` = `'No log lines yet'`, `className?`. Dark console in both themes; `role="log"`. Level `warning` is treated as `warn`.

```tsx
<LogViewer items={logs} live={migration.status === 'running'} height="32rem" title="Migration log" />
```
**Do**: pass API log objects directly (`id`, `level`, `message`, `created_at` match `MigrationLog`). **Don't**: wrap in a Card with padding — it has its own frame; put it directly in a section or in `<Card flush>`.

### Tooltip — `@/components/ui`
Props: `content: ReactNode`, `children: ReactNode`, `side?: 'top'|'bottom'|'left'|'right'` = `'top'`, `className?` (wrapper is `inline-flex`). Pure CSS (hover + focus-within), no portal — keep content short and avoid inside `overflow-hidden` containers where it would clip.
```tsx
<Tooltip content="Test connection"><IconButton aria-label="Test connection" icon={<SignalIcon />} size="sm" /></Tooltip>
```

### Kbd — `@/components/ui`
`HTMLAttributes<HTMLElement>`. Key cap: `<Kbd>⌘</Kbd><Kbd>K</Kbd>`.

### Layout (not in barrel; pages do not render these)
- `AppShell` (`@/components/layout/AppShell`): sidebar + top bar (breadcrumb from route, ⌘K search, ThemeToggle), `<main class="mx-auto w-full max-w-[1440px] p-6">{children}</main>`. Exports `breadcrumbFromPath(pathname)` and `BreadcrumbItem`.
- `CommandPalette` (`open`, `onClose`): ⌘K / Ctrl+K palette searching pages, servers, migrations.
- `ThemeToggle` (`className?`): cycles light → dark → system.

### lib helpers
- `cn(...inputs: ClassValue[]): string` — `@/lib/cn`. Joins strings / arrays / `{ class: bool }`; no tailwind-merge, so put overriding classes last and avoid conflicting utilities.
- `@/lib/format`:
  - `formatBytes(bytes: number|string|null|undefined, decimals = 1)` → `"1.5 KB"`, `"0 B"` for empty.
  - `formatRelativeTime(input, now = new Date())` → `"just now" | "3 minutes ago" | "in 2 hours"`; > 30 days falls back to `formatDate`; `"—"` for empty/invalid.
  - `formatDate(input, opts?: Intl.DateTimeFormatOptions)` → `"Sep 13, 2026, 10:42"`; `"—"` for empty.
  - `formatTime(input)` → `"10:42:07"` (24h); `""` for empty.
  - `formatDuration(start, end?)` → `"1h 04m 12s" | "3m 02s" | "45s"`; a number `start` alone = milliseconds; `end` omitted = now; `"—"` if invalid.
  - `shortId(id, length = 8)` — first 8 chars of a uuid.
  - `percent(part, total)` → integer 0–100 (0 when total ≤ 0).
  - `PANEL_LABELS`, `panelLabel(panelType)` → `"DirectAdmin" | "Enhance" | "cPanel" | "CloudPanel" | "FTP Only" | "WordPress Only" | "Unknown"`.
- `@/lib/theme`: `ThemeProvider` (already in `main.tsx`), `useTheme()` → `{ theme: 'light'|'dark'|'system', resolvedTheme: 'light'|'dark', setTheme(theme), toggleTheme() }`, `THEME_STORAGE_KEY = 'mt-theme'`. Pages rarely need it — use `dark:` classes instead.

---

## 3. Page anatomy

```tsx
export default function Servers() {
  return (
    <div className="space-y-6">
      <PageHeader title="Servers" description="Source and target hosts available for migrations."
        actions={<Button variant="primary" leftIcon={<PlusIcon />} onClick={openCreate}>Add server</Button>} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{/* Stat tiles (optional) */}</div>

      <Card flush>
        <CardHeader divided><CardTitle>All servers</CardTitle></CardHeader>
        {/* SkeletonTable | EmptyState | Table bare stickyHeader */}
      </Card>

      <Modal … /> <ConfirmDialog … />
    </div>
  );
}
```

Rules:
1. **`PageHeader` first**, then a `space-y-6` column of sections. No extra page padding (AppShell provides 24px). Do not add your own `h1`.
2. **Sections are Cards.** Title via `CardHeader` + `CardTitle` (`h2`); descriptive copy in `CardDescription`. Two-column layouts: `grid gap-6 lg:grid-cols-3` with `lg:col-span-2` for the main column.
3. **Tables live in `<Card flush>` with `<Table bare stickyHeader>`** (no inner padding). Use `CardHeader divided` for the title/toolbar row. Cap tall tables with `maxHeight`.
4. **Gaps**: `gap-4` (16px) inside grids and toolbars, `gap-2` between buttons, `space-y-4` between form fields, `space-y-6` between sections.
5. **One primary button per view** — usually in `PageHeader actions` (or the modal footer while a modal is open). Everything else is `secondary` / `ghost`; row actions are `IconButton size="sm"`.
6. **Status → `StatusBadge`** everywhere (tables `size="sm"`, headers `meta`). Panel type → `PanelBadge`. Never plain text or hand-colored spans.
7. **Technical values in mono**: `TD mono`, `Input mono`, `KeyValue item.mono`, `Badge mono`, `CodeBlock`. Applies to IPs, hostnames, ports, ids, usernames, paths, versions, commands.
8. **Every list/table has three states**: `SkeletonTable` (loading), `EmptyState` (empty, with a next-step action), data. Handle errors with a toast and keep the last good data.
9. **Every destructive action** (delete server/key, cancel migration) opens `ConfirmDialog`; high-impact deletes use `confirmText`.
10. **Pending requests**: `Button loading` (never a bare disabled button), `ProgressBar` for migration progress, `Badge pulse` (via `StatusBadge`) for running.
11. **Forms**: `Field` around each control; validation errors via `Field error`; submit button in Modal `footer` with `form="id"`.
12. **Dates**: `formatRelativeTime` in tables (with `title={formatDate(x)}` for the absolute), `formatDate` in detail panels, `formatDuration` for run times, `formatBytes` for sizes (`TD numeric`).
13. **Headings hierarchy**: h1 (PageHeader) → h2 (CardTitle) → h3 (`CardTitle as="h3"` / EmptyState). `aria-label` on every IconButton.

---

## 4. Legacy → new mapping

| Legacy (in pages today) | Replace with |
|---|---|
| `<div className="card">` | `<Card>` (or `<Card flush>` when it holds a table) |
| `<div className="card"><h2 …>Title</h2>` | `<Card><CardHeader><CardTitle>Title</CardTitle></CardHeader>…` |
| `<button className="btn btn-primary">` | `<Button variant="primary">` |
| `<button className="btn btn-secondary">` | `<Button variant="secondary">` (default) |
| `<button className="btn btn-danger">` | `<Button variant="danger">` behind `ConfirmDialog` |
| icon-only `<button>` with an svg | `<IconButton aria-label="…" icon={<Icon />} size="sm" />` |
| `<input className="input">` | `<Input>` (add `mono` for hosts/IPs/ids); wrap in `<Field label>` |
| `<select className="input">` | `<Select>` in `<Field>` |
| `<textarea className="input">` | `<Textarea>` (`mono` for keys) in `<Field>` |
| `<label className="label">X</label>` + control | `<Field label="X">control</Field>` |
| `<p className="text-sm text-red-600">error</p>` | `Field error={…}` |
| status text / colored `<span>` / `getStatusColor()` helpers | `<StatusBadge status={…} />` |
| panel-type text / colored spans | `<PanelBadge panelType={…} />` |
| raw `<table className="min-w-full divide-y …">` | `Table` / `THead` / `TBody` / `TR` / `TH` / `TD` / `TDPrimary` (`bare` inside `Card flush`) |
| `<div>Loading...</div>` / centred spinner for lists | `<SkeletonTable>` / `<Stat loading>` / `<SkeletonCard>` |
| `<p>No servers found.</p>` | `<EmptyState icon title description action>` |
| `window.confirm('Delete?')` | `<ConfirmDialog>` |
| `<h1 className="text-2xl font-bold">` + header row | `<PageHeader title actions>` |
| `<pre>` for commands / hosts entries | `<CodeBlock code title>` |
| ad-hoc log lists | `<LogViewer items>` |
| stat boxes with big numbers | `<Stat label value icon tone>` |
| `bg-primary-600`, `text-primary-700` | still valid (indigo alias) but prefer `Button`, or write `indigo-*` with `dark:` pairs |
| `gray-*` colors | `slate-*` with `dark:` pairs |
| `rounded-md` on cards/inputs | components decide (`rounded-xl` / `rounded-lg`) |

---

## 5. Dark mode rules

`darkMode: 'class'`. The `dark` class is applied to `<html>` by an inline script (before first paint)
and by `ThemeProvider`. **Every color utility you write must have a `dark:` counterpart** (background,
text, border, ring, divide, placeholder, hover states). Components already handle their own colors —
the simplest way to be correct is to use them and write as few raw color classes as possible.

Correct pairs (copy these):

| Purpose | Light → Dark |
|---|---|
| Page background | `bg-slate-50 dark:bg-slate-950` |
| Surface | `bg-white dark:bg-slate-900` |
| Sunken surface / table head | `bg-slate-50 dark:bg-slate-800/60` |
| Border | `border-slate-200 dark:border-slate-800` |
| Control border | `border-slate-200 dark:border-slate-700` |
| Divider | `divide-slate-100 dark:divide-slate-800` |
| Primary text | `text-slate-900 dark:text-slate-100` |
| Body text | `text-slate-700 dark:text-slate-300` |
| Muted text | `text-slate-500 dark:text-slate-400` |
| Faint / icon at rest | `text-slate-400 dark:text-slate-500` |
| Hover row | `hover:bg-slate-50 dark:hover:bg-slate-800/50` |
| Accent text / link | `text-indigo-600 dark:text-indigo-400` (`hover:text-indigo-500 dark:hover:text-indigo-300`) |
| Accent fill | `bg-indigo-600 dark:bg-indigo-500` with `text-white` |
| Accent tint (selected) | `bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300` |
| Success tint | `bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300` |
| Warning tint | `bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300` |
| Danger tint | `bg-rose-50 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300` |
| Danger text | `text-rose-600 dark:text-rose-400` |
| Info tint | `bg-sky-50 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300` |
| Focus ring offset | `ring-offset-white dark:ring-offset-slate-900` |
| Inline code chip | `bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100` |

Notes:
- Solid semantic dots/bars (`bg-emerald-500`, `bg-rose-500`, `bg-indigo-500`) read fine in both themes and need no pair.
- `CodeBlock` (block variant) and `LogViewer` are intentionally dark in both themes — do not add `dark:` overrides to them.
- Never use `gray-*`, `black`, or hard-coded hex in pages. Never leave `bg-white` / `text-gray-900` without a dark pair.
- `useTheme()` is for JS-side needs only (e.g. choosing an image); for styling always use `dark:` classes.
- Quick audit before finishing a page: `grep -nE "(bg|text|border|ring|divide)-(white|black|slate|gray|indigo|emerald|amber|rose|sky|violet|blue|orange)-?[0-9]*" src/pages/X.tsx` and check each hit sits next to a `dark:` twin or lives inside a component.
