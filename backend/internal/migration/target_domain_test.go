package migration

import (
	"reflect"
	"testing"

	"github.com/migration-tool/backend/internal/panels/common"
)

func TestNormalizeDomain(t *testing.T) {
	for in, want := range map[string]string{
		"":                             "",
		"  Example.COM ":               "example.com",
		"https://www.example.com/path": "example.com",
		"http://shop.example.co.il/":   "shop.example.co.il",
		"www.example.com.":             "example.com",
	} {
		if got := normalizeDomain(in); got != want {
			t.Errorf("normalizeDomain(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestApplyTargetDomain(t *testing.T) {
	noLog := func(string, string) {}

	// Cloudways app that only had its platform hostname: registered under the chosen domain,
	// the platform hostname becomes an alias (only informational on the target).
	data := &common.ExportData{
		Account: common.Account{Domain: "woocommerce-1-2.cloudwaysapps.com"},
		Domains: []common.Domain{{Name: "woocommerce-1-2.cloudwaysapps.com", Type: "main"}},
	}
	applyTargetDomain(data, "https://www.Shop.co.il/", noLog)
	d := data.Domains[0]
	if d.Name != "woocommerce-1-2.cloudwaysapps.com" || d.TargetDomain != "shop.co.il" || len(d.Aliases) != 0 {
		t.Errorf("cloudways override wrong: %+v", d)
	}

	// DirectAdmin account whose pointer would have been used: the operator's domain wins, the
	// pointer joins the aliases next to the internal hostname.
	data = &common.ExportData{
		Account: common.Account{Domain: "cust.s2.mrvsn.com"},
		Domains: []common.Domain{
			{Name: "cust.s2.mrvsn.com", Type: "main", TargetDomain: "pointer.co.il", Aliases: []string{"cust.s2.mrvsn.com"}},
			{Name: "addon.co.il", Type: "addon"},
		},
	}
	applyTargetDomain(data, "chosen.co.il", noLog)
	d = data.Domains[0]
	if d.TargetDomain != "chosen.co.il" || !reflect.DeepEqual(d.Aliases, []string{"pointer.co.il"}) {
		t.Errorf("pointer demotion wrong: %+v", d)
	}
	if data.Domains[1].TargetDomain != "" {
		t.Errorf("addon domain must be left alone: %+v", data.Domains[1])
	}

	// Choosing the source's own name clears any pointer override.
	data = &common.ExportData{
		Account: common.Account{Domain: "cust.s2.mrvsn.com"},
		Domains: []common.Domain{{Name: "cust.s2.mrvsn.com", TargetDomain: "pointer.co.il", Aliases: []string{"cust.s2.mrvsn.com"}}},
	}
	applyTargetDomain(data, "cust.s2.mrvsn.com", noLog)
	if d := data.Domains[0]; d.TargetDomain != "" || !reflect.DeepEqual(d.Aliases, []string{"pointer.co.il"}) {
		t.Errorf("own-name override wrong: %+v", d)
	}

	// Same as the automatic choice: no change at all.
	data = &common.ExportData{
		Account: common.Account{Domain: "cust.s2.mrvsn.com"},
		Domains: []common.Domain{{Name: "cust.s2.mrvsn.com", TargetDomain: "pointer.co.il", Aliases: []string{"cust.s2.mrvsn.com"}}},
	}
	applyTargetDomain(data, "pointer.co.il", noLog)
	if d := data.Domains[0]; d.TargetDomain != "pointer.co.il" || !reflect.DeepEqual(d.Aliases, []string{"cust.s2.mrvsn.com"}) {
		t.Errorf("no-op override changed data: %+v", d)
	}

	// Empty choice: untouched.
	applyTargetDomain(data, "", noLog)
	if d := data.Domains[0]; d.TargetDomain != "pointer.co.il" {
		t.Errorf("empty override changed data: %+v", d)
	}
}
