import cors from "cors";
import express from "express";

import logger from "@/utils/logger";

import { oauthRepository } from "../../db/repositories";
import authorizationRouter from "./authorization";
import metadataRouter from "./metadata";
import registrationRouter from "./registration";
import tokenRouter from "./token";
import userinfoRouter from "./userinfo";
import {
  jsonParsingMiddleware,
  securityHeaders,
  urlencodedParsingMiddleware,
} from "./utils";

const oauthRouter = express.Router();

// Cleanup expired entries every 5 minutes
setInterval(
  async () => {
    try {
      await oauthRepository.cleanupExpired();
      logger.info("Cleaned up expired OAuth codes and tokens");
    } catch (error) {
      logger.error("Error cleaning up expired OAuth entries:", error);
    }
  },
  5 * 60 * 1000,
);

// OAuth and discovery paths. This router is mounted at the root of the
// app: its middlewares must not leak onto the other routes.
const OAUTH_PATHS = ["/oauth", "/.well-known"];

// Any origin may call the OAuth endpoints (browser-based MCP clients), but
// without cookies: they authenticate with client credentials and tokens.
oauthRouter.use(
  OAUTH_PATHS,
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// Apply middleware for OAuth-specific routes
oauthRouter.use(OAUTH_PATHS, securityHeaders);
oauthRouter.use(jsonParsingMiddleware);
oauthRouter.use(urlencodedParsingMiddleware);

// Mount all OAuth sub-routers
oauthRouter.use(metadataRouter);
oauthRouter.use(authorizationRouter);
oauthRouter.use(tokenRouter);
oauthRouter.use(registrationRouter);
oauthRouter.use(userinfoRouter);

export default oauthRouter;
