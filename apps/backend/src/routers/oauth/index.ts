import cors from "cors";
import express from "express";

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
      console.log("Cleaned up expired OAuth codes and tokens");
    } catch (error) {
      console.error("Error cleaning up expired OAuth entries:", error);
    }
  },
  5 * 60 * 1000,
);

// Enable CORS for all OAuth endpoints with wildcard origin
oauthRouter.use(
  cors({
    origin: "*", // Allow all origins for OAuth endpoints
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
  }),
);

// Apply middleware for OAuth-specific routes
oauthRouter.use(securityHeaders);
oauthRouter.use(jsonParsingMiddleware);
oauthRouter.use(urlencodedParsingMiddleware);

// Mount all OAuth sub-routers
oauthRouter.use(metadataRouter);
oauthRouter.use(authorizationRouter);
oauthRouter.use(tokenRouter);
oauthRouter.use(registrationRouter);
oauthRouter.use(userinfoRouter);

export default oauthRouter;
