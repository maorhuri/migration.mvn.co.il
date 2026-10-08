package common

import "regexp"

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
