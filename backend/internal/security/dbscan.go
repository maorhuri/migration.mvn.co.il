package security

import (
	"bufio"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

var (
	insertRe     = regexp.MustCompile("^INSERT INTO `([^`]+)`")
	usersRowRe   = regexp.MustCompile(`\((\d+),'((?:[^'\\]|\\.)*)','(?:[^'\\]|\\.)*','(?:[^'\\]|\\.)*','((?:[^'\\]|\\.)*)'`)
	adminMetaRe  = regexp.MustCompile(`\(\d+,(\d+),'[A-Za-z0-9_]*capabilities','a:\d+:\{s:13:\\"administrator\\"`)
	optionRowRe  = regexp.MustCompile(`\((\d+),'((?:[^'\\]|\\.)*)','((?:[^'\\]|\\.)*)','(?:yes|no|on|off|auto|auto-on|auto-off)'\)`)
	optionEvilRe = regexp.MustCompile(`(?i)eval\s*\(|base64_decode\s*\(|gzinflate\s*\(|document\.write\s*\(|window\.location\s*=|<iframe|fromCharCode`)
	optionSoftRe = regexp.MustCompile(`(?i)<script`)
	skipOptions  = map[string]bool{"cron": true, "rewrite_rules": true, "active_plugins": true, "recently_activated": true}
)

// scanDump inspects a mysqldump (.sql or .sql.gz): administrator accounts, injected option values
// and SEO spam in posts/comments.
func (s *scanner) scanDump(ctx context.Context, path, domain string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	var r io.Reader = f
	if strings.HasSuffix(path, ".gz") {
		gz, err := gzip.NewReader(f)
		if err != nil {
			return err
		}
		defer gz.Close()
		r = gz
	}
	br := bufio.NewReaderSize(r, 4<<20)

	users := map[int]AdminUser{}
	adminIDs := map[int]bool{}
	spamPosts, spamComments := 0, 0
	optionFindings := 0
	dbLabel := strings.TrimSuffix(strings.TrimSuffix(filepathBase(path), ".gz"), ".sql")

	for {
		if err := ctx.Err(); err != nil {
			return err
		}
		line, err := br.ReadString('\n')
		if line != "" {
			m := insertRe.FindStringSubmatch(line)
			if m != nil {
				table := m[1]
				switch {
				case strings.HasSuffix(table, "users"):
					for _, row := range usersRowRe.FindAllStringSubmatch(line, -1) {
						id, _ := strconv.Atoi(row[1])
						users[id] = AdminUser{ID: id, Login: unescapeSQL(row[2]), Email: unescapeSQL(row[3])}
					}
				case strings.HasSuffix(table, "usermeta"):
					for _, row := range adminMetaRe.FindAllStringSubmatch(line, -1) {
						id, _ := strconv.Atoi(row[1])
						adminIDs[id] = true
					}
				case strings.HasSuffix(table, "options"):
					for _, row := range optionRowRe.FindAllStringSubmatch(line, -1) {
						name, value := unescapeSQL(row[2]), row[3]
						if skipOptions[name] || strings.HasPrefix(name, "_transient") || strings.HasPrefix(name, "_site_transient") {
							continue
						}
						if loc := optionEvilRe.FindStringIndex(value); loc != nil {
							optionFindings++
							s.add(Finding{Severity: SevHigh, Category: "db_option", Domain: domain, Path: "db:" + table + ":" + name, Action: ActionReport,
								Evidence: snippet(unescapeSQL(value), loc[0]), Note: "option value contains executable/obfuscated code; inspect in the database after import"})
						} else if optionSoftRe.MatchString(value) && !strings.Contains(name, "header") && !strings.Contains(name, "footer") && !strings.Contains(name, "script") && !strings.Contains(name, "analytics") && !strings.Contains(name, "tracking") {
							loc := optionSoftRe.FindStringIndex(value)
							s.add(Finding{Severity: SevMedium, Category: "db_option_script", Domain: domain, Path: "db:" + table + ":" + name, Action: ActionReport,
								Evidence: snippet(unescapeSQL(value), loc[0]), Note: "script tag stored in an option; many plugins do this legitimately"})
						}
					}
				case strings.HasSuffix(table, "posts"):
					spamPosts += len(spamKeywords.FindAllStringIndex(line, -1))
				case strings.HasSuffix(table, "comments"):
					spamComments += len(spamKeywords.FindAllStringIndex(line, -1))
				}
			}
		}
		if err != nil {
			if err == io.EOF {
				break
			}
			return err
		}
	}

	// Administrators
	var admins []AdminUser
	for id := range adminIDs {
		u, ok := users[id]
		if !ok {
			u = AdminUser{ID: id, Login: fmt.Sprintf("user #%d", id)}
		}
		admins = append(admins, u)
	}
	sort.Slice(admins, func(i, j int) bool { return admins[i].ID < admins[j].ID })
	s.report.AdminUsers = append(s.report.AdminUsers, admins...)
	if len(admins) > 0 {
		names := make([]string, 0, len(admins))
		for _, a := range admins {
			names = append(names, fmt.Sprintf("%s <%s>", a.Login, a.Email))
		}
		sev := SevInfo
		note := "verify every administrator is known; remove the rest after import"
		if len(admins) > 5 {
			sev = SevMedium
			note = "unusually many administrators; " + note
		}
		s.add(Finding{Severity: sev, Category: "db_admins", Domain: domain, Path: "db:" + dbLabel + ":administrators", Action: ActionReport,
			Evidence: fmt.Sprintf("%d administrator(s): %s", len(admins), strings.Join(names, ", ")), Note: note})
	}
	if spamPosts > 0 {
		s.add(Finding{Severity: SevMedium, Category: "db_spam", Domain: domain, Path: "db:" + dbLabel + ":posts", Action: ActionReport,
			Evidence: fmt.Sprintf("%d spam keyword hit(s) in posts (viagra, casino, cialis, replica rolex, poker, betting, payday loan)", spamPosts), Note: "SEO spam or legitimate content in that niche; check the posts after import"})
	}
	if spamComments > 0 {
		s.add(Finding{Severity: SevMedium, Category: "db_spam", Domain: domain, Path: "db:" + dbLabel + ":comments", Action: ActionReport,
			Evidence: fmt.Sprintf("%d spam keyword hit(s) in comments", spamComments), Note: "delete spam comments from the WordPress admin after import"})
	}
	return nil
}

func unescapeSQL(s string) string {
	r := strings.NewReplacer(`\'`, `'`, `\"`, `"`, `\\`, `\`, `\n`, " ", `\r`, " ", `\0`, "")
	return r.Replace(s)
}

func filepathBase(p string) string {
	if i := strings.LastIndexAny(p, `/\`); i >= 0 {
		return p[i+1:]
	}
	return p
}
