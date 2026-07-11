# 재구조 리뷰 중 발견된 기존 코드 버그 (정합 감사 단계에서 수정)
1. derive() 데이터 손실: rebuildOptions(helmet.ts:556-657)가 documentPolicy·documentPolicyReportOnly·requireDocumentPolicy를 재구성하지 않음 → derive 시 3옵션 소실. derive round-trip 골든 테스트로 고정 필요.
2. DIP-RO 값 미검증: options.ts VALID_DOC_ISO 검사가 enforce DIP에만 적용, documentIsolationPolicyReportOnly는 무검증 통과.
3. Document-Policy report-to 파라미터가 knownEndpoints 대조 없음 (STANDARDS §13.3.6, PLAN.md:1300).
4. DP report-to 파라미터를 sf-token으로 emit(document-policy/serialize.ts:64 `token(pv)`) — STANDARDS §13.3.6/§13.3.13은 UA가 **string일 때만** 엔드포인트 채택 → knownEndpoints 대조해도 리포팅 조용히 무력화. 스펙 테스트가 token을 기대해 STANDARDS와 어긋난 상태.
5. messageFormatter 미구현 — interfaces.ts:278 JSDoc은 'try/catch+English fallback+HelmetWarningReason.MessageFormatterFailed 방출'을 계약하나 helmet.ts/options.ts에 적용 코드 0건. 타입·계약은 확정, 구현만 없음.
6. sf-decimal 경계: serializeDecimal이 범위검사→반올림 순이라 `999999999999.9996`이 검사 통과 후 `1000000000000.0`(13자리)로 emit. 반올림 후 재검사 없음(structured-fields/serialize.ts:58-62).
7. (기지) Csp.InlineSpeculationRules 비-CSP3 키워드, 'none' keyword-source 타입 허용(§4.2.2), clear-site-data가 sf-string 직렬화기 재사용(§12.2.2는 RFC 7230 quoted-string).
