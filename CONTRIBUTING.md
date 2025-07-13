# Contributing to MetaMCP

We welcome contributions to MetaMCP! This guide will help you get started.

## Development Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/metatool-ai/metamcp.git
   cd metamcp
   ```

2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment:
   ```bash
   cp example.env .env
   ```

4. Start development:
   ```bash
   pnpm dev
   ```

## OpenID Connect (OIDC) Provider Setup

MetaMCP supports OpenID Connect authentication for enterprise SSO integration. This is optional and can be configured alongside the default email/password authentication.

### Configuration

To enable OIDC authentication, add the following environment variables to your `.env` file:

#### Required Variables
```bash
OIDC_CLIENT_ID=your-oidc-client-id
OIDC_CLIENT_SECRET=your-oidc-client-secret
OIDC_DISCOVERY_URL=https://your-provider.com/.well-known/openid-configuration
```

For now full endpoints discovery is not supported, so you'll need to provide the authorization endpoint:
```bash
OIDC_AUTHORIZATION_URL=https://your-provider.com/auth/authorize
```

#### Optional Configuration
```bash
OIDC_PROVIDER_ID=oidc                    # Default: "oidc"
OIDC_SCOPES=openid email profile         # Default: "openid email profile"
OIDC_PKCE=true                          # Default: true (recommended for security)
```

### Usage

Once configured, users will see a "Login with OIDC" button on the login page. The authentication flow follows the OpenID Connect Authorization Code flow with PKCE for enhanced security.

### Security Considerations

- PKCE (Proof Key for Code Exchange) is enabled by default for enhanced security
- The redirect URI is automatically configured as `/api/auth/oauth2/callback/oidc`
- Ensure your OIDC provider is configured to allow this redirect URI

### Troubleshooting

**Common Issues:**

1. **Invalid Redirect URI**: Ensure your OIDC provider allows `/api/auth/oauth2/callback/oidc`
2. **Scope Issues**: Some providers require specific scopes beyond the default `openid email profile`
3. **User Creation**: Users are automatically created on first login. Ensure your provider returns email and name claims

**Debug Mode:**

Enable debug logging by setting the auth logger level in `apps/backend/src/auth.ts` to see detailed OIDC flow information.

## How to Contribute

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature-name`
3. Make your changes
4. Test your changes
5. Commit your changes: `git commit -m "Description of changes"`
6. Push to your fork: `git push origin feature/your-feature-name`
7. Open a Pull Request

## Pull Request Guidelines

- Provide a clear description of the changes
- Explain how to test (human test is fine)

## Issues

- Use GitHub Issues to report bugs or request features
- Search existing issues before creating new ones
- Provide detailed information and reproduction steps for bugs

## License

By contributing to MetaMCP, you agree that your contributions will be licensed under the MIT License. 