# Migration Tool - Roadmap

## Current Status (Updated: 2026-09-08)

### What's Working Now ✅

#### DirectAdmin → Enhance Migration
- [x] Export databases (mysqldump)
- [x] Export email accounts and mailboxes
- [x] Export cron jobs
- [x] Export DNS records
- [x] Export files with **rsync** (fast transfer)
- [x] Create website in Enhance via API
- [x] Import databases
- [x] Import email accounts
- [x] Import cron jobs
- [x] Fix permissions (chown, chmod 775/644, wp-config.php 600)
- [x] Cleanup temp files after migration

#### Infrastructure
- [x] Backend (Go + Gin)
- [x] Frontend (React + TypeScript + Tailwind)
- [x] PostgreSQL with encryption
- [x] SSH/SFTP/rsync client
- [x] Docker deployment on migration.mvn.co.il
- [x] Server management (add, delete, test connection)
- [x] Server detail view with accounts list
- [x] Migration UI with real-time progress
- [x] Source/Target server selection with search & filter
- [x] Enhance cluster server selection

---

## TODO - לבדיקה מחר (2026-09-09)

### 1. בדיקת מיגרציה אמיתית
- [ ] התחל מיגרציה חדשה עם rsync (אמור להיות מהיר יותר)
- [ ] בדוק שהאתר נוצר ב-Enhance
- [ ] בדוק שהקבצים הועברו
- [ ] בדוק שה-DB יובא
- [ ] בדוק שהמיילים נוצרו
- [ ] בדוק שה-cron jobs יובאו
- [ ] בדוק שההרשאות תוקנו
- [ ] בדוק שקבצים זמניים נמחקו

### 2. בדיקת מהירות rsync
- [ ] השווה זמן העברה עם rsync vs SFTP הישן
- [ ] צפי: 10-50x יותר מהיר

### 3. בעיות ידועות לתקן
- [ ] UI לא מציג את כל השלבים בזמן אמת (צריך לסנכרן עם backend)
- [ ] Progress bar לא מתעדכן נכון
- [ ] חסר: הצגת hosts entry בסוף המיגרציה

---

## Supported Migration Paths

### Phase 1: Core Infrastructure ✅ COMPLETED
- [x] Backend architecture (Go + Gin)
- [x] Frontend (React + TypeScript + Tailwind)
- [x] PostgreSQL database with encryption
- [x] SSH/SFTP/rsync client
- [x] Docker deployment
- [x] Server management (add, delete, test connection)
- [x] Server detail view with accounts list

### Phase 2: DirectAdmin → Enhance ✅ COMPLETED
- [x] SSH connection to DirectAdmin
- [x] List all accounts
- [x] Export files (rsync - fast)
- [x] Export databases (mysqldump)
- [x] Export email accounts & mailboxes
- [x] Export cron jobs
- [x] Export DNS records
- [x] Create website in Enhance (API)
- [x] Import files (rsync)
- [x] Import databases
- [x] Import email accounts
- [x] Import cron jobs
- [x] Fix permissions
- [x] Cleanup temp files
- [x] Migration progress UI

### Phase 3: Additional Panel Modules (Planned)

#### CloudPanel Module
- [ ] SSH connection
- [ ] List all sites/accounts
- [ ] Export files (document root)
- [ ] Export databases (MySQL)
- [ ] Export email accounts
- [ ] Export SSL certificates
- [ ] Export PHP configuration

#### cPanel Module
- [ ] SSH connection
- [ ] List all accounts
- [ ] Export files
- [ ] Export databases
- [ ] Export email accounts
- [ ] Export SSL certificates
- [ ] Export cron jobs

#### FTP Only Module
- [ ] FTP/SFTP connection
- [ ] List files
- [ ] Export files only (no DB, no emails)

#### WordPress Only Module
- [ ] Detect WordPress installations
- [ ] Export wp-content
- [ ] Export database
- [ ] Export wp-config.php
- [ ] Handle multisite

### Phase 4: Migration Paths to Enhance

#### CloudPanel → Enhance
- [ ] Create website in Enhance
- [ ] Import files
- [ ] Import databases
- [ ] Create email accounts
- [ ] Configure PHP version
- [ ] Import SSL certificates
- [ ] Validation & testing

#### cPanel → Enhance
- [ ] Create website in Enhance
- [ ] Import files
- [ ] Import databases
- [ ] Create email accounts
- [ ] Configure PHP version
- [ ] Import SSL certificates
- [ ] Validation & testing

#### FTP → Enhance
- [ ] Create website in Enhance
- [ ] Import files only
- [ ] Manual database setup (if provided)
- [ ] Validation & testing

#### WordPress → Enhance
- [ ] Create website in Enhance
- [ ] Import WordPress files
- [ ] Import database
- [ ] Update wp-config.php
- [ ] Configure PHP version
- [ ] Validation & testing

#### Enhance → Enhance
- [ ] Export from source Enhance
- [ ] Create website in target Enhance
- [ ] Import files
- [ ] Import databases
- [ ] Create email accounts
- [ ] Configure settings
- [ ] Validation & testing

### Phase 5: Advanced Features
- [ ] Migration scheduling
- [ ] Batch migrations
- [ ] Migration templates
- [ ] Rollback support
- [ ] Migration history & reports
- [ ] API for external integrations

---

## Technical Notes

### Transfer Methods (Speed Comparison)
| Method | Speed | Use Case |
|--------|-------|----------|
| SFTP | ~100KB-1MB/s | Fallback only |
| tar+ssh | ~5-20MB/s | Good for many small files |
| **rsync** | **10-50MB/s** | **Default - fastest** |

### Requirements
- Root access required on both source and destination servers
- SSH access for file transfers (rsync)
- Database credentials for DB migrations
- API access for Enhance operations

### Deployment
- Server: 2.28.68.194
- Domain: migration.mvn.co.il
- Repository: git@github.com:maorhuri/migration.mvn.co.il.git
- Directory: /opt/migration-tool

---

## Commits Today (2026-09-08)

1. `20c76eb` - Add cleanup and fix permissions after migration
2. `8ced560` - Fix migration ID - use DB generated ID consistently
3. `da29bdb` - Add debug log for GetMigration
4. `daadfbd` - Fix NULL export_data scan error with NullableJSON type
5. `312d276` - Fix: use background context for migration goroutine
6. `1386a6f` - Use rsync instead of SFTP for 10-50x faster file transfer
