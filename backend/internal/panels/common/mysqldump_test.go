package common

import "testing"

func TestBrokenDumpTable(t *testing.T) {
	cases := map[string]string{
		"mysqldump: Couldn't execute 'show create table `wpl0_wc_category_lookup`': Got error 194 \"Tablespace is missing for a table\" from storage engine InnoDB (1030)": "wpl0_wc_category_lookup",
		"mysqldump: Couldn't execute 'SELECT /*!40001 SQL_NO_CACHE */ * FROM `wp_options`': Table 'db.wp_options' doesn't exist (1146)":                                    "wp_options",
		"mysqldump: Got error: 1045: Access denied for user 'x'@'localhost' (using password: YES) when trying to connect":                                                  "",
		"": "",
		"Deprecated program name. It will be removed in a future release, use '/usr/bin/mariadb-dump' instead\nmysqldump: Couldn't execute 'show create table `a_b`': x": "a_b",
		// Corrupt index (Error 1034) / crashed table (Error 145): the table name comes from the
		// "when dumping table `x`" suffix mysqldump appends on a per-table failure.
		"mysqldump: Error 1034: Index for table 'wp_postmeta_corrupt_20260922' is corrupt; try to repair it when dumping table `wp_postmeta_corrupt_20260922` at row: 1596": "wp_postmeta_corrupt_20260922",
		"mysqldump: Error 145: Table './db/wp_x' is marked as crashed and should be repaired when dumping table `wp_x` at row: 42":                                            "wp_x",
	}
	for in, want := range cases {
		if got := BrokenDumpTable(in); got != want {
			t.Errorf("BrokenDumpTable(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestIsEssentialTable(t *testing.T) {
	for table, want := range map[string]bool{
		"wpl0_wc_category_lookup":       false,
		"wp_wc_product_meta_lookup":     false,
		"wp_actionscheduler_logs":       false,
		"wp_posts":                      true,
		"wwv_options":                   true,
		"wp_2_postmeta":                 true,
		"wpl0_wc_orders":                true,
		"wp_woocommerce_order_itemmeta": true,
		"wp_woocommerce_sessions":       false,
		"wp_wc_order_stats":             false,
		"posts":                         true,
		"wp_litespeed_url":              false,
	} {
		if got := IsEssentialTable(table); got != want {
			t.Errorf("IsEssentialTable(%q) = %v, want %v", table, got, want)
		}
	}
}
