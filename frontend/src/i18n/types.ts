/** Flat key -> text dictionary. Keys are namespaced by page: 'dashboard.title', 'servers.card.host'. */
export type Dict = Record<string, string>;

/** One dictionary per language. Every page file and common.ts export one of these. */
export interface PageDict {
  he: Dict;
  en: Dict;
}
