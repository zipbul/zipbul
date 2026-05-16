export async function writeIfChanged(path: string, content: string): Promise<boolean> {
  const file = Bun.file(path);

  if (await file.exists()) {
    const existing = await file.text();

    if (existing === content) {
      return false;
    }
  }

  await Bun.write(path, content);

  return true;
}
