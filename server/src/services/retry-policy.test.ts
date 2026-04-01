import { describe, it, expect } from "vitest";
import { isRetryableResult, isRetryableError, getBackoffMs, MAX_RETRY_ATTEMPTS } from "./retry-policy.js";
import type { AdapterExecutionResult } from "../adapters/index.js";

function makeResult(overrides: Partial<AdapterExecutionResult>): AdapterExecutionResult {
  return {
    exitCode: 1,
    signal: null,
    timedOut: false,
    clearSession: false,
    usage: undefined,
    runtimeServices: undefined,
    resultJson: null,
    billingType: null,
    provider: null,
    model: null,
    costUsd: null,
    errorMessage: null,
    errorCode: null,
    ...overrides,
  };
}

describe("isRetryableResult", () => {
  it("returns false for successful result", () => {
    expect(isRetryableResult(makeResult({ exitCode: 0, errorMessage: null }))).toBe(false);
  });

  it("detects rate limit errors", () => {
    expect(isRetryableResult(makeResult({ errorMessage: "Error: rate_limit_exceeded" }))).toBe(true);
    expect(isRetryableResult(makeResult({ errorMessage: "429 Too Many Requests" }))).toBe(true);
    expect(isRetryableResult(makeResult({ errorMessage: "HTTP 529 overloaded" }))).toBe(true);
  });

  it("detects throttle errors", () => {
    expect(isRetryableResult(makeResult({ errorMessage: "Request throttled" }))).toBe(true);
    expect(isRetryableResult(makeResult({ errorMessage: "Too many requests" }))).toBe(true);
  });

  it("does NOT retry budget exceeded errors", () => {
    expect(isRetryableResult(makeResult({ errorMessage: "Budget exceeded" }))).toBe(false);
    expect(isRetryableResult(makeResult({ errorMessage: "Quota exceeded" }))).toBe(false);
  });

  it("does NOT retry auth errors", () => {
    expect(isRetryableResult(makeResult({ errorMessage: "Invalid API key" }))).toBe(false);
    expect(isRetryableResult(makeResult({ errorMessage: "Authentication failed" }))).toBe(false);
  });

  it("does NOT retry cancelled errors", () => {
    expect(isRetryableResult(makeResult({ errorMessage: "Run cancelled" }))).toBe(false);
  });

  it("returns false for generic unrecognized errors", () => {
    expect(isRetryableResult(makeResult({ errorMessage: "Unknown error" }))).toBe(false);
    expect(isRetryableResult(makeResult({ errorMessage: "File not found" }))).toBe(false);
  });
});

describe("isRetryableError", () => {
  it("detects retryable error from thrown exception", () => {
    expect(isRetryableError(new Error("rate_limit exceeded"))).toBe(true);
    expect(isRetryableError(new Error("API overloaded"))).toBe(true);
  });

  it("rejects non-Error values", () => {
    expect(isRetryableError("string error")).toBe(false);
    expect(isRetryableError(null)).toBe(false);
  });

  it("does not retry budget errors thrown as exceptions", () => {
    expect(isRetryableError(new Error("budget exceeded"))).toBe(false);
  });
});

describe("getBackoffMs", () => {
  it("returns increasing delays with jitter", () => {
    const delays = Array.from({ length: 5 }, (_, i) => getBackoffMs(i));
    // With jitter, each attempt should generally be larger
    // Just verify they're in reasonable ranges
    expect(delays[0]).toBeGreaterThan(1000);
    expect(delays[0]).toBeLessThan(5000);
    expect(delays[1]).toBeGreaterThan(2000);
    expect(delays[2]).toBeGreaterThan(4000);
  });

  it("clamps to MAX_BACKOFF_MS", () => {
    // Large attempt number should hit the cap (with jitter, allow slight overshoot)
    const delay = getBackoffMs(20);
    expect(delay).toBeLessThanOrEqual(120_000 * 1.2);
  });
});

describe("MAX_RETRY_ATTEMPTS", () => {
  it("is 3", () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });
});
