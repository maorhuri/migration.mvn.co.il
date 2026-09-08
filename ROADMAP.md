# Migration Tool - Roadmap

## Supported Migration Paths

### Phase 1: Core Infrastructure (Completed)
- [x] Backend architecture (Go + Gin)
- [x] Frontend (React + TypeScript + Tailwind)
- [x] PostgreSQL database with encryption
- [x] SSH/SFTP client
- [x] Docker deployment
- [x] Server management (add, delete, test connection)
- [x] Server detail view with accounts list

### Phase 2: Server Management Improvements (In Progress)
- [ ] Edit server details
- [ ] Real SSH connection test
- [ ] View server accounts with full details (PHP, DBs, emails, domains)

### Phase 3: Panel Modules - Export

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

## Notes

### Existing Solutions (Not in scope)
- DirectAdmin ↔ cPanel: Existing solutions available on servers
- DirectAdmin → Enhance: Already implemented in Phase 1

### Requirements
- Root access required on both source and destination servers
- SSH/SFTP access for file transfers
- Database credentials for DB migrations
- API access for Enhance operations
