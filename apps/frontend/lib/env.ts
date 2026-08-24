import { env } from "next-runtime-env";

export const getAppUrl = () => {
  // Check if we're running on the server side
  if (typeof window === "undefined") {
    // Server-side: try to get from process.env first, then runtime env
    const serverUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
    if (serverUrl) {
      return serverUrl;
    }

    // Throw error instead of fallback to localhost for development
    throw new Error(
      "APP_URL or NEXT_PUBLIC_APP_URL environment variable is required but not set",
    );
  }

  // Client-side: use next-runtime-env
  const NEXT_PUBLIC_APP_URL = env("NEXT_PUBLIC_APP_URL");
  if (!NEXT_PUBLIC_APP_URL) {
    // Fallback to current origin on client side
    return window.location.origin;
  }
  return NEXT_PUBLIC_APP_URL;
};
