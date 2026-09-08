# Migration Tool

כלי מיגרציה מקצועי להעברת אתרים בין פאנלים שונים.

## תכונות

- **ייצוא מ-DirectAdmin**: קבצים, בסיסי נתונים, אימיילים, SSL, DNS
- **ייבוא ל-Enhance**: יצירת חשבונות, העלאת קבצים, הגדרת דומיינים
- **ממשק Web מודרני**: React + Tailwind CSS
- **CLI מלא**: לפעולות מהירות ואוטומציה
- **אבטחה**: הצפנת מפתחות ופרטי התחברות ב-AES-256

## דרישות

- Ubuntu 22.04 / 24.04
- Docker & Docker Compose
- גישת ROOT לשרתי המקור והיעד

## התקנה מהירה

```bash
# Clone the repository
git clone git@github.com:maorhuri/migration.mvn.co.il.git
cd migration.mvn.co.il

# Run installation script
sudo ./install.sh
```

## התקנה ידנית

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone and build
git clone git@github.com:maorhuri/migration.mvn.co.il.git
cd migration.mvn.co.il/docker

# Create .env file
cat > ../.env << EOF
DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
MASTER_KEY=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
EOF

# Build and run
docker compose --env-file ../.env up -d
```

## שימוש

### Web UI
גש ל: `http://your-server:8080`

### CLI
```bash
# List servers
migration-cli server list

# Add DirectAdmin server
migration-cli server add

# Add Enhance server
migration-cli server add

# Start migration
migration-cli migrate start

# Check status
migration-cli migrate status <migration-id>
```

## ארכיטקטורה

```
migration/
├── backend/                 # Go Backend
│   ├── cmd/
│   │   ├── server/         # Web API Server
│   │   └── cli/            # CLI Tool
│   ├── internal/
│   │   ├── panels/         # Panel modules
│   │   │   ├── directadmin/
│   │   │   ├── enhance/
│   │   │   └── cpanel/
│   │   ├── migration/      # Migration engine
│   │   ├── storage/        # Database & encryption
│   │   └── ssh/            # SSH/SFTP connections
│   └── pkg/                # Shared utilities
├── frontend/               # React Web UI
├── docker/                 # Docker configs
└── docs/                   # Documentation
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/servers` | List all servers |
| POST | `/api/v1/servers` | Add new server |
| POST | `/api/v1/servers/:id/test` | Test connection |
| GET | `/api/v1/migrations` | List migrations |
| POST | `/api/v1/migrations` | Start migration |
| GET | `/api/v1/migrations/:id` | Get migration status |

## תהליך המיגרציה

1. **חיבור לשרת המקור** (DirectAdmin)
   - SSH/SFTP connection
   - קריאת רשימת משתמשים

2. **ייצוא נתונים**
   - קבצי האתר (`/home/user/domains/`)
   - בסיסי נתונים (mysqldump)
   - חשבונות אימייל
   - תעודות SSL
   - רשומות DNS
   - Cron jobs

3. **ייבוא לשרת היעד** (Enhance)
   - יצירת Organization
   - יצירת Website
   - העלאת קבצים (SFTP/rsync)
   - ייבוא בסיסי נתונים
   - הגדרת אימיילים
   - התקנת SSL

## אבטחה

- כל הסיסמאות ומפתחות ה-SSH מוצפנים ב-AES-256-GCM
- PBKDF2 עם 100,000 iterations
- Master Key נשמר בקובץ `.env` מוגן

## License

MIT
