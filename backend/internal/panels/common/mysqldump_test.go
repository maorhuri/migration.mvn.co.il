package common

import "testing"

func TestBrokenDumpTable(t *testing.T) {
	cases := map[string]string{
		"mysqldump: Couldn't execute 'show create table `wpl0_wc_category_lookup`': Got error 194 \"Tablespace is missing for a table\" from storage engine InnoDB (1030)": "wpl0_wc_category_lookup",
		"mysqldump: Couldn't execute 'SELECT /*!40001 SQL_NO_CACHE */ * FROM `wp_options`': Table 'db.wp_options' doesn't exist (1146)":                                    "wp_options",
		"mysqldump: Got error: 1045: Access denied for user 'x'@'localhost' (using password: YES) when trying to connect":                                                  "",
		"": "",
		"Deprecated program name. It will be removed in a future release, use '/usr/bin/mariadb-dump' instead\nmysqldump: Couldn't execute 'show create table `a_b`': x": "a_b",
	}
	for in, want := range cases {
		if got := BrokenDumpTable(in); got != want {
			t.Errorf("BrokenDumpTable(%q) = %q, want %q", in, got, want)
		}
	}
}
