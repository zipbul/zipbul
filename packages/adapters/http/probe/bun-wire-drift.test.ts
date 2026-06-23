/**
 * bun-wire-drift — probe 디렉토리에서 *유일한* 테스트.
 *
 * 이건 일반 spec 테스트(설계된 동작 단언)와 결이 다른 characterization test다:
 * "현재 Bun의 wire 동작 == 커밋된 baseline"을 박제한다. 깨지면 Bun이 (보통
 * 자동 업그레이드로) 동작을 바꿨다는 신호 → SPEC §1.1 가정과 어댑터 책임을
 * 재평가하고, 의도적으로 baseline을 갱신(--write)하라.
 *
 * 비교는 케이스 *집합* 전체에 대해 한다 — 추가(live에만)·삭제(baseline에만)·
 * 변경(label/verdict/signal)을 모두 잡는다. label 변경도 포함한다(프로브에서
 * 케이스명·라벨만 바뀌고 baseline 미갱신인 상황을 놓치지 않기 위해).
 *
 * 환경 게이트: 실행 Bun·플랫폼이 baseline과 다르면 hard-fail이 아니라
 * loud-skip한다(기여자 머신/CI 환경 차이만으로 전원 빨감을 막는다). hard-fail은
 * 동일 환경에서 케이스 집합이 *바뀐* 경우에만 의미가 있다.
 */

import { test, expect } from 'bun:test';
import { runProbes, BUN_VERSION, PLATFORM } from './bun-wire-probe';
import baseline from './bun-wire.baseline.json';

interface CaseKey {
  label: string;
  verdict: string;
  signal: string;
}

const keyOf = (c: CaseKey): string => `${c.label}|${c.verdict}|${c.signal}`;

test('bun-wire: 현재 Bun의 wire 동작이 baseline과 일치한다', async () => {
  if (baseline.bunVersion !== BUN_VERSION || baseline.platform !== PLATFORM) {
    console.warn(
      `\n[bun-wire-drift] SKIP — baseline=${baseline.bunVersion}/${baseline.platform}, ` +
        `running=${BUN_VERSION}/${PLATFORM}` +
        `\n  → 'bun probe/bun-wire-probe.ts' 로 재측정·델타 검토 후 '--write'로 baseline 갱신.\n`,
    );
    return;
  }

  const live = new Map((await runProbes()).map((r) => [r.id, keyOf(r)]));
  const base = new Map(baseline.cases.map((c) => [c.id, keyOf(c)]));

  const drift: string[] = [];
  for (const id of new Set([...base.keys(), ...live.keys()])) {
    const b = base.get(id);
    const l = live.get(id);
    if (b === undefined) {
      drift.push(`${id}: baseline에 없는 새 케이스 → [${l}] (baseline --write 필요)`);
    } else if (l === undefined) {
      drift.push(`${id}: baseline에만 있고 live에 없음 → [${b}]`);
    } else if (b !== l) {
      drift.push(`${id}: baseline=[${b}] → now=[${l}]`);
    }
  }

  if (drift.length > 0) {
    throw new Error(
      `Bun ${BUN_VERSION} wire 동작이 baseline과 달라졌다 — SPEC §1.1 가정·어댑터 책임 재평가 필요:\n  ` +
        drift.join('\n  '),
    );
  }

  expect(drift).toEqual([]);
});
