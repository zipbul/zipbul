import { describe, expect, it } from 'bun:test';

import { ImportRegistry } from './import-registry';

describe('ImportRegistry', () => {
  it('should be deterministic when insertion order differs', () => {
    // Arrange
    const registry1 = new ImportRegistry('/out');

    registry1.getAlias('BClass', './b.ts');
    registry1.getAlias('AClass', './a.ts');
    registry1.getAlias('CClass', '@zipbul/core');

    const registry2 = new ImportRegistry('/out');

    registry2.getAlias('CClass', '@zipbul/core');
    registry2.getAlias('AClass', './a.ts');
    registry2.getAlias('BClass', './b.ts');

    // Act
    const statements1 = registry1.getImportStatements();
    const statements2 = registry2.getImportStatements();

    // Assert
    expect(statements1).toEqual(statements2);
  });

  it('should sort imports when entries are registered', () => {
    // Arrange
    const registry = new ImportRegistry('/out');

    registry.getAlias('BClass', './b.ts');
    registry.getAlias('AClass', './a.ts');
    registry.getAlias('CoreThing', '@zipbul/core');

    // Act
    const statements = registry.getImportStatements();

    // Assert
    expect(statements).toEqual([
      'import { AClass } from "./a.ts";',
      'import { BClass } from "./b.ts";',
      'import { CoreThing } from "@zipbul/core";',
    ]);
  });
});
