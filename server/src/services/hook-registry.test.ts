import { describe, it, expect, beforeEach } from "vitest";
import { hookRegistry } from "./hook-registry.js";
import type { PreRunPayload, PostRunPayload } from "./hook-registry.js";

const sampleRunId = "run-001";
const sampleAgentId = "agent-001";
const sampleCompanyId = "company-001";

describe("HookRegistry", () => {
  beforeEach(() => {
    hookRegistry.clear();
  });

  it("registers and emits hooks", async () => {
    const calls: string[] = [];
    hookRegistry.register("pre:run", () => { calls.push("pre:run"); });
    hookRegistry.register("post:run", () => { calls.push("post:run"); });

    await hookRegistry.emit("pre:run", {
      runId: sampleRunId,
      agentId: sampleAgentId,
      companyId: sampleCompanyId,
      contextSnapshot: {},
    });
    await hookRegistry.emit("post:run", {
      runId: sampleRunId,
      agentId: sampleAgentId,
      companyId: sampleCompanyId,
      outcome: "succeeded",
      durationMs: 1000,
      retryCount: 0,
    });

    expect(calls).toEqual(["pre:run", "post:run"]);
  });

  it("returns abort from pre:run hook", async () => {
    hookRegistry.register("pre:run", () => ({ abort: true, abortReason: "budget exceeded" }));

    const result = await hookRegistry.emit("pre:run", {
      runId: sampleRunId,
      agentId: sampleAgentId,
      companyId: sampleCompanyId,
      contextSnapshot: {},
    });

    expect(result.abort).toBe(true);
    expect(result.abortReason).toBe("budget exceeded");
  });

  it("stops after first aborting handler", async () => {
    const calls: string[] = [];
    hookRegistry.register("pre:run", () => { calls.push("first"); return { abort: true }; });
    hookRegistry.register("pre:run", () => { calls.push("second"); });

    const result = await hookRegistry.emit("pre:run", {
      runId: sampleRunId,
      agentId: sampleAgentId,
      companyId: sampleCompanyId,
      contextSnapshot: {},
    });

    expect(result.abort).toBe(true);
    expect(calls).toEqual(["first"]);
  });

  it("does not fail run when handler throws", async () => {
    hookRegistry.register("pre:run", () => { throw new Error("handler error"); });

    const result = await hookRegistry.emit("pre:run", {
      runId: sampleRunId,
      agentId: sampleAgentId,
      companyId: sampleCompanyId,
      contextSnapshot: {},
    });

    expect(result.abort).toBeUndefined();
  });

  it("respects handler priority", async () => {
    const calls: string[] = [];
    hookRegistry.register("pre:run", () => { calls.push("priority-10"); }, { priority: 10 });
    hookRegistry.register("pre:run", () => { calls.push("priority-0"); }, { priority: 0 });
    hookRegistry.register("pre:run", () => { calls.push("priority-5"); }, { priority: 5 });

    await hookRegistry.emit("pre:run", {
      runId: sampleRunId,
      agentId: sampleAgentId,
      companyId: sampleCompanyId,
      contextSnapshot: {},
    });

    expect(calls).toEqual(["priority-0", "priority-5", "priority-10"]);
  });

  it("unregisters hooks via returned cleanup function", async () => {
    const calls: string[] = [];
    const unregister = hookRegistry.register("pre:run", () => { calls.push("registered"); });

    await hookRegistry.emit("pre:run", {
      runId: sampleRunId,
      agentId: sampleAgentId,
      companyId: sampleCompanyId,
      contextSnapshot: {},
    });

    unregister();

    await hookRegistry.emit("pre:run", {
      runId: sampleRunId,
      agentId: sampleAgentId,
      companyId: sampleCompanyId,
      contextSnapshot: {},
    });

    expect(calls).toEqual(["registered"]);
  });

  it("counts hooks by point", () => {
    hookRegistry.register("pre:run", () => {});
    hookRegistry.register("pre:run", () => {});
    hookRegistry.register("post:run", () => {});

    expect(hookRegistry.count("pre:run")).toBe(2);
    expect(hookRegistry.count("post:run")).toBe(1);
    expect(hookRegistry.count()).toBe(3);
  });
});
