/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  async rewrites() {
    // Use localhost for rewrites since frontend and backend run in the same container
    const backendUrl = "http://localhost:12009";

    return [
      {
        source: "/health",
        destination: `${backendUrl}/health`,
      },
      // OAuth endpoints - proxy all oauth paths
      {
        source: "/oauth/:path*",
        destination: `${backendUrl}/metamcp/oauth/:path*`,
      },
      // Well-known endpoints - proxy all well-known paths
      {
        source: "/.well-known/:path*",
        destination: `${backendUrl}/metamcp/.well-known/:path*`,
      },
      // Auth API endpoints
      {
        source: "/api/auth/:path*",
        destination: `${backendUrl}/api/auth/:path*`,
      },
      // Headless API endpoints
      {
        source: "/api/headless/:path*",
        destination: `${backendUrl}/api/headless/:path*`,
      },
      // Register endpoint for dynamic client registration
      {
        source: "/register",
        destination: `${backendUrl}/api/auth/register`,
      },
      {
        source: "/trpc/:path*",
        destination: `${backendUrl}/trpc/frontend/:path*`,
      },
      {
        source: "/mcp-proxy/:path*",
        destination: `${backendUrl}/mcp-proxy/:path*`,
      },
      {
        source: "/metamcp/:path*",
        destination: `${backendUrl}/metamcp/:path*`,
      },
      {
        source: "/service/:path*",
        destination: "https://metatool-service.jczstudio.workers.dev/:path*",
      },
    ];
  },
};

export default nextConfig;
