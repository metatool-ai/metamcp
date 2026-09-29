import { afterEach, describe, expect, it } from "vitest";

import {
  assertEgressAllowed,
  EgressBlockedError,
  isBlockedAddress,
} from "./egress-guard";

describe("egress guard", () => {
  afterEach(() => {
    delete process.env.ALLOW_LINK_LOCAL_EGRESS;
  });

  it("blocks link-local and cloud metadata addresses", () => {
    expect(isBlockedAddress("169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("fd00:ec2::254")).toBe(true);
    expect(isBlockedAddress("fe80::1")).toBe(true);
    expect(isBlockedAddress("100.100.100.200")).toBe(true);
    expect(isBlockedAddress("0.0.0.0")).toBe(true);
  });

  it("keeps private networks and public hosts reachable", () => {
    for (const address of [
      "10.0.0.5",
      "192.168.1.10",
      "172.17.0.1",
      "127.0.0.1",
      "::1",
      "fd12:3456::1",
      "93.184.216.34",
    ]) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });

  it("checks literal hosts and resolved names", async () => {
    await expect(
      assertEgressAllowed("http://169.254.169.254/latest/meta-data/"),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    await expect(
      assertEgressAllowed("http://[fd00:ec2::254]/latest"),
    ).rejects.toBeInstanceOf(EgressBlockedError);
    await expect(
      assertEgressAllowed("http://localhost:3000/mcp"),
    ).resolves.toBeUndefined();
  });

  it("can be disabled", async () => {
    process.env.ALLOW_LINK_LOCAL_EGRESS = "true";
    await expect(
      assertEgressAllowed("http://169.254.169.254/"),
    ).resolves.toBeUndefined();
  });
});
