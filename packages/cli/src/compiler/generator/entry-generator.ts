export class EntryGenerator {
  generate(userMainImportPath: string, isDev: boolean): string {
    return `
await bootstrap();

async function bootstrap() {
  try {
    console.log("${isDev ? '🌟 Zipbul Server Starting (AOT)...' : '[Entry] Server Initializing...'}");

    const runtimeFileName = ${isDev ? "'./runtime.ts'" : "'./runtime.js'"};
    await import(runtimeFileName);

    console.log("[Entry] Loading Application Module...");

    await import("${userMainImportPath}");


  } catch (err) {
    throw err;
  }
}
`;
  }
}
