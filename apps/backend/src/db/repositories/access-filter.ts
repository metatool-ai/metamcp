import { eq, inArray, isNull, or, SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/**
 * Which rows of a resource table a principal may see: the rows they own,
 * the rows shared with them and, for administrators, the organisation's rows
 * (no owner). The personal rows of other users are never part of it.
 */
export type AccessibleFilter = {
  ownerId: string;
  sharedUuids: string[];
  organisation: boolean;
};

/** SQL condition selecting the rows of `filter`. */
export function accessibleWhere(
  filter: AccessibleFilter,
  ownerColumn: AnyPgColumn,
  uuidColumn: AnyPgColumn,
): SQL {
  const conditions: SQL[] = [eq(ownerColumn, filter.ownerId)];
  if (filter.organisation) {
    conditions.push(isNull(ownerColumn));
  }
  if (filter.sharedUuids.length > 0) {
    conditions.push(inArray(uuidColumn, filter.sharedUuids));
  }
  return or(...conditions) ?? conditions[0];
}
