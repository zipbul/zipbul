import type { HttpResponse } from '../http-response';
import type { HttpContext } from '../http-context';
import { isAsyncIterable, formatSSEChunk } from '../server-sent-event';
import { isResponseBodyValue } from './type-guards';

const TEXT_ENCODER = new TextEncoder();

export async function writeSuccessResponse(res: HttpResponse, result: unknown, http: HttpContext): Promise<void> {
  const signal = http.request.signal;

  // AsyncIterable → SSE or raw streaming based on @Sse flag
  if (isAsyncIterable(result)) {
    const isSse = http.matchedRoute?.sse === true;
    const iterator = result[Symbol.asyncIterator]();
    const stream = new ReadableStream({
      async pull(controller) {
        if (signal.aborted) {
          controller.close();
          return;
        }

        try {
          const { done, value } = await iterator.next();
          if (done || signal.aborted) {
            controller.close();
            return;
          }

          if (isSse) {
            controller.enqueue(formatSSEChunk(value));
          } else {
            // Raw streaming — encode string chunks, pass Uint8Array through
            if (typeof value === 'string') {
              controller.enqueue(TEXT_ENCODER.encode(value));
            } else if (value instanceof Uint8Array) {
              controller.enqueue(value);
            } else {
              controller.enqueue(TEXT_ENCODER.encode(String(value)));
            }
          }
        } catch (error) {
          if (!signal.aborted) {
            controller.error(error);
          } else {
            controller.close();
          }
        }
      },
      async cancel() {
        try {
          await iterator.return?.();
        } catch { /* swallow — cleanup best-effort */ }
      },
    });

    if (isSse) {
      // Bun 공식 권장: SSE 는 idle timeout 을 비활성화한다.
      // 이벤트 간 간격이 idleTimeout 을 넘겨 연결이 끊기는 것을 방지.
      http.setTimeout(0);
      const sseResponse = new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        },
      });
      res.setNativeResponse(sseResponse);
    } else {
      // Raw streaming — Content-Type from @ContentType or imperative setContentType
      res.setNativeResponse(new Response(stream));
    }
    return;
  }

  // Native Response passthrough (handler-created Response)
  if (result instanceof Response) {
    res.setNativeResponse(result);
    return;
  }

  if (result === undefined || result === null) {
    return;
  }

  if (typeof result === 'bigint') {
    res.setBody(result.toString());
    return;
  }

  if (isResponseBodyValue(result)) {
    res.setBody(result);
  }
}
