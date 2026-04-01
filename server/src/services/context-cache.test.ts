import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ContextCache, CONTEXT_CACHE_TTL_MS } from "./context-cache.js";

describe("ContextCache", () => {
  let cache: ContextCache;

  beforeEach(() => {
    cache = new ContextCache(1_000); // 1초 TTL
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("존재하지 않는 키 → null 반환", () => {
    expect(cache.get("not-found")).toBeNull();
  });

  it("set 후 get → 값 반환", () => {
    cache.set("key1", { id: "abc", title: "이슈" });
    expect(cache.get<{ id: string; title: string }>("key1")).toEqual({ id: "abc", title: "이슈" });
  });

  it("TTL 경과 후 → null 반환", () => {
    cache.set("key2", "value");
    vi.advanceTimersByTime(1_001); // TTL 초과
    expect(cache.get("key2")).toBeNull();
  });

  it("TTL 이내 → 값 유지", () => {
    cache.set("key3", 42);
    vi.advanceTimersByTime(999);
    expect(cache.get<number>("key3")).toBe(42);
  });

  it("delete → 즉시 무효화", () => {
    cache.set("key4", "will be deleted");
    cache.delete("key4");
    expect(cache.get("key4")).toBeNull();
  });

  it("invalidateByPrefix → 접두사 매칭 키 전부 삭제", () => {
    cache.set("issue:abc", "A");
    cache.set("issue:def", "B");
    cache.set("project:xyz", "C");
    cache.invalidateByPrefix("issue:");
    expect(cache.get("issue:abc")).toBeNull();
    expect(cache.get("issue:def")).toBeNull();
    expect(cache.get<string>("project:xyz")).toBe("C");
  });

  it("purgeExpired → 만료된 엔트리만 삭제", () => {
    cache.set("live", "keeps");
    cache.set("dead", "gone");
    vi.advanceTimersByTime(1_001); // TTL 초과
    cache.set("new", "fresh"); // TTL 내 새 엔트리
    const purged = cache.purgeExpired();
    expect(purged).toBe(2); // "live", "dead" 만료
    expect(cache.get<string>("new")).toBe("fresh");
  });

  it("size → 현재 저장된 엔트리 수 반환", () => {
    expect(cache.size).toBe(0);
    cache.set("a", 1);
    cache.set("b", 2);
    expect(cache.size).toBe(2);
  });

  it("CONTEXT_CACHE_TTL_MS 기본값 60초", () => {
    expect(CONTEXT_CACHE_TTL_MS).toBe(60_000);
  });
});
