import {
  ClientNotificationSchema,
  NotificationSchema as BaseNotificationSchema,
  ServerNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";
// SDK 1.26 schemas use the zod 4 API; compose with zod 4 so .extend()/.or()
// and z.infer line up with the SDK's schema types.
import { z } from "zod/v4";

export const StdErrNotificationSchema = BaseNotificationSchema.extend({
  method: z.literal("notifications/stderr"),
  params: z.object({
    content: z.string(),
  }),
});

export const NotificationSchema = ClientNotificationSchema.or(
  StdErrNotificationSchema,
)
  .or(ServerNotificationSchema)
  .or(BaseNotificationSchema);

export type StdErrNotification = z.infer<typeof StdErrNotificationSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
