import { describe, it, expect } from 'bun:test';
import { DiagnosticCode } from '../../diagnostics';

describe('adapter diagnostic codes', () => {
  it('should map each named constant to its self-descriptive string value', () => {
    // Arrange
    const expected = [
      [DiagnosticCode.AdapterSpecNotCollected,            'ADAPTER_SPEC_NOT_COLLECTED'],
      [DiagnosticCode.AdapterInputUncollectable,          'ADAPTER_INPUT_UNCOLLECTABLE'],
      [DiagnosticCode.AdapterClassrefInvalid,             'ADAPTER_CLASSREF_INVALID'],
      [DiagnosticCode.AdapterPipelineTokenInvalid,        'ADAPTER_PIPELINE_TOKEN_INVALID'],
      [DiagnosticCode.AdapterPhaseIdInvalid,              'ADAPTER_PHASE_ID_INVALID'],
      [DiagnosticCode.AdapterPipelinePhaseOrderMismatch,  'ADAPTER_PIPELINE_PHASE_ORDER_MISMATCH'],
      [DiagnosticCode.AdapterMiddlewarePlacementInvalid,  'ADAPTER_MIDDLEWARE_PLACEMENT_INVALID'],
      [DiagnosticCode.AdapterExceptionFilterInvalid,      'ADAPTER_EXCEPTION_FILTER_INVALID'],
      [DiagnosticCode.AdapterEntryDecoratorInvalid,       'ADAPTER_ENTRY_DECORATOR_INVALID'],
      [DiagnosticCode.AdapterHandlerIdUnresolvable,       'ADAPTER_HANDLER_ID_UNRESOLVABLE'],
      [DiagnosticCode.AdapterMiddlewareErrorBypass,       'ADAPTER_MIDDLEWARE_ERROR_BYPASS'],
    ] as const;

    // Act & Assert
    for (const [actual, expected_value] of expected) {
      expect(actual).toBe(expected_value);
    }
  });

  it('should have 11 unique code values across all constants', () => {
    // Arrange
    const allValues = [
      DiagnosticCode.AdapterSpecNotCollected,
      DiagnosticCode.AdapterInputUncollectable,
      DiagnosticCode.AdapterClassrefInvalid,
      DiagnosticCode.AdapterPipelineTokenInvalid,
      DiagnosticCode.AdapterPhaseIdInvalid,
      DiagnosticCode.AdapterPipelinePhaseOrderMismatch,
      DiagnosticCode.AdapterMiddlewarePlacementInvalid,
      DiagnosticCode.AdapterExceptionFilterInvalid,
      DiagnosticCode.AdapterEntryDecoratorInvalid,
      DiagnosticCode.AdapterHandlerIdUnresolvable,
      DiagnosticCode.AdapterMiddlewareErrorBypass,
    ];

    // Assert — all unique
    expect(new Set(allValues).size).toBe(11);
  });
});
