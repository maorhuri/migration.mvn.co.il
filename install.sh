#!/bin/bash

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║           Migration Tool - Installation Script               ║"
echo "║         DirectAdmin / cPanel → Enhance Migration             ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo -e "${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    echo -e "${RED}Please run as root (sudo ./install.sh)${NC}"
    exit 1
fi

# Detect OS
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
    VERSION=$VERSION_ID
else
    echo -e "${RED}Cannot detect OS. This script supports Ubuntu 22.04/24.04${NC}"
    exit 1
fi

echo -e "${GREEN}Detected OS: $OS $VERSION${NC}"

if [ "$OS" != "ubuntu" ]; then
    echo -e "${RED}This script is designed for Ubuntu. Detected: $OS${NC}"
    exit 1
fi

# Update system
echo -e "${BLUE}Updating system packages...${NC}"
apt-get update -y
apt-get upgrade -y

# Install dependencies
echo -e "${BLUE}Installing dependencies...${NC}"
apt-get install -y \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    lsb-release \
    openssh-client \
    rsync \
    unzip

# Install Docker
echo -e "${BLUE}Installing Docker...${NC}"
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sh get-docker.sh
    rm get-docker.sh
    systemctl enable docker
    systemctl start docker
else
    echo -e "${YELLOW}Docker already installed${NC}"
fi

# Install Docker Compose
echo -e "${BLUE}Installing Docker Compose...${NC}"
if ! command -v docker-compose &> /dev/null; then
    apt-get install -y docker-compose-plugin
fi

# Create installation directory
INSTALL_DIR="/opt/migration-tool"
echo -e "${BLUE}Creating installation directory: $INSTALL_DIR${NC}"
mkdir -p $INSTALL_DIR
cd $INSTALL_DIR

# Copy files if running from source directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -d "$SCRIPT_DIR/backend" ] && [ -d "$SCRIPT_DIR/frontend" ]; then
    echo -e "${BLUE}Copying source files...${NC}"
    cp -r "$SCRIPT_DIR/backend" $INSTALL_DIR/
    cp -r "$SCRIPT_DIR/frontend" $INSTALL_DIR/
    cp -r "$SCRIPT_DIR/docker" $INSTALL_DIR/
fi

# Generate secure keys
echo -e "${BLUE}Generating secure keys...${NC}"
DB_PASSWORD=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)
MASTER_KEY=$(openssl rand -base64 32 | tr -dc 'a-zA-Z0-9' | head -c 32)

# Create .env file
cat > $INSTALL_DIR/.env << EOF
# Migration Tool Configuration
# Generated on $(date)

# Database
DB_PASSWORD=$DB_PASSWORD

# Encryption Master Key (DO NOT SHARE!)
MASTER_KEY=$MASTER_KEY

# Server Port
PORT=8080
EOF

chmod 600 $INSTALL_DIR/.env

# Create systemd service
echo -e "${BLUE}Creating systemd service...${NC}"
cat > /etc/systemd/system/migration-tool.service << EOF
[Unit]
Description=Migration Tool
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR/docker
ExecStart=/usr/bin/docker compose --env-file $INSTALL_DIR/.env up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload

# Build and start
echo -e "${BLUE}Building Docker images...${NC}"
cd $INSTALL_DIR/docker
docker compose --env-file $INSTALL_DIR/.env build

echo -e "${BLUE}Starting services...${NC}"
docker compose --env-file $INSTALL_DIR/.env up -d

# Enable service
systemctl enable migration-tool

# Get server IP
SERVER_IP=$(hostname -I | awk '{print $1}')

# Print success message
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║           Installation Complete!                             ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${BLUE}Access the Migration Tool at:${NC}"
echo -e "  ${GREEN}http://$SERVER_IP:8080${NC}"
echo ""
echo -e "${BLUE}Configuration file:${NC}"
echo -e "  ${YELLOW}$INSTALL_DIR/.env${NC}"
echo ""
echo -e "${BLUE}Useful commands:${NC}"
echo -e "  ${YELLOW}systemctl status migration-tool${NC}  - Check status"
echo -e "  ${YELLOW}systemctl restart migration-tool${NC} - Restart service"
echo -e "  ${YELLOW}docker compose logs -f${NC}           - View logs"
echo ""
echo -e "${RED}IMPORTANT: Save your Master Key securely!${NC}"
echo -e "${RED}It's stored in $INSTALL_DIR/.env${NC}"
echo ""
