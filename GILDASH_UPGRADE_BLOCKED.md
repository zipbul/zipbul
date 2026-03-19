# Gildash 업그레이드 — 외부 의존 차단 항목

> 작성일: 2026-03-19

현재 구현 불가하지만, 외부 의존(gildash/Bun)이 해소되면 즉시 착수 가능한 항목.

---

## 1. Fingerprint 시스템을 gildash 기반으로 교체

### 차단 조건

gildash `IndexResult`에 아래 2개 추가 필요:

- `changedSymbols[].isExported: boolean` — DB `SymbolRecord`에 이미 `isExported` 저장 중. 필드 노출만 필요.
- `changedRelations: { added, removed }` — re-export 변경 감지용. `CodeRelation(type: 're-exports')` 변경을 보고.

### 차단 해소 시 구현

`dev.command.ts` onIndexed 콜백에서:

1. `changedSymbols`에서 `isExported: true`인 변경만 필터
2. `changedRelations`에서 `type: 're-exports'` 변경 존재 확인
3. 둘 다 없으면 → 재파싱 + 리빌드 스킵
4. 하나라도 있으면 → 기존 플로우 (재파싱 + fingerprint 비교 + 리빌드)

현재 `computeStructuralFingerprint()` + `analyzeFile()` 재파싱 비용 ~670ms를 0ms로 줄일 수 있음.

### 주의사항

- `exportedValues`/`localValues` 변경은 gildash가 감지 못함 (spread bundle 해석용 AOT 전용 데이터). 이 경우는 기존 fingerprint 플로우로 fallback 필요.
- 완전 교체가 아닌 **fast path 추가**: gildash가 "변경 없음"을 확정할 수 있을 때만 스킵, 불확실하면 기존 경로.

### gildash 이슈

편지로 전달 완료 (요청 #1, #2).

---

## 2. useFactory 파라미터 타입 호환성 검증

### 차단 조건

gildash에 `isTypeAssignableTo()` API 노출 필요. gildash semantic 모드가 tsc `LanguageService`를 내부에 보유 중이나, 타입 호환성 검사 API가 미노출.

### 차단 해소 시 구현

`module-graph.ts` validateProviderImplementations 또는 별도 validateFactoryTypes에서:

```typescript
for (const provider of factoryProviders) {
  const factory = provider.useFactory;
  const injectTokens = provider.inject ?? [];

  for (let i = 0; i < injectTokens.length; i++) {
    const tokenFilePath = resolveTokenFilePath(injectTokens[i]);
    const paramFilePath = resolveFactoryFilePath(factory);

    const compatible = this.gildash.isTypeAssignableTo(
      injectTokens[i].name, tokenFilePath,
      factory.parameters[i].type, paramFilePath,
    );

    if (!compatible) {
      this.warnings.push(
        `Factory '${factory.name}': inject[${i}] token '${injectTokens[i].name}' ` +
        `is not assignable to parameter type '${factory.parameters[i].type}'`
      );
    }
  }
}
```

### 사용자 영향

DI useFactory에서 잘못된 타입의 서비스를 inject하면 런타임에 터짐. 이 검증이 있으면 빌드 타임에 차단.

### gildash 이슈

편지로 전달 완료 (요청 #4).

---

## 3. `RelationSearchQuery` 패턴 매칭

### 차단 조건

gildash `RelationSearchQuery`의 `srcFilePath`/`dstFilePath` 필드가 exact match only. glob/regex 패턴 매칭 필요.

### 차단 해소 시 구현

`module-graph.ts` 또는 별도 validatePackageBoundaries에서:

```typescript
const violations = this.gildash.searchRelations({
  type: 'imports',
  dstFilePathPattern: '**/packages/*/src/**',
});

for (const rel of violations) {
  const srcPkg = extractPackageName(rel.srcFilePath);
  const dstPkg = extractPackageName(rel.dstFilePath);
  if (srcPkg !== dstPkg) {
    this.warnings.push(
      `Deep import violation: ${rel.srcFilePath} → ${rel.dstFilePath}`
    );
  }
}
```

### 현재 우회

`searchAllRelations({ type: 'imports' })`로 전체 조회 후 수동 필터링 가능. 동작하지만 프로젝트 규모가 커지면 비효율적.

### gildash 이슈

편지로 전달 완료 (요청 #3).

---

## 4. Bun.build() Manual Chunks

### 차단 조건

Bun.build() API에 `manualChunks` 또는 chunk 경계 제어 옵션 없음. `splitting: boolean` 단순 on/off만 존재.

### Bun 이슈

[oven-sh/bun#26504](https://github.com/oven-sh/bun/issues/26504) — "add manual chunks" (2026-01-27, open, 메인테이너 응답 없음)

### 차단 해소 시 구현

AOT 컴파일러가 gildash `getImportGraph()`로 DI 모듈 경계를 분석하고, `manualChunks` 옵션에 모듈별 chunk 그룹핑을 전달:

```typescript
const importGraph = await ledger.getImportGraph();
const moduleChunks = computeModuleChunks(graph.modules, importGraph);

await Bun.build({
  entrypoints: [entryPointFile, runtimeFile, workerFile, runtimeMasterFile],
  outdir: outDir,
  splitting: true,
  manualChunks: moduleChunks,  // ← Bun이 지원하면
});
```

### 사용자 영향

대규모 앱에서 DI 모듈 경계에 맞춘 chunk splitting → lazy module loading 시 불필요한 코드 로딩 감소, cold start 최적화.

### 경쟁 도구 현황

- Rollup: `output.manualChunks` 지원
- Rolldown: `output.manualChunks` 지원
- esbuild: 미지원
- Bun: 미지원 (이슈 open)
