import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContextCache, CONTEXT_CACHE_TTL_MS } from "./context-cache.js";

describe("ContextCache", () => {
  let cache: ContextCache;

  beforeEach(() => {
    cache = new ContextCache(1_000); // 1s TTL
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null for missing key", () => {
    expect(cache.get("not-found")).toBeNull();
  });

  it("returns value after set", () => {
    cache.set("key1", { id: "abc", title: "issue" });
    expect(cache.get<{ id: string; title: string }>("key1")).toEqual({ id: "abc", title: "issue" });
  });

  it("returns null after TTL expires", () => {
    cache.set("key2", "value");
    vi.advanceTimersByTime(1_001); // past TTL
    expect(cache.get("key2")).toBeNull();
  });

  it("retains value within TTL", () => {
    cache.set("key3", 42);
    vi.advanceTimersByTime(999);
    expect(cache.get<number>("key3")).toBe(42);
  });

  it("delete invalidates immediately", () => {
    cache.set("key4", "will be deleted");
    cache.delete("key4");
    expect(cache.get("key4")).toBeNull();
  });

  it("invalidateByPrefix removes all matching keys", () => {
    cache.set("issue:abc", "A");
    cache.set("issue:def", "B");
    cache.set("project:xyz", "C");
    cache.invalidateByPrefix("issue:");
    expect(cache.get("issue:abc")).toBeNull();
    expect(cache.get("issue:def")).toBeNull();
    expect(cache.get<string>("project:xyz")).toBe("C");
  });

  it("purgeExpired removes only expired entries", () => {
    cache.set("live", "keeps");
    cache.set("dead", "gone");
    vi.advanceTimersByTime(1_001); // past TTL
    cache.set("new", "fresh"); // within TTL
    const purged = cache.purgeExpired();
    expect(purged).toBe(2); // "live" and "dead" expired
    expect(cache.get<string>("new")).toBe("fresh");
  });

  it("size returns current entry count", () => {
    expect(cache.size).toBe(0);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);
  });

  it("CONTEXT_CACHE_TTL_MS default is 60s", () => {
    expect(CONTEXT_CACHE_TTL_MS).toBe(60_000);
  });
});
