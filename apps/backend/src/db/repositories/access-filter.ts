/**
 * Which rows of a resource table a principal may see: everything (admins) or
 * the rows they own plus the rows explicitly shared with them.
 */
export type AccessibleFilter =
  | { all: true }
  | { all: false; ownerId: string; sharedUuids: string[] };
