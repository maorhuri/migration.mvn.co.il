# Workflow מקצועי לניקוי פריצות ומניעת Malware באתרי WordPress

מסמך המקור של MVN (Maor), נשמר כאן כבסיס לשלב "Malware scan" של כלי המיגרציה
(`backend/internal/security`). החתימות, שמות הקבצים החשודים, תבניות התיקיות ובדיקות
מסד הנתונים בסורק נגזרות מהסעיפים 6 עד 10 ו-14 במסמך זה.

## 1. תיאור כללי

מסמך זה מסכם את תהליך הזיהוי, הסריקה, הניקוי, החיזוק והאימות של אתר WordPress שנפרץ, חשוד בפריצה, או מכיל סימני malware, spam, backdoor או קוד זדוני.

- שלבי בדיקה ברורים
- פקודות מעשיות
- נקודות החלטה
- רשימת רמזים לזיהוי
- checklist לסיום ולמסירה

> הערה חשובה: מסמך זה מתאר workflow לניקוי והקשחה, לא תעודת forensic clearance מלאה. לאחר ניקוי, יש לבצע אימות סופי מול השרת, מסד הנתונים, התוספים, המשתמשים, cron jobs, קבצי קונפיג וה-logs, ולדווח על הסטטוס בצורה מדויקת.

## 3. עקרונות מנחים

1. לא מבצעים מחיקה מיידית בלי גיבוי.
2. בודקים את מקור הפריצה ולא רק את הסימפטומים.
3. שומרים על evidence: גיבוי, SQL dump, קבצים, logs, screenshots, תיקי תיעוד.
4. לא מסתפקים ב"אין סימנים", חייבים אימות חוזר.
5. מחפשים לא רק קובץ בודד, אלא גם: משתמשים, db options, cron jobs, hidden hooks, redirects, .htaccess / .user.ini, malicious plugins/themes.
6. לאחר ניקוי, מבצעים hardening ולא רק cleanup.

## 6. סריקת מערכת קבצים

### 6.1 חיפוש קוד זדוני נפוץ

```bash
grep -rlE 'eval\s*\(\s*base64_decode|eval\s*\(\s*\$_(POST|GET|REQUEST)|gzinflate\s*\(\s*base64|assert\s*\(\s*\$_|shell_exec\s*\(|passthru\s*\(|system\s*\(\s*\$|exec\s*\(\s*\$|preg_replace\s*\([^)]*/e|create_function\s*\(' "$WP_PATH" --include='*.php'
grep -rl 'geTALLhEaDerS\|clickhitriver\|hitriver\|verify you are human\|I am not a robot' "$WP_PATH" --include='*.php' --include='*.js'
grep -rl 'navigator\.clipboard.*execCommand\|Win.*R.*Ctrl.*V\|fromCharCode.*atob\|String\.fromCharCode.*join' "$WP_PATH" --include='*.php' --include='*.js'
```

### 6.2 קבצים חשודים

shell.php, c99.php, r57.php, wso.php, wp-tmp.php, wp-feed.php, wp-vcd.php, class.theme-modules.php, `*.php.bak`, `*.php.suspected`, `*.phtml`, קבצי PHP בתוך uploads, `user.php` בתבניות, PHP בתוך תיקיות css/js.

### 6.3 תיקיות חשודות עם timestamps

`security_*`, `seo_*`, `backup_*`, `analytics_*`, `social_*` (עם `_` או `-`), ותיקיות בתבנית `[a-z]+[-_][0-9]{10,}`.

### 6.4 דגלים אדומים

- קובץ PHP בתוך uploads
- קובץ בשם user.php בתבניות
- `eval`, `base64_decode`, `gzinflate`, `assert`, `shell_exec`
- `goto` obfuscation
- Fake Cloudflare / "Verify you are human"
- JS שמבצע redirect או `atob`/`decodeURIComponent`
- תיקיות דינמיות עם timestamps

## 7. תוספים, ערכות עיצוב, core

- תוספים בלי readme.txt, תוסף מקובץ PHP בודד, שמות אקראיים, קוד obfuscated
- קוד שמסתיר תוספים: `hide_my_plugin_from_list`, `unset(... plugins ...)`, פילטר `all_plugins`
- themes: הזרקת JS מרוחק, `curl` / `wget` / `fopen` / `file_get_contents` לדומיינים חיצוניים, תוספות בסוף functions.php

## 8. מסד נתונים

- רשימת admin users (`wp_capabilities` עם administrator): משתמשים לא מוכרים, אימיילים מזויפים, מספר admin חריג
- `wp_options` עם `eval(`, `base64_decode`, `document.write`, `window.location`, `<script`, `curl`, `wget`
- spam ב-posts/comments: `viagra|casino|cialis|replica|rolex|poker|betting`
- metadata חבוי: מפתחות דמויי `ga_hidden_*`, task / cron / redirect

## 9. קבצים רגישים

`.htaccess`, `.user.ini`, `php.ini`, `wp-config.php`, `xmlrpc.php`: חיפוש `auto_prepend_file`, `auto_append_file`, `php_value`, `RewriteRule` לדומיין חיצוני, iframe, javascript.

## 10. cron jobs, hooks

crontab עם `curl`, `wget`, `bash ... http`, `php ... http`, `base64`, `eval`; hooks חשודים: `add_action`, `add_filter`, `wp_schedule_event` בקוד לא מוכר.

## 11. ניקוי

מחיקה של קבצים חשודים רק אחרי גיבוי ואחרי וידוא שהקובץ אינו לגיטימי; הסרת תוספים ותבניות לא מוכרים; ניקוי משתמשים, usermeta, comments ו-posts זדוניים; איפוס סיסמאות לכל admin.

## 12. Hardening

חסימת PHP ב-uploads, חסימת wp-config.php / .htaccess / .git / .env, חסימת xmlrpc.php, הגנת login (GeoIP, brute force, 2FA), עדכון WordPress ותוספים, הרשאות קבצים, fail2ban.

## 13. אימות סופי

חזרה על כל הבדיקות; אין קבצים חשודים, אין hidden admin users, אין redirect, אין spam, אין cron לא מאושר, אין JS זדוני, אין hidden hooks.

## 14. דגלים אדומים לטיפול מיידי

- קבצי PHP בתוך uploads
- user.php, shell.php, wp-tmp.php, class.theme-modules.php
- תיקיות עם timestamps כגון `security_1764187733` או `backup_1770123394`
- obfuscation דרך goto / hex strings
- Fake Cloudflare / Verify you are human / Clipboard Hijack / clickhitriver
- admins לא ידועים
- JS עם redirect או atob / decodeURIComponent
- שיבושים ב-.htaccess או .user.ini
- cron עם wget, curl, bash, php לדומיין מרוחק
- spam content ב-posts, pages, comments

## 15-18. תיעוד ומסירה

תיעוד incident (מתי, מה, השפעה, מנגנון משוער), תיעוד ניקוי (מה נבדק, נוקה, הוסר, מה נדרש עוד), תיעוד אימות סופי (סטטוס: cleaned / partially cleaned / needs further review), ו-checklist לפני, בזמן ואחרי הניקוי. הערת זהירות למסירה: "cleanup completed, full forensic clearance requires independent validation".
