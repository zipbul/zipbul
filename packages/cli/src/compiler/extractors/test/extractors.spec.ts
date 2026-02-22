import { describe, it, expect } from 'bun:test';
import { parseSync } from 'oxc-parser';
import { join } from 'path';
import { ImportsExtractor } from '../imports.extractor';
import { ExtendsExtractor } from '../extends.extractor';
import { ImplementsExtractor } from '../implements.extractor';
import { CallsExtractor } from '../calls.extractor';

function getAst(code: string) {
  return parseSync('test.ts', code).program;
}

function getMeta(metaJson: string | undefined): Record<string, unknown> | null {
  if (!metaJson) {
    return null;
  }
  return JSON.parse(metaJson) as Record<string, unknown>;
}

describe('CodeRelationExtractors', () => {
  // Use a simulated file path inside current CWD to make relative paths predictable
  const filePath = join(process.cwd(), 'src', 'test.ts');
  const srcModuleKey = 'module:src/test.ts';

  describe('ImportsExtractor', () => {
    it('should extract relative imports', () => {
      const code = `import { foo } from './utils';`;
      const ast = getAst(code);
      const relations = ImportsExtractor.extract(ast, filePath);
      
      expect(relations).toHaveLength(1);
      expect(relations[0]!.type).toBe('imports');
      expect(relations[0]!.srcEntityKey).toBe(srcModuleKey);
      expect(relations[0]!.dstEntityKey).toBe(`module:src/utils.ts`);
    });

    it('should extract side-effect imports', () => {
      const code = `import './side-effect';`;
      const ast = getAst(code);
      const relations = ImportsExtractor.extract(ast, filePath);

      expect(relations).toHaveLength(1);
      expect(relations[0]!.dstEntityKey).toBe(`module:src/side-effect.ts`);
    });

    it('should include type-only imports with meta', () => {
      const code = `import type { Foo } from './types';`;
      const ast = getAst(code);
      const relations = ImportsExtractor.extract(ast, filePath);

      expect(relations).toHaveLength(1);
      expect(getMeta(relations[0]!.metaJson)).toEqual({ isType: true });
      expect(relations[0]!.dstEntityKey).toBe(`module:src/types.ts`);
    });

    it('should extract re-exports', () => {
      const code = `export * from './barrel';`;
      const ast = getAst(code);
      const relations = ImportsExtractor.extract(ast, filePath);
      
      expect(relations).toHaveLength(1);
      expect(relations[0]!.type).toBe('imports');
      expect(getMeta(relations[0]!.metaJson)).toEqual({ isReExport: true });
      expect(relations[0]!.dstEntityKey).toBe(`module:src/barrel.ts`);
    });

    it('should include type-only re-exports with meta', () => {
      const code = `export type { Foo } from './types';`;
      const ast = getAst(code);
      const relations = ImportsExtractor.extract(ast, filePath);

      expect(relations).toHaveLength(1);
      expect(getMeta(relations[0]!.metaJson)).toEqual({ isReExport: true, isType: true });
      expect(relations[0]!.dstEntityKey).toBe(`module:src/types.ts`);
    });

    it('should extract dynamic imports (best-effort)', () => {
      const code = `async function main() { await import('./dyn'); }`;
      const ast = getAst(code);
      const relations = ImportsExtractor.extract(ast, filePath);

      expect(relations).toHaveLength(1);
      expect(getMeta(relations[0]!.metaJson)).toEqual({ isDynamic: true });
      expect(relations[0]!.dstEntityKey).toBe(`module:src/dyn.ts`);
    });
  });

  describe('ExtendsExtractor', () => {
    it('should extract extends relation locally', () => {
      const code = `class Base {} class Derived extends Base {}`;
      const ast = getAst(code);
      const relations = ExtendsExtractor.extract(ast, filePath);
      
      expect(relations).toHaveLength(1);
      expect(relations[0]!.type).toBe('extends');
      expect(relations[0]!.srcEntityKey).toBe(`symbol:src/test.ts#Derived`);
      expect(relations[0]!.dstEntityKey).toBe(`symbol:src/test.ts#Base`);
      expect(getMeta(relations[0]!.metaJson)).toEqual({ isLocal: true });
    });

    it('should extract extends relation from import', () => {
        const code = `
        import { Base } from './base';
        class Derived extends Base {}
        `;
        const ast = getAst(code);
        const relations = ExtendsExtractor.extract(ast, filePath);
        
        expect(relations).toHaveLength(1);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/base.ts#Base`);
    });

    it('should extract extends relation from default import', () => {
        const code = `
        import Base from './base';
        class Derived extends Base {}
        `;
        const ast = getAst(code);
        const relations = ExtendsExtractor.extract(ast, filePath);
        
        expect(relations).toHaveLength(1);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/base.ts#default`);
    });

    it('should extract extends relation from namespace import member', () => {
      const code = `
        import * as NS from './base';
        class Derived extends NS.Base {}
      `;
      const ast = getAst(code);
      const relations = ExtendsExtractor.extract(ast, filePath);

      expect(relations).toHaveLength(1);
      expect(relations[0]!.dstEntityKey).toBe(`symbol:src/base.ts#Base`);
      expect(getMeta(relations[0]!.metaJson)).toEqual({ isNamespaceImport: true });
    });

    it('should extract extends relation for local member super class (best-effort)', () => {
      const code = `
        const NS = { Base: class {} };
        class Derived extends NS.Base {}
      `;
      const ast = getAst(code);
      const relations = ExtendsExtractor.extract(ast, filePath);

      expect(relations).toHaveLength(1);
      expect(relations[0]!.dstEntityKey).toBe(`symbol:src/test.ts#NS.Base`);
      expect(getMeta(relations[0]!.metaJson)).toEqual({ isLocal: true, isMember: true });
    });
  });

  describe('ImplementsExtractor', () => {
      it('should extract implements relation', () => {
          const code = `
          import { IFace } from './types';
          class Impl implements IFace {}
          `;
          const ast = getAst(code);
          const relations = ImplementsExtractor.extract(ast, filePath);

          expect(relations).toHaveLength(1);
          expect(relations[0]!.type).toBe('implements');
          expect(relations[0]!.srcEntityKey).toBe(`symbol:src/test.ts#Impl`);
          expect(relations[0]!.dstEntityKey).toBe(`symbol:src/types.ts#IFace`);
      });

      it('should extract implements relation from namespace import member', () => {
        const code = `
          import * as NS from './types';
          class Impl implements NS.IFace {}
        `;
        const ast = getAst(code);
        const relations = ImplementsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(1);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/types.ts#IFace`);
        expect(getMeta(relations[0]!.metaJson)).toEqual({ isNamespaceImport: true });
      });

      it('should extract implements relation for local member interface (best-effort)', () => {
        const code = `
          const NS = { IFace: class {} };
          class Impl implements NS.IFace {}
        `;
        const ast = getAst(code);
        const relations = ImplementsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(1);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/test.ts#NS.IFace`);
        expect(getMeta(relations[0]!.metaJson)).toEqual({ isLocal: true, isMember: true });
      });
  });

  describe('CallsExtractor', () => {
      it('should extract top-level calls as module calls', () => {
        const code = `
          import { util } from './utils';
          util();
        `;
        const ast = getAst(code);
        const relations = CallsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(1);
        expect(relations[0]!.type).toBe('calls');
        expect(relations[0]!.srcEntityKey).toBe(srcModuleKey);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/utils.ts#util`);
        expect(getMeta(relations[0]!.metaJson)).toEqual({ resolution: 'import', callee: 'util', scope: 'module' });
      });

      it('should extract direct calls inside function', () => {
          const code = `
          import { util } from './utils';
          function main() {
              util();
          }
          `;
          const ast = getAst(code);
          const relations = CallsExtractor.extract(ast, filePath);

          expect(relations).toHaveLength(1);
          expect(relations[0]!.type).toBe('calls');
          expect(relations[0]!.srcEntityKey).toBe(`symbol:src/test.ts#main`);
          expect(relations[0]!.dstEntityKey).toBe(`symbol:src/utils.ts#util`);
            expect(getMeta(relations[0]!.metaJson)).toEqual({ resolution: 'import', callee: 'util' });
      });

      it('should extract local calls inside function', () => {
        const code = `
        function local() {}
        function main() {
            local();
        }
        `;
        const ast = getAst(code);
        const relations = CallsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(1);
        expect(relations[0]!.srcEntityKey).toBe(`symbol:src/test.ts#main`);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/test.ts#local`);
        expect(getMeta(relations[0]!.metaJson)).toEqual({ resolution: 'local', callee: 'local' });
    });

      it('should extract calls inside arrow function assigned to variable', () => {
        const code = `
          import { util } from './utils';
          const main = () => {
            util();
          };
        `;
        const ast = getAst(code);
        const relations = CallsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(1);
        expect(relations[0]!.srcEntityKey).toBe(`symbol:src/test.ts#main`);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/utils.ts#util`);
      });

      it('should extract calls inside function expression assigned to variable', () => {
        const code = `
          import { util } from './utils';
          const main = function() {
            util();
          };
        `;
        const ast = getAst(code);
        const relations = CallsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(1);
        expect(relations[0]!.srcEntityKey).toBe(`symbol:src/test.ts#main`);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/utils.ts#util`);
      });

      it('should extract calls from class method bodies', () => {
        const code = `
          import { util } from './utils';
          class C {
            run() {
              util();
            }
          }
        `;
        const ast = getAst(code);
        const relations = CallsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(1);
        expect(relations[0]!.srcEntityKey).toBe(`symbol:src/test.ts#C.run`);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/utils.ts#util`);
      });

      it('should extract namespace member calls (import * as NS)', () => {
        const code = `
          import * as NS from './utils';
          function main() {
            NS.util();
          }
        `;
        const ast = getAst(code);
        const relations = CallsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(1);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/utils.ts#util`);
        expect(getMeta(relations[0]!.metaJson)).toEqual({ resolution: 'namespace', callee: 'NS.util' });
      });

      it('should extract local member calls (best-effort)', () => {
        const code = `
          function main() {
            obj.method();
          }
        `;
        const ast = getAst(code);
        const relations = CallsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(1);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/test.ts#obj.method`);
        expect(getMeta(relations[0]!.metaJson)).toEqual({ resolution: 'local-member', callee: 'obj.method' });
      });

      it('should extract this/super member calls (best-effort)', () => {
        const code = `
          class Base {
            base() {}
          }
          class C extends Base {
            run() {
              this.local();
              super.base();
            }
            local() {}
          }
        `;
        const ast = getAst(code);
        const relations = CallsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(2);

        const thisCall = relations.find((r) => r.dstEntityKey === 'symbol:src/test.ts#this.local');
        const superCall = relations.find((r) => r.dstEntityKey === 'symbol:src/test.ts#super.base');

        expect(thisCall).toBeTruthy();
        expect(superCall).toBeTruthy();
      });

      it('should track nested function scopes separately', () => {
        const code = `
          function local() {}
          function outer() {
            function inner() {
              local();
            }
            inner();
          }
        `;
        const ast = getAst(code);
        const relations = CallsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(2);

        const outerCallsInner = relations.find((r) => r.srcEntityKey === 'symbol:src/test.ts#outer' && r.dstEntityKey === 'symbol:src/test.ts#inner');
        const innerCallsLocal = relations.find((r) => r.srcEntityKey === 'symbol:src/test.ts#inner' && r.dstEntityKey === 'symbol:src/test.ts#local');

        expect(outerCallsInner).toBeTruthy();
        expect(innerCallsLocal).toBeTruthy();
      });

      it('should treat constructor calls as calls (NewExpression)', () => {
        const code = `
          import * as NS from './utils';
          function main() {
            new NS.Base();
          }
        `;
        const ast = getAst(code);
        const relations = CallsExtractor.extract(ast, filePath);

        expect(relations).toHaveLength(1);
        expect(relations[0]!.dstEntityKey).toBe(`symbol:src/utils.ts#Base`);
        expect(getMeta(relations[0]!.metaJson)).toEqual({ resolution: 'namespace', callee: 'NS.Base', isNew: true });
      });
  });

});
