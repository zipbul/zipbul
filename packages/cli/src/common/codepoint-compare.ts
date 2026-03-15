export function compareCodePoint(strA: string, strB: string): number {
  if (strA === strB) {
    return 0;
  }

  if (strA < strB) {
    return -1;
  }

  return 1;
}
