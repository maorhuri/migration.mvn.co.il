package cloudways

import (
	"reflect"
	"strings"
	"testing"
)

// Output shape of discoverScript as seen on a real Cloudways server (Debian 12, 4 WooCommerce apps).
const sampleDiscovery = `@@APP fstzfvxqrz
@@NGINX
server_name woocommerce-1642668-6550094.cloudwaysapps.com;
@@APACHE
ServerName woocommerce-1642668-6550094.cloudwaysapps.com
ServerAlias www.woocommerce-1642668-6550094.cloudwaysapps.com
@@WPCONFIG
define('DB_NAME', 'fstzfvxqrz');
define('DB_USER', 'fstzfvxqrz');
define('DB_PASSWORD', 'p4$s w!');
define('DB_HOST', 'localhost:/run/mysqld/mysqld.sock');
$table_prefix = 'wwv_';
@@ENV
@@PHP
/etc/php/8.2/fpm/pool.d/fstzfvxqrz.conf
@@DU
24576
@@APP vnuzywdfxb
@@NGINX
server_name woocommerce-1642668-6522422.cloudwaysapps.com www.million-kisot.co.il million-kisot.co.il;
server_name www.million-kisot.co.il; #UI_Domain_alias
@@APACHE
ServerName woocommerce-1642668-6522422.cloudwaysapps.com
ServerAlias www.woocommerce-1642668-6522422.cloudwaysapps.com www.million-kisot.co.il million-kisot.co.il
ServerAlias www.million-kisot.co.il #UI_Domain_alias
@@WPCONFIG
define( 'DB_NAME', 'vnuzywdfxb' );
define( 'DB_USER', 'vnuzywdfxb' );
define( 'DB_PASSWORD', 'secret' );
define( 'DB_HOST', 'localhost' );
$table_prefix = 'wp_';
@@ENV
@@PHP
/etc/php/8.1/fpm/pool.d/vnuzywdfxb.conf
@@DU
512
@@APP laravelapp
@@NGINX
server_name app-1642668-1.cloudwaysapps.com shop.example.com www.shop.example.com other.example.org;
@@APACHE
@@WPCONFIG
@@ENV
DB_DATABASE=laravelapp
DB_USERNAME=laravelapp
DB_PASSWORD="q=x"
DB_HOST=127.0.0.1
DB_PORT=3307
@@PHP
@@DU
@@END
`

func TestParseDiscoveryAndChooseDomains(t *testing.T) {
	apps, err := parseDiscovery(sampleDiscovery)
	if err != nil {
		t.Fatal(err)
	}
	if len(apps) != 3 {
		t.Fatalf("want 3 apps, got %d", len(apps))
	}
	bySlug := map[string]*App{}
	for _, a := range apps {
		chooseDomains(a)
		bySlug[a.Slug] = a
	}

	a := bySlug["fstzfvxqrz"]
	if !a.IsWordPress || a.DB.Name != "fstzfvxqrz" || a.DB.Host != "localhost:/run/mysqld/mysqld.sock" || a.DB.Prefix != "wwv_" {
		t.Errorf("fstzfvxqrz creds parsed wrong: %+v", a.DB)
	}
	if a.PHPVersion != "8.2" || a.DiskMB != 24576 {
		t.Errorf("fstzfvxqrz php/disk wrong: %q %d", a.PHPVersion, a.DiskMB)
	}
	if a.Primary != "woocommerce-1642668-6550094.cloudwaysapps.com" || len(a.Aliases) != 0 {
		t.Errorf("app without a custom domain must fall back to its cloudwaysapps host: %q %v", a.Primary, a.Aliases)
	}
	if got := a.DB.mysqlAuth(); !strings.Contains(got, "-S '/run/mysqld/mysqld.sock'") || !strings.Contains(got, `-p'p4$s w!'`) {
		t.Errorf("socket auth wrong: %s", got)
	}

	b := bySlug["vnuzywdfxb"]
	if b.Primary != "million-kisot.co.il" || len(b.Aliases) != 0 {
		t.Errorf("custom domain must win, www./cloudwaysapps never become aliases: %q %v", b.Primary, b.Aliases)
	}
	if b.CloudwaysHost != "woocommerce-1642668-6522422.cloudwaysapps.com" || b.PHPVersion != "8.1" {
		t.Errorf("cloudways host/php wrong: %q %q", b.CloudwaysHost, b.PHPVersion)
	}
	// WordPress home URL (read from the DB) overrides the vhost order and strips www.
	b.SiteURL = "https://www.Million-Kisot.co.il/"
	chooseDomains(b)
	if b.Primary != "million-kisot.co.il" {
		t.Errorf("home URL host should be primary: %q", b.Primary)
	}

	c := bySlug["laravelapp"]
	if c.IsWordPress {
		t.Error("laravel app flagged as WordPress")
	}
	if c.DB.Name != "laravelapp" || c.DB.Pass != "q=x" || c.DB.Host != "127.0.0.1:3307" {
		t.Errorf(".env creds wrong: %+v", c.DB)
	}
	if c.Primary != "shop.example.com" || !reflect.DeepEqual(c.Aliases, []string{"other.example.org"}) {
		t.Errorf("laravel domains wrong: %q %v", c.Primary, c.Aliases)
	}
	if got := c.DB.mysqlAuth(); !strings.Contains(got, "-h '127.0.0.1' -P '3307'") {
		t.Errorf("host:port auth wrong: %s", got)
	}
	if c.PHPVersion != "" || c.DiskMB != 0 {
		t.Errorf("missing php/du must stay empty: %q %d", c.PHPVersion, c.DiskMB)
	}

	acc := b.account()
	if acc.Username != "vnuzywdfxb" || acc.Domain != "million-kisot.co.il" || acc.DiskUsage != "512 MB" || acc.SiteType != "wordpress" || acc.DBCount != 1 {
		t.Errorf("account mapping wrong: %+v", acc)
	}
	if humanMB(24576) != "24.0 GB" {
		t.Errorf("humanMB: %s", humanMB(24576))
	}
}

func TestParseDiscoveryNoApps(t *testing.T) {
	if _, err := parseDiscovery("@@NOAPPS\n"); err == nil {
		t.Error("expected an error when ~/applications is missing")
	}
	apps, err := parseDiscovery("@@END\n")
	if err != nil || len(apps) != 0 {
		t.Errorf("empty server: %v %v", apps, err)
	}
}
