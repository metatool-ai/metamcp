import {
  type AccessPrincipal,
  ACTIVITY_ACTIONS,
  type ActivityAction,
  type ActivityLogEntry,
  type ActivityOutcome,
  type ListActivityRequest,
} from "@repo/zod-types";

import logger from "@/utils/logger";

import {
  type ActivityLogRow,
  activityLogsRepository,
} from "../../db/repositories/activity-logs.repo";
import { usersRepository } from "../../db/repositories/users.repo";
import { getRequestContext } from "../request-context";
import {
  activityRetentionDays,
  csvCell,
  redactDetails,
} from "./activity-format";

export { diffFields, redactDetails } from "./activity-format";

/**
 * Administrative activity log: who changed access, configuration or
 * resources, and security events. Recording never fails the operation it
 * describes (errors are logged), and never stores secret values.
 */

export type ActivityActor =
  | AccessPrincipal
  /** A user known by id only, e.g. in authentication hooks. */
  | { kind: "user"; userId: string }
  /** MetaMCP itself: SSO synchronisation, ADMIN_EMAILS, startup tasks. */
  | { kind: "system"; label: string };

export type ActivityTarget = {
  type: string;
  id: string | null;
  label?: string | null;
};

export type RecordActivityInput = {
  actor: ActivityActor;
  action: ActivityAction;
  target?: ActivityTarget;
  details?: Record<string, unknown>;
  outcome?: ActivityOutcome;
};

function isPrincipal(actor: ActivityActor): actor is AccessPrincipal {
  return "capabilities" in actor;
}

export function toEntry(row: ActivityLogRow): ActivityLogEntry {
  return {
    uuid: row.uuid,
    createdAt: row.created_at,
    actorType: row.actor_type,
    actorId: row.actor_id,
    actorEmail: row.actor_email,
    actorName: row.actor_name,
    action: row.action,
    category: row.category,
    targetType: row.target_type,
    targetId: row.target_id,
    targetLabel: row.target_label,
    details: row.details,
    outcome: row.outcome,
    ipAddress: row.ip_address,
    userAgent: row.user_agent,
  };
}

const EXPORT_LIMIT = 10_000;
const DAY_MS = 24 * 60 * 60 * 1000;

class ActivityLogService {
  private retentionTimer: NodeJS.Timeout | null = null;

  async record(input: RecordActivityInput): Promise<void> {
    try {
      const actor = await this.describeActor(input.actor);
      const context = getRequestContext();
      const entry = {
        ...actor,
        action: input.action,
        category: ACTIVITY_ACTIONS[input.action],
        target_type: input.target?.type ?? null,
        target_id: input.target?.id ?? null,
        target_label: input.target?.label ?? null,
        details: redactDetails(input.details ?? {}) as Record<string, unknown>,
        outcome: input.outcome ?? "success",
        ip_address: context?.ipAddress ?? null,
        user_agent: context?.userAgent ?? null,
      };
      await activityLogsRepository.insert(entry);
      if (process.env.ACTIVITY_LOG_STDOUT === "true") {
        // One JSON line per event, for log shippers / SIEM.
        console.log(
          JSON.stringify({
            type: "metamcp.activity",
            time: new Date().toISOString(),
            ...entry,
          }),
        );
      }
    } catch (error) {
      logger.error(`Failed to record activity "${input.action}":`, error);
    }
  }

  async list(request: ListActivityRequest) {
    const { offset, limit, ...filters } = request;
    const { rows, total } = await activityLogsRepository.list(
      filters,
      offset,
      limit,
    );
    return {
      entries: rows.map(toEntry),
      total,
      retentionDays: activityRetentionDays(),
    };
  }

  async exportCsv(filters: Omit<ListActivityRequest, "offset" | "limit">) {
    const { rows, total } = await activityLogsRepository.list(
      filters,
      0,
      EXPORT_LIMIT,
    );
    const header = [
      "time",
      "actor_type",
      "actor_email",
      "actor_name",
      "action",
      "category",
      "outcome",
      "target_type",
      "target_id",
      "target_label",
      "ip_address",
      "user_agent",
      "details",
    ];
    const lines = rows.map((row) =>
      [
        row.created_at,
        row.actor_type,
        row.actor_email,
        row.actor_name,
        row.action,
        row.category,
        row.outcome,
        row.target_type,
        row.target_id,
        row.target_label,
        row.ip_address,
        row.user_agent,
        row.details,
      ]
        .map(csvCell)
        .join(","),
    );
    return {
      csv: [header.map(csvCell).join(","), ...lines].join("\r\n"),
      truncated: total > rows.length,
    };
  }

  /** Deletes entries past the retention period now and once a day. */
  startRetention(): void {
    const run = async () => {
      const days = activityRetentionDays();
      if (!days) return;
      try {
        const removed = await activityLogsRepository.deleteOlderThan(
          new Date(Date.now() - days * DAY_MS),
        );
        if (removed > 0) {
          logger.info(
            `Activity log: removed ${removed} entr${removed === 1 ? "y" : "ies"} older than ${days} days`,
          );
        }
      } catch (error) {
        logger.error("Activity log retention failed:", error);
      }
    };
    void run();
    if (this.retentionTimer) clearInterval(this.retentionTimer);
    this.retentionTimer = setInterval(run, DAY_MS);
    this.retentionTimer.unref?.();
  }

  private async describeActor(actor: ActivityActor) {
    if (!isPrincipal(actor) && actor.kind === "system") {
      return {
        actor_type: "system" as const,
        actor_id: null,
        actor_email: null,
        actor_name: actor.label,
      };
    }
    const userId = isPrincipal(actor) ? actor.userId : actor.userId;
    const user = await usersRepository.findById(userId).catch(() => undefined);
    return {
      actor_type: "user" as const,
      actor_id: userId,
      actor_email: user?.email ?? null,
      actor_name: user?.name ?? null,
    };
  }
}

export const activityLog = new ActivityLogService();
