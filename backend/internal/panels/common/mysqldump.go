package common

import (
	"regexp"
	"strings"
)

// mysqldump aborts the whole dump on the first table it cannot read. The cause varies:
//   - a missing/corrupt InnoDB tablespace ("Couldn't execute 'show create table `x`': Got error
//     194 ...Tablespace is missing..."), or a table that vanished mid-dump -- the error names the
//     statement it was running, which names the table;
//   - a corrupt index or a crashed MyISAM table ("Error 1034: Index for table 'x' is corrupt..."
//     / "Error 145: Table 'x' is marked as crashed...") -- mysqldump then appends "when dumping
//     table `x` at row: N", which names the table for ANY such per-table failure.
// These two regexes, tried in order, pull the table name out of either form.
var brokenDumpTableRes = []*regexp.Regexp{
	regexp.MustCompile("(?i)Couldn't execute '[^']*?`([^`]+)`"),
	regexp.MustCompile("(?i)when dumping table `([^`]+)`"),
}

// BrokenDumpTable returns the table mysqldump could not read, from its error output, or "".
func BrokenDumpTable(out string) string {
	for _, re := range brokenDumpTableRes {
		if m := re.FindStringSubmatch(out); m != nil {
			return m[1]
		}
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
