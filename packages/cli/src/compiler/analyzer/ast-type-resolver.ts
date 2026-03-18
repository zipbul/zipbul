import type { AnalyzerProgram, AnalyzerValue, AnalyzerValueRecord, NodeRecord, TypeInfo } from './types';

import { isAnalyzerValueArray } from './type-guards';

const isRecordCandidate = (value: AnalyzerValue): value is AnalyzerValueRecord | AnalyzerProgram => {
  return typeof value === 'object' && value !== null && !isAnalyzerValueArray(value);
};

export class AstTypeResolver {
  resolve(typeNode: AnalyzerValue): TypeInfo {
    const node = this.asNode(typeNode);

    if (!node) {
      return { typeName: 'any' };
    }

    if (node.type === 'TSTypeReference') {
      const typeName = this.extractEntityName(node.typeName);
      const typeArgs: string[] = [];
      const typeArguments = this.asNode(node.typeArguments);
      const params = typeArguments ? this.getArray(typeArguments, 'params') : [];

      for (const param of params) {
        const resolved = this.resolve(param);

        typeArgs.push(resolved.typeName);
      }

      const info: TypeInfo = { typeName };

      if (typeArgs.length > 0) {
        info.typeArgs = typeArgs;
      }

      return info;
    }

    if (node.type === 'TSArrayType') {
      const elementType = this.resolve(node.elementType);

      return {
        typeName: 'Array',
        typeArgs: [elementType.typeName],
        isArray: true,
        items: elementType,
      };
    }

    if (node.type === 'TSStringKeyword') {
      return { typeName: 'string' };
    }

    if (node.type === 'TSNumberKeyword') {
      return { typeName: 'number' };
    }

    if (node.type === 'TSBooleanKeyword') {
      return { typeName: 'boolean' };
    }

    if (node.type === 'TSVoidKeyword') {
      return { typeName: 'void' };
    }

    if (node.type === 'TSAnyKeyword') {
      return { typeName: 'any' };
    }

    if (node.type === 'TSLiteralType') {
      const literal = this.getRecord(node.literal);
      const value = literal ? literal.value : undefined;

      if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
        return { typeName: 'any' };
      }

      return {
        typeName: typeof value,
        literals: [value],
      };
    }

    if (node.type === 'TSUnionType') {
      const typeNodes = this.getArray(node, 'types');
      const types = typeNodes.map(t => this.resolve(t));
      const allLiterals = types.length > 0 && types.every(t => Array.isArray(t.literals) && t.literals.length > 0);

      if (allLiterals) {
        const firstType = types[0];

        if (!firstType) {
          return { typeName: 'any' };
        }

        return {
          typeName: firstType.typeName,
          isUnion: true,
          literals: types.flatMap((t: TypeInfo) => t.literals ?? []),
        };
      }

      const valid = types.find(t => t.typeName !== 'null' && t.typeName !== 'undefined' && t.typeName !== 'void');

      return {
        typeName: valid ? valid.typeName : 'any',
        isUnion: true,
        unionTypes: types,
      };
    }

    return { typeName: 'any' };
  }

  private extractEntityName(nodeValue: AnalyzerValue): string {
    const node = this.asNode(nodeValue);

    if (!node) {
      return 'unknown';
    }

    if (node.type === 'Identifier') {
      return this.getString(node, 'name') ?? 'unknown';
    }

    if (node.type === 'TSQualifiedName') {
      const left = this.extractEntityName(node.left);
      const rightNode = this.asNode(node.right);
      const right = rightNode ? this.getString(rightNode, 'name') : null;

      if (right === null || right.length === 0) {
        return 'unknown';
      }

      return `${left}.${right}`;
    }

    return 'unknown';
  }

  private asNode(value: AnalyzerValue): NodeRecord | null {
    const record = this.getRecord(value);

    if (record === null) {
      return null;
    }

    const type = record.type;

    if (typeof type !== 'string') {
      return null;
    }

    return { ...record, type };
  }

  private getRecord(value: AnalyzerValue): AnalyzerValueRecord | null {
    if (!isRecordCandidate(value)) {
      return null;
    }

    if (this.isProgram(value)) {
      return null;
    }

    return value;
  }

  private isProgram(value: AnalyzerValueRecord | AnalyzerProgram): value is AnalyzerProgram {
    const typeValue = value.type;

    return typeof typeValue === 'string' && typeValue === 'Program';
  }

  private getString(node: AnalyzerValueRecord, key: string): string | null {
    const value = node[key];

    if (typeof value !== 'string') {
      return null;
    }

    return value;
  }

  private getArray(node: AnalyzerValueRecord, key: string): AnalyzerValue[] {
    const value = node[key];

    if (!isAnalyzerValueArray(value)) {
      return [];
    }

    return value;
  }
}
