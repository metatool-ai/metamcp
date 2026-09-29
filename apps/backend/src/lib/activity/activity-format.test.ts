import { afterEach, describe, expect, it } from "vitest";

import {
  activityRetentionDays,
  csvCell,
  diffFields,
  redactDetails,
} from "./activity-format";

describe("redactDetails", () => {
  it("replaces values stored under sensitive keys", () => {
    expect(
      redactDetails({
        token: "abc",
        clientSecret: "s3cr3t",
        Authorization: "Bearer x",
        api_key: "sk_mt_x",
        nested: { password: "p", role: "editor" },
        changedFields: ["env.GITHUB_TOKEN"],
      }),
    ).toEqual({
      token: "[redacted]",
      clientSecret: "[redacted]",
      Authorization: "[redacted]",
      api_key: "[redacted]",
      nested: { password: "[redacted]", role: "editor" },
      // names of changed fields are fine: they are not values
      changedFields: ["env.GITHUB_TOKEN"],
    });
  });

  it("bounds long strings and deep structures", () => {
    const long = "x".repeat(600);
    expect(
      (redactDetails({ note: long }) as { note: string }).note,
    ).toHaveLength(501);
    let deep: Record<string, unknown> = { leaf: 1 };
    for (let i = 0; i < 10; i++) deep = { deep };
    expect(JSON.stringify(redactDetails(deep))).toContain("[…]");
  });
});

describe("diffFields", () => {
  it("returns only the fields that changed", () => {
    expect(
      diffFields(
        { role: "viewer", name: "Alice", groups: ["a"] },
        { role: "editor", name: "Alice", groups: ["a"] },
        ["role", "name", "groups"],
      ),
    ).toEqual({ role: { from: "viewer", to: "editor" } });
  });

  it("ignores fields absent from the update", () => {
    expect(diffFields({ role: "viewer" }, {}, ["role"])).toEqual({});
  });
});

describe("csvCell", () => {
  it("quotes values and neutralises spreadsheet formulas", () => {
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    expect(csvCell("+1")).toBe(`"'+1"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
    expect(csvCell(new Date("2026-09-28T12:00:00Z"))).toBe(
      '"2026-09-28T12:00:00.000Z"',
    );
  });
});

describe("activityRetentionDays", () => {
  const original = process.env.ACTIVITY_LOG_RETENTION_DAYS;
  afterEach(() => {
    if (original === undefined) delete process.env.ACTIVITY_LOG_RETENTION_DAYS;
    else process.env.ACTIVITY_LOG_RETENTION_DAYS = original;
  });

  it("defaults to one year and 0 keeps entries forever", () => {
    delete process.env.ACTIVITY_LOG_RETENTION_DAYS;
    expect(activityRetentionDays()).toBe(365);
    process.env.ACTIVITY_LOG_RETENTION_DAYS = "90";
    expect(activityRetentionDays()).toBe(90);
    process.env.ACTIVITY_LOG_RETENTION_DAYS = "0";
    expect(activityRetentionDays()).toBeNull();
  });
});
