/**
 * Reads a `ReadableStream<Uint8Array>` (typically a child process's stderr
 * or stdout) into a string with a hard byte cap. Once `maxBytes` is
 * reached, subsequent chunks are dropped and a truncation marker is
 * appended. The reader keeps draining the stream so the writer doesn't
 * block on backpressure — the caller still gets the bounded prefix back.
 *
 * Used in build commands that capture child-process output for diagnostic
 * purposes: a runaway producer (gigabytes of compiler errors) must not be
 * able to OOM the parent through unbounded `await new Response(s).text()`.
 *
 * @public
 */
export async function readBoundedStream(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let collected = '';
  let bytes = 0;
  let truncated = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (truncated) continue;            // keep draining without storing

      const chunk = decoder.decode(value, { stream: true });
      const chunkBytes = value.byteLength;

      if (bytes + chunkBytes <= maxBytes) {
        collected += chunk;
        bytes += chunkBytes;
        continue;
      }

      // Partial chunk fits.
      const remaining = maxBytes - bytes;
      if (remaining > 0) {
        collected += chunk.slice(0, remaining);
        bytes += remaining;
      }
      truncated = true;
    }
  } finally {
    reader.releaseLock();
  }

  if (truncated) {
    collected += `\n...[output truncated at ${String(maxBytes)} bytes]`;
  }
  return collected;
}
