import { compressionMiddleware, CompressionCodec } from '@zipbul/compression';
import { isErr } from '@zipbul/result';

// `compressionMiddleware` validates its options eagerly and returns a `Result` —
// narrow it here, then export the narrowed value as a fresh `const` so the exported
// type is the concrete `MiddlewareDefinition` (control-flow narrowing on the original
// binding does not cross the module boundary), and the AOT compiler can serialize it
// as an imported symbol in the module's middleware list.
const result = compressionMiddleware({
  encodings: [CompressionCodec.Br, CompressionCodec.Gzip],
  threshold: 1024,
});
if (isErr(result)) {
  throw new Error(result.data.message);
}

export const compression = result;
