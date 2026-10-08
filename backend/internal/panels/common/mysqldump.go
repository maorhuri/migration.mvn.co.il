package common

import (
	"regexp"
	"strings"
)

// mysqldump aborts the whole dump on the first table it cannot read -- typically a table whose
// InnoDB tablespace is missing or corrupt on the source ("Couldn't execute 'show create table
// `x`': Got error 194 "Tablespace is missing for a table""), or one that vanished mid-dump. Its
// error names the statement it was running, which names the table.
var brokenDumpTableRe = regexp.MustCompile("(?i)Couldn't execute '[^']*?`([^`]+)`")

// BrokenDumpTable returns the table mysqldump could not read, from its error output, or "".
func BrokenDumpTable(out string) string {
	if m := brokenDumpTableRe.FindStringSubmatch(out); m != nil {
		return m[1]
	}
	return ""
}

// MaxBrokenDumpTables bounds how many unreadable tables a dump skips before giving up: past
// that the database itself is the problem, not a stray table.
const MaxBrokenDumpTables = 10

// essentialTableSuffixes are the WordPress core tables and the WooCommerce order tables: a
// site without one of these is genuinely broken, so losing it is never something to paper over
// with a warning. Everything else (lookup, cache, analytics, session and plugin tables) is
// regenerable or dispensable. Matched as "<prefix>_<name>" because the prefix is unknown.
var essentialTableSuffixes = []string{
	"posts", "postmeta", "options", "users", "usermeta",
	"terms", "term_taxonomy", "term_relationships", "termmeta",
	"comments", "commentmeta",
	"woocommerce_order_items", "woocommerce_order_itemmeta",
	"wc_orders", "wc_orders_meta", "wc_order_addresses", "wc_order_operational_data",
}

// IsEssentialTable reports whether a WordPress/WooCommerce site cannot work without table.
func IsEssentialTable(table string) bool {
	t := strings.ToLower(table)
	for _, s := range essentialTableSuffixes {
		if t == s || strings.HasSuffix(t, "_"+s) {
			return true
		}
	}
	return false
}
