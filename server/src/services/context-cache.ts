/**
 * context-cache.ts
 * 런 시작 시 반복되는 DB 쿼리 결과를 단기 캐시하여 레이턴시를 줄입니다.
 *
 * Phase 7: Claude Code 패턴 — 컨텍스트 메모이제이션 캐시
 * - 이슈/프로젝트 쿼리를 키별 TTL 기반 인메모리 캐시로 저장
 * - 에이전트 상태 변경 시 해당 키 무효화
 */

interface CachedEntry<T> {
  value: T;
  expiresAt: number;
}

/** 컨텍스트 캐시 기본 TTL (밀리초) */
export const CONTEXT_CACHE_TTL_MS = 60_000;

/**
 * 인메모리 키-값 캐시 (TTL 지원)
 *
 * heartbeat.ts 내 런 시작마다 반복되는 DB 쿼리를 대상으로 합니다:
 * - 이슈 컨텍스트 (`issue:<issueId>`)
 * - 프로젝트 실행 워크스페이스 정책 (`project:<projectId>`)
 *
 * 이슈/프로젝트는 에이전트 런 중 거의 변경되지 않으므로
 * 60초 TTL은 정확성과 성능 사이의 합리적인 트레이드오프입니다.
 */
export class ContextCache {
  private readonly store = new Map<string, CachedEntry<unknown>>();
  private readonly ttlMs: number;

  constructor(ttlMs = CONTEXT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * 키에 해당하는 캐시 값을 반환합니다.
   * 만료된 엔트리는 삭제 후 null을 반환합니다.
   */
  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  /** 키-값 쌍을 TTL과 함께 저장합니다. */
  set<T>(key: string, value: T): void {
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  /**
   * 특정 키의 캐시를 삭제합니다.
   * 이슈 업데이트 직후 호출하여 stale 데이터를 방지합니다.
   */
  delete(key: string): void {
    this.store.delete(key);
  }

  /**
   * 특정 접두사로 시작하는 모든 캐시 엔트리를 삭제합니다.
   * 에이전트 관련 캐시 일괄 무효화에 사용합니다.
   */
  invalidateByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** 현재 캐시에 저장된 엔트리 수 (만료 포함) */
  get size(): number {
    return this.store.size;
  }

  /** 만료된 엔트리를 모두 정리합니다 (GC 목적) */
  purgeExpired(): number {
    const now = Date.now();
    let purged = 0;
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        purged++;
      }
    }
    return purged;
  }
}

/** 프로세스 수명 동안 공유되는 전역 컨텍스트 캐시 인스턴스 */
export const contextCache = new ContextCache();
