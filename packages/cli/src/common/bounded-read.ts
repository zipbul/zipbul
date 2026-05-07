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

      const chunkBytes = value.byteLength;

      if (bytes + chunkBytes <= maxBytes) {
        // Whole chunk fits — decode normally.
        collected += decoder.decode(value, { stream: true });
        bytes += chunkBytes;
        continue;
      }

      // Partial chunk fits — slice on a UTF-8 codepoint boundary so a
      // multi-byte character is never split. Walk back from the requested
      // byte count until we find a non-continuation byte (0x80-0xBF are
      // continuation bytes; anything else starts a fresh codepoint).
      const remaining = maxBytes - bytes;
      if (remaining > 0) {
        let cut = remaining;
        // Scan back at most 3 bytes (UTF-8 max trailing continuation count).
        while (cut > 0 && (value[cut] !== undefined && (value[cut]! & 0xc0) === 0x80) && (remaining - cut) < 4) {
          cut--;
        }
        const head = value.subarray(0, cut);
        // Use a fresh non-streaming decode — the head is now codepoint-
        // aligned, so we don't need to retain decoder state.
        collected += new TextDecoder().decode(head);
        bytes += cut;
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
