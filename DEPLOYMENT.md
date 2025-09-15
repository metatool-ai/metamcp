# MetaMCP Production Deployment Guide

This guide covers deploying MetaMCP with individual Docker containers using a path-based architecture.

## 🏗️ Architecture Overview

```
https://otbitmcp.xyz/          → Frontend (Next.js)
https://otbitmcp.xyz/api/*     → Backend (Express/tRPC)
https://otbitmcp.xyz/trpc/*    → Backend tRPC endpoints
https://otbitmcp.xyz/mcp-proxy/* → Backend MCP proxy
```

## 📋 Prerequisites

- Docker & Docker Compose
- Domain name (e.g., `otbitmcp.xyz`)
- SSL certificates (for production)
- PostgreSQL database

## 🚀 Quick Start

### 1. Clone and Setup

```bash
git clone <your-repo>
cd metamcp
```

### 2. Configure Environment

```bash
# Copy production environment template
cp .env.prod .env

# Generate secure secrets
openssl rand -base64 32  # Use for BETTER_AUTH_SECRET
openssl rand -base64 32  # Use for DB_PASSWORD

# Edit .env with your values
nano .env
```

### 3. Build Individual Apps

```bash
# Build both apps
./scripts/build-individual.sh

# Or build individually
./scripts/build-individual.sh backend
./scripts/build-individual.sh frontend
```

### 4. Deploy with Docker

```bash
# Start production deployment
docker-compose -f docker-compose.prod.yml up -d

# Check status
docker-compose -f docker-compose.prod.yml ps

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

## 📁 File Structure

```
metamcp/
├── apps/
│   ├── backend/
│   │   ├── Dockerfile          # Backend production image
│   │   ├── .env               # Backend environment
│   │   └── .env.example       # Backend env template
│   └── frontend/
│       ├── Dockerfile          # Frontend production image
│       ├── .env.local         # Frontend environment
│       └── .env.example       # Frontend env template
├── docker-compose.prod.yml     # Production compose
├── nginx.conf                  # Reverse proxy config
├── .env.prod                   # Production environment
└── scripts/
    ├── build-individual.sh     # Individual build script
    └── deploy-prod.sh          # Deployment script
```

## 🔧 Environment Variables

### Backend (.env)
```bash
NODE_ENV=production
PORT=12009
APP_URL=https://otbitmcp.xyz
DATABASE_URL=postgresql://user:pass@postgres:5432/metamcp_prod
BETTER_AUTH_SECRET=your-secret-here
CORS_ORIGIN=https://otbitmcp.xyz
```

### Frontend (.env.local)
```bash
NODE_ENV=production
NEXT_PUBLIC_APP_URL=https://otbitmcp.xyz
NEXT_PUBLIC_API_URL=https://otbitmcp.xyz/api
NEXT_PUBLIC_TRPC_URL=https://otbitmcp.xyz/trpc
```

## 🌐 Domain Setup

### DNS Configuration
```
A     otbitmcp.xyz    → Your server IP
CNAME www.otbitmcp.xyz → otbitmcp.xyz
```

### SSL Certificates
```bash
# Using Let's Encrypt (recommended)
certbot certonly --standalone -d otbitmcp.xyz -d www.otbitmcp.xyz

# Copy certificates
mkdir -p ssl/
cp /etc/letsencrypt/live/otbitmcp.xyz/fullchain.pem ssl/cert.pem
cp /etc/letsencrypt/live/otbitmcp.xyz/privkey.pem ssl/key.pem
```

## 🔍 Health Checks

```bash
# Backend health
curl https://otbitmcp.xyz/api/health

# Frontend health
curl https://otbitmcp.xyz/

# Database connection
docker-compose -f docker-compose.prod.yml exec backend npm run db:check
```

## 📊 Monitoring

```bash
# View all logs
docker-compose -f docker-compose.prod.yml logs -f

# View specific service logs
docker-compose -f docker-compose.prod.yml logs -f frontend
docker-compose -f docker-compose.prod.yml logs -f backend
docker-compose -f docker-compose.prod.yml logs -f postgres

# Check resource usage
docker stats
```

## 🛠️ Maintenance

### Updates
```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

### Database Backup
```bash
# Backup database
docker-compose -f docker-compose.prod.yml exec postgres pg_dump -U metamcp metamcp_prod > backup.sql

# Restore database
docker-compose -f docker-compose.prod.yml exec -T postgres psql -U metamcp metamcp_prod < backup.sql
```

### Scaling
```bash
# Scale frontend instances
docker-compose -f docker-compose.prod.yml up -d --scale frontend=3

# Scale backend instances
docker-compose -f docker-compose.prod.yml up -d --scale backend=2
```

## 🚨 Troubleshooting

### Common Issues

1. **Port conflicts**
   ```bash
   # Check what's using ports
   lsof -i :3000
   lsof -i :12009
   ```

2. **Database connection issues**
   ```bash
   # Check database logs
   docker-compose -f docker-compose.prod.yml logs postgres
   
   # Test connection
   docker-compose -f docker-compose.prod.yml exec postgres psql -U metamcp -d metamcp_prod -c "SELECT 1;"
   ```

3. **SSL certificate issues**
   ```bash
   # Verify certificates
   openssl x509 -in ssl/cert.pem -text -noout
   
   # Test SSL
   curl -I https://otbitmcp.xyz
   ```

## 🔐 Security Checklist

- [ ] Strong database passwords
- [ ] Secure BETTER_AUTH_SECRET (32+ characters)
- [ ] SSL certificates properly configured
- [ ] Firewall rules configured
- [ ] Regular security updates
- [ ] Database backups automated
- [ ] Log monitoring setup

## 📞 Support

For deployment issues:
1. Check logs: `docker-compose -f docker-compose.prod.yml logs`
2. Verify environment variables
3. Test individual services
4. Check network connectivity
