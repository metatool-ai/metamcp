# 🚀 MetaMCP Deployment Guide

## DigitalOcean One-Click Deployment

MetaMCP now supports one-click deployment to DigitalOcean App Platform! This allows you to get MetaMCP running in minutes without any local setup.

### What You Get

When you click the "Deploy to DigitalOcean" button, you'll get:

- **MetaMCP App**: The main application running on port 12008
- **PostgreSQL Database**: Managed PostgreSQL 16 database
- **Environment Variables**: Pre-configured environment variables
- **Health Checks**: Automatic health monitoring
- **Scaling**: Easy scaling options as your usage grows

### Deployment Process

1. **Click the Deploy Button**: Use the button in the README or Quick Start section
2. **Sign in to DigitalOcean**: Create an account or sign in to existing account
3. **Configure Environment**: Set your environment variables (or use defaults)
4. **Deploy**: DigitalOcean will automatically build and deploy your app
5. **Access**: Get your app URL and start using MetaMCP!

### Environment Variables

The deployment will use these environment variables (you can customize them):

```bash
# Database Configuration
POSTGRES_HOST=your-db-host
POSTGRES_PORT=5432
POSTGRES_USER=metamcp_user
POSTGRES_PASSWORD=your-secure-password
POSTGRES_DB=metamcp_db

# Application Configuration
APP_URL=https://your-app-url.digitalocean.app
BETTER_AUTH_SECRET=your-super-secret-key
TRANSFORM_LOCALHOST_TO_DOCKER_INTERNAL=true
```

### What Happens After Deployment

1. **Database Setup**: PostgreSQL will be automatically initialized
2. **App Startup**: MetaMCP will start and connect to the database
3. **Health Check**: The app will be monitored for availability
4. **Ready to Use**: You'll receive a URL where MetaMCP is accessible

### Accessing Your Deployment

- **Web Interface**: Visit your app URL to access the MetaMCP dashboard
- **MCP Endpoints**: Use the endpoints at `/metamcp/<endpoint>/sse` or `/metamcp/<endpoint>/mcp`
- **API**: REST API available at various endpoints

### Troubleshooting

- **Health Check Failures**: Check that your environment variables are correctly set
- **Database Connection**: Ensure PostgreSQL credentials are correct
- **Port Issues**: The app runs on port 12008 internally, but DigitalOcean handles external routing

### Cost Considerations

- **Basic Plan**: Starts at $5/month for basic instances
- **Database**: Additional cost for managed PostgreSQL
- **Bandwidth**: Included in most plans
- **Scaling**: Pay only for what you use

### Alternative Deployments

If you prefer other deployment methods:

- **Docker Compose**: See the main README for local Docker setup
- **Custom VPS**: Manual deployment instructions available
- **Other Cloud Providers**: MetaMCP can be deployed anywhere Docker runs

---

For more detailed deployment information, see the [main README](./README.md) or [documentation](https://docs.metamcp.com).
