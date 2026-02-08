import { beforeEach, describe, expect, it } from "vitest";

import { ToolsSyncCache } from "./tools-sync-cache";

describe("ToolsSyncCache", () => {
  let cache: ToolsSyncCache;

  beforeEach(() => {
    cache = new ToolsSyncCache();
  });

  describe("hashTools", () => {
    it("should generate consistent hash for same tools", () => {
      const tools = ["tool1", "tool2", "tool3"];
      const hash1 = cache.hashTools(tools);
      const hash2 = cache.hashTools(tools);

      expect(hash1).toBe(hash2);
    });

    it("should generate same hash regardless of order", () => {
      const tools1 = ["tool1", "tool2", "tool3"];
      const tools2 = ["tool3", "tool1", "tool2"];
      const hash1 = cache.hashTools(tools1);
      const hash2 = cache.hashTools(tools2);

      expect(hash1).toBe(hash2);
    });

    it("should generate different hash for different tools", () => {
      const tools1 = ["tool1", "tool2"];
      const tools2 = ["tool1", "tool3"];
      const hash1 = cache.hashTools(tools1);
      const hash2 = cache.hashTools(tools2);

      expect(hash1).not.toBe(hash2);
    });

    it("should handle empty array", () => {
      const hash = cache.hashTools([]);
      expect(hash).toBeDefined();
      expect(typeof hash).toBe("string");
    });
  });

  describe("hasChanged", () => {
    it("should return true when no cache exists", () => {
      const tools = ["tool1", "tool2"];
      const changed = cache.hasChanged("server-uuid-1", tools);

      expect(changed).toBe(true);
    });

    it("should return false when tools are unchanged", () => {
      const tools = ["tool1", "tool2"];
      const serverUuid = "server-uuid-1";

      cache.update(serverUuid, tools);
      const changed = cache.hasChanged(serverUuid, tools);

      expect(changed).toBe(false);
    });

    it("should return true when tools have changed", () => {
      const serverUuid = "server-uuid-1";
      const tools1 = ["tool1", "tool2"];
      const tools2 = ["tool1", "tool2", "tool3"];

      cache.update(serverUuid, tools1);
      const changed = cache.hasChanged(serverUuid, tools2);

      expect(changed).toBe(true);
    });

    it("should return false when tools are reordered but same", () => {
      const serverUuid = "server-uuid-1";
      const tools1 = ["tool1", "tool2", "tool3"];
      const tools2 = ["tool3", "tool1", "tool2"];

      cache.update(serverUuid, tools1);
      const changed = cache.hasChanged(serverUuid, tools2);

      expect(changed).toBe(false);
    });
  });

  describe("shouldSync", () => {
    it("should return true and update cache on first call", () => {
      const tools = ["tool1", "tool2"];
      const serverUuid = "server-uuid-1";

      const shouldSync = cache.shouldSync(serverUuid, tools);

      expect(shouldSync).toBe(true);
      expect(cache.hasChanged(serverUuid, tools)).toBe(false);
    });

    it("should return false on second call with same tools", () => {
      const tools = ["tool1", "tool2"];
      const serverUuid = "server-uuid-1";

      cache.shouldSync(serverUuid, tools);
      const shouldSync = cache.shouldSync(serverUuid, tools);

      expect(shouldSync).toBe(false);
    });

    it("should return true when tools change", () => {
      const serverUuid = "server-uuid-1";
      const tools1 = ["tool1", "tool2"];
      const tools2 = ["tool1", "tool2", "tool3"];

      cache.shouldSync(serverUuid, tools1);
      const shouldSync = cache.shouldSync(serverUuid, tools2);

      expect(shouldSync).toBe(true);
    });

    it("should handle multiple servers independently", () => {
      const tools1 = ["tool1", "tool2"];
      const tools2 = ["tool3", "tool4"];

      const shouldSync1 = cache.shouldSync("server-1", tools1);
      const shouldSync2 = cache.shouldSync("server-2", tools2);

      expect(shouldSync1).toBe(true);
      expect(shouldSync2).toBe(true);

      // Second calls should not need sync
      expect(cache.shouldSync("server-1", tools1)).toBe(false);
      expect(cache.shouldSync("server-2", tools2)).toBe(false);
    });
  });

  describe("clear", () => {
    it("should clear specific server cache", () => {
      const tools = ["tool1", "tool2"];
      cache.update("server-1", tools);
      cache.update("server-2", tools);

      cache.clear("server-1");

      expect(cache.hasChanged("server-1", tools)).toBe(true);
      expect(cache.hasChanged("server-2", tools)).toBe(false);
    });

    it("should clear all cache when no uuid provided", () => {
      const tools = ["tool1", "tool2"];
      cache.update("server-1", tools);
      cache.update("server-2", tools);

      cache.clear();

      expect(cache.hasChanged("server-1", tools)).toBe(true);
      expect(cache.hasChanged("server-2", tools)).toBe(true);
    });
  });

  describe("getStats", () => {
    it("should return empty stats initially", () => {
      const stats = cache.getStats();

      expect(stats.size).toBe(0);
      expect(stats.servers).toEqual([]);
    });

    it("should return correct stats after updates", () => {
      cache.update("server-1", ["tool1"]);
      cache.update("server-2", ["tool2"]);

      const stats = cache.getStats();

      expect(stats.size).toBe(2);
      expect(stats.servers).toContain("server-1");
      expect(stats.servers).toContain("server-2");
    });
  });

  describe("real-world scenarios", () => {
    it("should handle tool removal correctly", () => {
      const serverUuid = "server-uuid-1";
      const toolsInitial = ["tool1", "tool2", "tool3"];
      const toolsAfterRemoval = ["tool1", "tool2"];

      // First sync
      expect(cache.shouldSync(serverUuid, toolsInitial)).toBe(true);

      // Tools removed
      expect(cache.shouldSync(serverUuid, toolsAfterRemoval)).toBe(true);

      // No further changes
      expect(cache.shouldSync(serverUuid, toolsAfterRemoval)).toBe(false);
    });

    it("should handle all tools removed (empty array)", () => {
      const serverUuid = "server-uuid-1";
      const toolsInitial = ["tool1", "tool2"];
      const toolsEmpty: string[] = [];

      // First sync with tools
      expect(cache.shouldSync(serverUuid, toolsInitial)).toBe(true);

      // All tools removed
      expect(cache.shouldSync(serverUuid, toolsEmpty)).toBe(true);

      // Still empty
      expect(cache.shouldSync(serverUuid, toolsEmpty)).toBe(false);
    });

    it("should handle tool addition correctly", () => {
      const serverUuid = "server-uuid-1";
      const toolsInitial = ["tool1"];
      const toolsAfterAddition = ["tool1", "tool2", "tool3"];

      // First sync
      expect(cache.shouldSync(serverUuid, toolsInitial)).toBe(true);

      // Tools added
      expect(cache.shouldSync(serverUuid, toolsAfterAddition)).toBe(true);

      // No further changes
      expect(cache.shouldSync(serverUuid, toolsAfterAddition)).toBe(false);
    });

    it("should handle rapid reconnections efficiently", () => {
      const serverUuid = "server-uuid-1";
      const tools = ["tool1", "tool2", "tool3"];

      // Simulate 100 rapid reconnections with same tools
      let syncCount = 0;
      for (let i = 0; i < 100; i++) {
        if (cache.shouldSync(serverUuid, tools)) {
          syncCount++;
        }
      }

      // Only the first call should trigger sync
      expect(syncCount).toBe(1);
    });
  });
});
