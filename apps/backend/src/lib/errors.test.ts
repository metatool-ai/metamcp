import { describe, expect, it } from "vitest";

import { isDatabaseError, publicErrorMessage } from "./errors";

function drizzleError(pgCode?: string) {
  const cause = pgCode
    ? Object.assign(new Error("duplicate key value"), {
        severity: "ERROR",
        code: pgCode,
      })
    : undefined;
  return Object.assign(
    new Error(
      'Failed query: insert into "mcp_servers" ("bearer_token") values ($1)\nparams: s3cr3t',
    ),
    { name: "DrizzleQueryError", cause },
  );
}

describe("publicErrorMessage", () => {
  it("never returns the SQL text or its parameters", () => {
    const message = publicErrorMessage(drizzleError(), "Internal server error");
    expect(message).toBe("Internal server error");
    expect(isDatabaseError(drizzleError())).toBe(true);
    // Re-thrown as a plain Error with the same message
    expect(
      publicErrorMessage(new Error(drizzleError().message), "Failed"),
    ).toBe("Failed");
  });

  it("explains unique violations without naming the constraint", () => {
    expect(publicErrorMessage(drizzleError("23505"), "Failed")).toBe(
      "An item with the same name already exists.",
    );
  });

  it("keeps application error messages", () => {
    expect(publicErrorMessage(new Error("Name is required"), "Failed")).toBe(
      "Name is required",
    );
    expect(publicErrorMessage("boom", "Failed")).toBe("Failed");
    expect(isDatabaseError(new Error("Name is required"))).toBe(false);
  });
});
