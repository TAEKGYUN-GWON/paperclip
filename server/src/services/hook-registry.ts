/**
 * hook-registry.ts
 * Phase 8: 실행 훅 레지스트리
 *
 * heartbeat.ts의 하드코딩된 콜백을 플러그인 가능한 훅 시스템으로 교체합니다.
 * 훅 핸들러는 별도 파일에서 등록하고, heartbeat이 자동으로 호출합니다.
 */

/** 8개 훅 포인트 정의 */
export type HookPoint =
  | "pre:run"        // 런 시작 전 — 예산 초과 시 차단 가능
  | "post:run"       // 런 완료 후 — 메트릭 기록, 알림
  | "pre:adapter"    // 어댑터 실행 전 — 컨텍스트 최종 수정
  | "post:adapter"   // 어댑터 실행 후 — 결과 변환, 민감정보 마스킹
  | "pre:context"    // 컨텍스트 빌드 전
  | "post:context"   // 컨텍스트 빌드 후 — 컨텍스트 검증
  | "on:session-rotate"  // 세션 회전 발생 시
  | "on:budget-alert";   // 예산 임계값 접근 시

/** 훅 페이로드 타입 맵 */
export interface HookPayloads {
  "pre:run": PreRunPayload;
  "post:run": PostRunPayload;
  "pre:adapter": PreAdapterPayload;
  "post:adapter": PostAdapterPayload;
  "pre:context": PreContextPayload;
  "post:context": PostContextPayload;
  "on:session-rotate": SessionRotatePayload;
  "on:budget-alert": BudgetAlertPayload;
}

export interface PreRunPayload {
  runId: string;
  agentId: string;
  companyId: string;
  contextSnapshot: Record<string, unknown>;
}

export interface PostRunPayload {
  runId: string;
  agentId: string;
  companyId: string;
  outcome: "succeeded" | "failed" | "cancelled" | "timed_out";
  durationMs: number;
  retryCount: number;
}

export interface PreAdapterPayload {
  runId: string;
  agentId: string;
  companyId: string;
  adapterType: string;
  attempt: number;
}

export interface PostAdapterPayload {
  runId: string;
  agentId: string;
  companyId: string;
  adapterType: string;
  exitCode: number | null;
  errorMessage: string | null;
  errorCode: string | null;
  attempt: number;
}

export interface PreContextPayload {
  runId: string;
  agentId: string;
  companyId: string;
}

export interface PostContextPayload {
  runId: string;
  agentId: string;
  companyId: string;
  contextSnapshot: Record<string, unknown>;
}

export interface SessionRotatePayload {
  runId: string;
  agentId: string;
  companyId: string;
  reason: string | null;
  previousSessionId: string | null;
}

export interface BudgetAlertPayload {
  runId: string;
  agentId: string;
  companyId: string;
  usedCents: number;
  limitCents: number;
  utilizationPct: number;
}

/** 훅 핸들러 결과 — pre: 훅은 abort로 런 차단 가능 */
export interface HookResult {
  /** true이면 현재 런을 즉시 중단합니다 (pre: 훅에서만 유효) */
  abort?: boolean;
  /** abort 시 사용자에게 표시할 메시지 */
  abortReason?: string;
}

export type HookHandler<P> = (payload: P) => Promise<HookResult | void> | HookResult | void;

type AnyHookHandler = HookHandler<HookPayloads[HookPoint]>;

interface RegisteredHook {
  id: string;
  point: HookPoint;
  handler: AnyHookHandler;
  priority: number; // 낮을수록 먼저 실행, 기본 0
}

/** 전역 훅 레지스트리 */
class HookRegistry {
  private hooks: RegisteredHook[] = [];
  private nextId = 1;

  /**
   * 훅 핸들러를 등록합니다.
   * @returns 등록 해제 함수
   */
  register<P extends HookPoint>(
    point: P,
    handler: HookHandler<HookPayloads[P]>,
    opts: { priority?: number; id?: string } = {},
  ): () => void {
    const id = opts.id ?? `hook_${this.nextId++}`;
    const priority = opts.priority ?? 0;
    this.hooks.push({
      id,
      point,
      handler: handler as AnyHookHandler,
      priority,
    });
    this.hooks.sort((a, b) => a.priority - b.priority);
    return () => this.unregister(id);
  }

  unregister(id: string): void {
    this.hooks = this.hooks.filter((h) => h.id !== id);
  }

  /**
   * 지정된 훅 포인트의 모든 핸들러를 순서대로 실행합니다.
   * 핸들러 오류는 catch하여 런 실패를 방지합니다.
   * pre: 훅에서 abort가 반환되면 즉시 중단합니다.
   */
  async emit<P extends HookPoint>(
    point: P,
    payload: HookPayloads[P],
    logger?: { warn: (obj: object, msg: string) => void },
  ): Promise<HookResult> {
    const handlers = this.hooks.filter((h) => h.point === point);
    for (const { id, handler } of handlers) {
      try {
        const result = await handler(payload as HookPayloads[HookPoint]);
        if (result?.abort) {
          return { abort: true, abortReason: result.abortReason };
        }
      } catch (err) {
        logger?.warn(
          { hookId: id, point, err },
          `Hook handler error (${point}/${id}) — ignored`,
        );
      }
    }
    return {};
  }

  /** 등록된 훅 수 (테스트용) */
  count(point?: HookPoint): number {
    return point ? this.hooks.filter((h) => h.point === point).length : this.hooks.length;
  }

  /** 테스트용: 모든 훅 제거 */
  clear(): void {
    this.hooks = [];
  }
}

/** 싱글턴 훅 레지스트리 인스턴스 */
export const hookRegistry = new HookRegistry();
