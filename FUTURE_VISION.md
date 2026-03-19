# Future Vision — 외부 의존 대기

---

## Bun.build() Manual Chunks

Bun.build() API에 `manualChunks` 또는 chunk 경계 제어 옵션이 추가되면 착수.

### Bun 이슈

[oven-sh/bun#26504](https://github.com/oven-sh/bun/issues/26504) — "add manual chunks" (2026-01-27, open, 메인테이너 응답 없음)

### 구현 계획

AOT 컴파일러가 gildash `getImportGraph()`로 DI 모듈 경계를 분석하고, `manualChunks` 옵션에 모듈별 chunk 그룹핑을 전달:

```typescript
const importGraph = await ledger.getImportGraph();
const moduleChunks = computeModuleChunks(graph.modules, importGraph);

await Bun.build({
  entrypoints: [entryPointFile, runtimeFile, workerFile, runtimeMasterFile],
  outdir: outDir,
  splitting: true,
  manualChunks: moduleChunks,
});
```

### 사용자 영향

대규모 앱에서 DI 모듈 경계에 맞춘 chunk splitting → lazy module loading 시 불필요한 코드 로딩 감소, cold start 최적화.

### 경쟁 도구 현황

- Rollup: `output.manualChunks` 지원
- Rolldown: `output.manualChunks` 지원
- esbuild: 미지원
- Bun: 미지원 (이슈 open)
