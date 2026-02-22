import type { Program } from 'oxc-parser';
import type { CodeRelation, CodeRelationExtractor } from '../interfaces';
import { getModuleEntityKey, getStringLiteralValue, resolveRelativeImport, visit } from './utils';

export const ImportsExtractor: CodeRelationExtractor = {
  name: 'imports',
  extract(ast: Program, filePath: string): CodeRelation[] {
    const relations: CodeRelation[] = [];
    const srcKey = getModuleEntityKey(filePath);

    // Imports include static imports/re-exports and dynamic imports (best-effort).
    
    for (const stmt of ast.body) {
      if (stmt.type === 'ImportDeclaration') {
        const source = (stmt as any).source?.value;
        const importKind = (stmt as any).importKind;
        const isType = importKind === 'type';

        const resolvedPath = resolveRelativeImport(filePath, source);
        
        if (resolvedPath) {
          const dstKey = getModuleEntityKey(resolvedPath);
          const relation: CodeRelation = {
            type: 'imports',
            srcEntityKey: srcKey,
            dstEntityKey: dstKey,
          };
          if (isType) {
            relation.metaJson = JSON.stringify({ isType: true });
          }
          relations.push(relation);
        }
      } else if (stmt.type === 'ExportAllDeclaration') {
        const source = (stmt as any).source?.value;
        const exportKind = (stmt as any).exportKind;
        const isType = exportKind === 'type';

        const resolvedPath = resolveRelativeImport(filePath, source);
        if (resolvedPath) {
          const dstKey = getModuleEntityKey(resolvedPath);
          relations.push({
            type: 'imports',
            srcEntityKey: srcKey,
            dstEntityKey: dstKey,
            metaJson: JSON.stringify({ isReExport: true, ...(isType ? { isType: true } : {}) })
          });
        }
      } else if (stmt.type === 'ExportNamedDeclaration') {
        const source = (stmt as any).source?.value;
        if (source) {
           const exportKind = (stmt as any).exportKind;
           const isType = exportKind === 'type';
           const resolvedPath = resolveRelativeImport(filePath, source);
           if (resolvedPath) {
             const dstKey = getModuleEntityKey(resolvedPath);
             relations.push({
               type: 'imports', // Re-export from source
               srcEntityKey: srcKey,
               dstEntityKey: dstKey,
               metaJson: JSON.stringify({ isReExport: true, ...(isType ? { isType: true } : {}) })
             });
           }
        }
      }
    }

    // Dynamic imports: import('./x')
    visit(ast, (node) => {
      if (node?.type !== 'ImportExpression') {
        return;
      }

      const source = getStringLiteralValue(node.source);
      if (typeof source !== 'string') {
        return;
      }

      const resolvedPath = resolveRelativeImport(filePath, source);
      if (!resolvedPath) {
        return;
      }

      relations.push({
        type: 'imports',
        srcEntityKey: srcKey,
        dstEntityKey: getModuleEntityKey(resolvedPath),
        metaJson: JSON.stringify({ isDynamic: true }),
      });
    });

    return relations;
  }
};
