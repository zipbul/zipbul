# @zipbul/cookie — Standards conformance baseline

**Date:** 2026-06-07 (supersedes 2026-06-04)
**Spec pin:** RFC 6265bis **draft-22** (`draft-ietf-httpbis-rfc6265bis-22`, 2025-12-01 —
current latest; obsoletes RFC 6265 once published; still a DRAFT) × RFC 9110 (token, IMF-fixdate).
**Method:** Primary text extracted **verbatim from three independent renderings** of bis-22
(datatracker HTML / ietf.org archive HTML / ietf.org archive TXT) and cross-checked
character-for-character — they agree exactly. Bun 1.3.14 behavior **first-hand measured**
this round (not inherited). Code read file:line. Two independent conformance reviewers +
two adversarial skeptics. Every row verified, not assumed.

**Change log vs the 2026-06-04 edition:**
- **D2 RETRACTED** — Expires output is conformant; the prior "lenient Date.parse" finding was wrong (§4).
- **D3 REFRAMED** — the raw (pre-encoding) name+value measurement is *closer* to the spec wording, not "the wrong quantity"; the real point is that 4096 is a UA rule mirrored as a server throw (§4, §6).
- **path-value ABNF corrected** — was citing the obsolete RFC 6265 grammar; bis-22 is `*av-octet` (§2).
- **SameSite=None⇒Secure reclassified** — UA storage rule we defensively mirror, NOT a server MUST (§6).
- **GCM invocation counter added as over-design (O1)** — cited per-key bound applied per-process (§5).
- **Inbound NAME percent-decode now MEASURED** — resolves the §8 vs D5 contradiction (§3, §8).

---

## 1. Standards — split by layer (parser baseline vs crypto extension)

A cookie **parser/serializer** has one normative baseline. The **sign/encrypt features are an
extension** — RFC 6265bis §4.1.1 explicitly states "the semantics of the cookie-value are not
defined" and servers "SHOULD encode" arbitrary data (e.g. base64). So crypto standards are NOT
parser-conformance requirements; they govern only the optional sign/encrypt layer.

### 1a. Parser/serializer baseline (MUST follow)
| Standard | Role |
|---|---|
| RFC 6265bis-22 | Current cookie spec; obsoletes RFC 6265. name/value grammar, Set-Cookie, prefixes, 4096, Max-Age, SameSite |
| RFC 6265 (2011) | Predecessor; superseded by bis (do not cite for grammar — see D-history) |
| RFC 9110 §5.6.2 | `token` / `tchar` — imported by bis for cookie-name (**`%` IS a tchar**) |
| RFC 9110 §5.6.7 | `IMF-fixdate` — imported by bis for `sane-cookie-date` (Expires) |

### 1b. Crypto EXTENSION (only if sign/encrypt used — NOT parser baseline)
| Standard | Role |
|---|---|
| RFC 2104 / FIPS 198-1 | HMAC (used in sign/unsign) |
| RFC 5869 | HKDF key derivation (kdfSalt ≥16 bytes per §3.1) |
| NIST SP 800-38D | AES-GCM (96-bit IV; the ~2^32 bound is **per key, total** — see O1) |
| RFC 4648 | base64url (signature / ciphertext encoding) |

---

## 2. Primary-source ABNF (verbatim, triple-source cross-checked against bis-22)

- `cookie-name = token` (§4.1.1)
- `cookie-value = *cookie-octet / ( DQUOTE *cookie-octet DQUOTE )`
- `cookie-octet = %x21 / %x23-2B / %x2D-3A / %x3C-5B / %x5D-7E` — excludes CTLs, whitespace, DQUOTE, comma, semicolon, backslash
- `token = 1*tchar` ; `tchar = "!" / "#" / "$" / "%" / "&" / "'" / "*" / "+" / "-" / "." / "^" / "_" / "`" / "|" / "~" / DIGIT / ALPHA` (RFC 9110 §5.6.2) — **`%` IS a valid tchar** (verbatim-confirmed); delimiters NOT allowed: `"(),/:;<=>?@[\]{}"`
- `max-age-av = "Max-Age" BWS "=" BWS non-zero-digit *DIGIT` ; `non-zero-digit = %x31-39` → **sender MUST NOT emit 0, negative, or leading-`-`** (the grammar cannot derive them). The UA parse step (§5.5) separately maps delta-seconds ≤ 0 to earliest-expiry — that's a UA deletion mechanism, NOT a sender license to emit `Max-Age=0`.
- `expires-av = "Expires" BWS "=" BWS sane-cookie-date` ; `sane-cookie-date = <IMF-fixdate, RFC 9110 §5.6.7>` ; `IMF-fixdate` ends in a 2-DIGIT day and literal `GMT`.
- `path-av = "Path" BWS "=" BWS path-value` ; **`path-value = *av-octet`** ; **`av-octet = %x20-3A / %x3C-7E`** ("any CHAR except CTLs or `;`"). → **No leading-`/` requirement** in the grammar; av-octet's complement = `[\x00-\x1F\x3B\x7F]`.
- 4096-octet limit: **the sum of the lengths of cookie-name + cookie-value** (the `=` and attributes are NOT counted). Appears in the UA storage algorithm in **both** §5.6 (set-cookie-string receipt) and §5.7 (stored-cookie) — confirmed in two of the three sources.
- `cookie-av = expires-av / max-age-av / domain-av / path-av / secure-av / httponly-av / samesite-av / extension-av` ; `extension-av = 1*av-octet`. **Partitioned and Priority are `extension-av`, NOT core attributes** — bis-22 has no `partitioned-av` or `priority-av` production.

### Prefix case (resolved — correct, keep)
- §4.1.3.1/§4.1.3.2 (**server** prose): servers use a **case-sensitive** match for `__Secure-`/`__Host-`.
- §5.4 (normative **UA** rule): "UAs MUST match the prefix string case-insensitively."
- **Conclusion:** a UA applies the prefix invariants to any casing (`__HOST-Foo`), so a server guard MUST also be case-insensitive to avoid emitting a cookie the UA will silently drop. Our `toLowerCase()` guard (cookie-parser.ts) is **correct** — it adopts the UA §5.4 posture, which is stricter than the literal §4.1.3 server rule but strictly safer. Keep.

---

## 3. Boundary — what Bun guarantees vs what we must do (FIRST-HAND MEASURED, Bun 1.3.14, 2026-06-07)

| Concern | Bun measured | Verdict | Our code |
|---|---|---|---|
| cookie-VALUE excluded octets (`;`,`,`,`"`,`\`,SP,non-ASCII…) | `x;y,z`→`x%3By%2Cz`, `é`→`%C3%A9`, `x y`→`x%20y` — **all percent-encoded** | Bun guarantees | MUST NOT re-validate value octets — duplication |
| cookie-NAME `;`/`=`/SP/empty | Bun **rejects** (`a b`→throws) | Bun guarantees | covered (belt+braces ok) |
| cookie-NAME non-tchar `,()/@{}[]` | Bun **ACCEPTS** (`a,b`→`a,b=v`) | **Bun GAP** (not RFC token) | our `INVALID_TOKEN_CHARS` rejects them → justified, keep |
| Max-Age 0 / negative | Bun **emits as-is** (`Max-Age=0`, `Max-Age=-5`) | **Bun GAP** | `assertValidMaxAge` only checks `Number.isInteger` → **DEFECT (D1)** |
| Max-Age float (1.5) | Bun emits as-is | Bun GAP | already caught by `Number.isInteger` → ok |
| Expires output format | Bun emits non-IMF (`Wed, 1 Jan 2030 00:00:00 -0000`) | **Bun GAP** | serialize() rewrites via `toUTCString()` → `Wed, 01 Jan 2030 00:00:00 GMT` (IMF-fixdate) → **correct** |
| Inbound parse percent-DECODE — VALUE | `%3B%2C`→`;,`, `%C3%A9`→`é` | Bun behavior | round-trips our encoded output; raw external `%XX` is decoded → **document (R2)** |
| Inbound parse percent-DECODE — **NAME** | **`a%2Cb`→`a,b`, `%C3%A9`→`é`, `n%41`→`nA`** | Bun behavior | **measured this round** — justifies excluding `%` from names (D5) |
| Inbound duplicate name | **first wins** (`a=1;a=2;a=3`→`1`) | implementation-defined (RFC undefined for servers) | jar relies on Bun's first-wins; Bun-version-sensitive → pin a test, don't advertise as guaranteed |
| SameSite unspecified | Bun **emits `SameSite=Lax`** always | Bun default | our default (null) still yields `SameSite=Lax` on the wire → **document (R3)** |

---

## 4. DEFECTS / non-conformance (the standard decides; follow the ABNF)

**D1. Max-Age 0/negative emitted — CONFIRMED VIOLATION.** `max-age-av = non-zero-digit *DIGIT`
cannot derive `0`, `-5`, or a leading `-`. `assertValidMaxAge` (cookie-parser.ts:695) checks only
`Number.isInteger`, so `Max-Age=0`/`-1` reach the wire (measured: Bun emits them verbatim). This is a
**generation-grammar** non-conformance, distinct from §5.5 UA *parsing* leniency (which is what makes
deletion-by-Max-Age work in practice in every browser). **Consequence:** `cookie-jar.delete()`
(cookie-jar.ts:138-142) sets `maxAge:0` **and** `expires:new Date(0)`, so every deletion line
currently emits a grammar-violating `Max-Age=0` *redundantly* alongside a conformant past-Expires.
The standard's deletion mechanism is a **past Expires** alone. Tests currently LOCK the violation
(`cookie-parser.spec.ts:1159` asserts `Max-Age=0`; several jar specs do too) — those asserts would
flip if D1 is fixed.

**D4. Path `/`-prefix enforcement is over-restrictive (over-design).** `assertValidPath`
(cookie-parser.ts:753-758) rejects non-empty paths not starting with `/`. `path-value = *av-octet`
has no such rule, and unlike the 4096 case the rejected output is **spec-legal and deliverable** (a
UA stores and path-matches it). The leading-`/` idea comes from UA default-path/path-match semantics
(§5.1.4), not the generation grammar. The CTL/`;`/DEL rejection in the same function DOES conform
(it is exactly av-octet's complement). Fix: drop the `/`-prefix check, keep the CTL/`;` rejection.
(`__Host-` Path=/ stays enforced separately in `validatePrefix` — orthogonal.)

**D5. `%` excluded from cookie-name — deliberate, now fully justified by measurement.**
`INVALID_TOKEN_CHARS` (cookie-parser.ts:26) excludes `%`, although `%` IS a valid RFC 9110 tchar — so
this is stricter than the token grammar. Rationale is **MEASURED this round**: Bun percent-decodes
inbound cookie **names** (`a%2Cb`→`a,b`, `%C3%A9`→`é`, **`n%41`→`nA`**). A name containing `%` would
therefore NOT round-trip (write `n%41`, read `nA`). Excluding `%` from emitted names guarantees
write/read name stability. Verdict: **keep — a documented, intentional deviation from pure RFC 9110
token (recorded, not silent).**

**D6. Partitioned & Priority lack a cited basis.** Both are `extension-av`, NOT bis-22 core
(re-confirmed against bis-22: no `partitioned-av`/`priority-av` production). Cite their own standards:
Partitioned → CHIPS draft (draft-cutler-httpbis-partitioned-cookies); Priority → its Google draft.
Doc/code comments must not imply 6265bis mandates them. (Emission is already correct extension-av;
no behavioral change. `Partitioned`/`Priority=High` are valid `1*av-octet`.)

### Retracted (NOT defects)
- **D2 (Expires) — RETRACTED.** serialize() (cookie-parser.ts:286-301) always re-emits Expires via
  `new Date(target.expires).toUTCString()`, which is guaranteed IMF-fixdate (2-digit day + `GMT`).
  Bun's non-IMF output never reaches the wire. `assertValidExpires` is only an **input-finiteness**
  gate; a loosely-formatted input string cannot leak a non-IMF date because it is re-canonicalized at
  serialize time. **Output conforms.** (Prior edition wrongly called this a live defect.) Cosmetic
  only: the code comment cites RFC 7231 §7.1.1.1 — the predecessor of RFC 9110 §5.6.7, same
  IMF-fixdate definition; update the citation, no behavior change.
- **D3 (4096 measurement) — REFRAMED, not a defect.** `assertNameValueSize` (cookie-parser.ts:669)
  sums raw (pre-encoding) name+value. The spec sums "the lengths of cookie-name and cookie-value",
  which are wire productions, so a *wire-byte* count is the faithful reading; the raw count slightly
  **under**-counts (a value needing many `%XX` expansions can pass raw yet exceed 4096 on the wire).
  This is a leniency nuance, not "the wrong quantity". The real classification: 4096 is a **UA
  storage rule** (§5.6/§5.7) mirrored here as a **server-side hard throw** = stricter-than-spec /
  defensive fail-fast. Decision point, not a bug (see §6, R-decisions).
- **prefix case** — our case-insensitive guard matches the normative UA algorithm. Correct (§2).
- **cookie-value octet validation** — Bun fully encodes; first-party validation would be duplication.

---

## 5. Over-design & code↔doc items to reconcile

**O1. AES-GCM invocation counter is dead ceremony (NEW — adversarial finding).** `GCM_MAX_INVOCATIONS
= 2**32` with the per-process in-memory `encryptCounters` (cookie-parser.ts:23,175,408-416) cannot
enforce the bound that actually matters. NIST SP 800-38D's ~2^32 figure is **per key, total** — but
this counter is **per-process**, resets on restart, and is not shared across replicas (the code
comment admits this). In any real multi-worker/autoscaling deployment the fleet-wide total is
invisible to it; in a single process the 2^32 branch is practically unreachable before restart. So it
"simulates protection it cannot deliver" and does not even match the standard it cites. The honest
control is operator key-rotation on a schedule. **Decision:** remove the ceiling/exhaustion
machinery (keep `onEncrypt` for telemetry if wanted), OR keep but stop citing it as a NIST-bound
safeguard.

**R1. Secret entropy gate — out-of-baseline, decision pending.** `options.ts:54` rejects secrets
below a Shannon-entropy threshold (128 bits), citing OWASP/NIST SP 800-131A — standards NOT in the
parser baseline, and Shannon-over-byte-histogram ≠ min-entropy (a weak proxy, which the code itself
disclaims). The adversarial review found it **defensible** (a low-false-positive guard on a feature
the package legitimately owns: 32 random bytes / any base64/hex of a real key clears it; only
genuinely low-variety inputs are rejected), but a `≥32-byte` length floor alone would also be
defensible. **Decision:** keep the gate (and justify as crypto-input hygiene, not cookie
conformance) OR drop to length-floor-only. Doc and code must then agree.

**R2. Inbound percent-decode.** Bun decodes name AND value on parse (measured). README must state:
values/names are percent-encoded on write, decoded on read; our own round-trip is sound.

**R3. SameSite default emit.** Unspecified sameSite still emits `SameSite=Lax` (Bun default).
Document the actual wire output; don't imply "no SameSite attribute".

**R4. Middleware flush-swallow (from session-3 review, still open).** `beforeResponse`
(middleware.ts:93-98) swallows all serialize errors so one bad cookie doesn't break the whole
response, while standalone `getSetCookieHeaders()` still throws. **Decision:** keep the
contain-at-boundary + loud-standalone split (current), OR move to per-cookie isolation
(`allSettled`) so good cookies still flush when one is bad.

---

## 6. Scope — per feature (precise), with the server-vs-UA distinction made explicit

**Key framing:** almost every MUST/SHOULD in RFC 6265bis is addressed to the **User Agent**. The only
genuinely server-directed normative text is §4.1 (the grammar a server SHOULD produce) and §4.1.3
(prefixes). Everything else we enforce is a **defensive mirror** of a UA storage rule — we enforce it
so our cookies actually get stored, not because the spec commands a server to. The table labels each.

| Feature | Classification | Basis |
|---|---|---|
| Serialize → Set-Cookie (outbound) | **server MUST (emit grammar)** | bis §4.1.1; one Set-Cookie per cookie, no folding (RFC 9110 §5.3) |
| Parse inbound Cookie header (CookieMap) | **server parser** | server sees cookie-pairs only, no attributes — must NOT infer attributes on read |
| cookie-name token validation | **server MUST (emit)** + Bun-gap backfill | RFC 9110 token; Bun accepts non-tchar, we don't |
| cookie-name `%` exclusion | **intentional deviation (stricter)** | round-trip safety vs Bun name-decode (D5) |
| Max-Age non-zero-digit | **server MUST (emit)** | §4.1.1 — currently violated (D1) |
| Expires = IMF-fixdate | **server MUST (emit)** — conforms | §4.1.1 + RFC 9110 §5.6.7 via toUTCString |
| Path = *av-octet (CTL/`;` reject only) | **server MUST (emit)** — `/`-prefix part is over-design (D4) | §4.1.1 |
| 4096 name+value | **defensive mirror of UA rule (stricter throw)** | §5.6/§5.7 UA storage; we fail-fast instead of silent UA-drop |
| `__Secure-`/`__Host-` prefixes | **server-directed (§4.1.3)** + UA-case mirror (§5.4) | enforced incl. case-insensitive — correct |
| SameSite=None ⇒ Secure | **defensive mirror of UA rule (NOT a server MUST)** | §5.7 storage step: UA ignores None-without-Secure; we refuse to emit it |
| Partitioned ⇒ Secure | **defensive mirror (CHIPS draft, extension)** | not bis core; emitted as extension-av |
| Partitioned / Priority attributes | **in-scope EXTENSION (extension-av)** | CHIPS draft / Priority draft — NOT bis core |
| sign / unsign (HMAC) | **in-scope EXTENSION** | bis leaves cookie-value semantics undefined |
| encrypt / decrypt (AES-GCM) | **in-scope EXTENSION** | same |
| CookieJar (queue outbound) | **in-scope** server abstraction | queuing Set-Cookie is server-side |
| middleware (two-phase) | **in-scope** framework glue | duty: emit separate Set-Cookie lines |

### OUT of scope (UA / client concerns — bis §5.x)
PSL / public-suffix rejection · domain-match & path-match on send · SameSite enforcement on send ·
Cookie-header ordering/sorting · client storage & eviction · Secure-cookie overlay protection ·
HttpOnly non-HTTP-API enforcement · non-secure-origin rejection of Secure cookies · third-party
cookie policy · real secure-channel determination (we only detect `https:` from the request URL —
`secure:'auto'` is detection, not a trusted-channel guarantee; ignores proxy headers).

---

## 7. Non-RFC invented limits

- `MAX_NAME_VALUE_OCTETS = 4096` — RFC-grounded value, applied as a server throw on raw bytes (D3 reframe / decision).
- `MAX_ATTRIBUTE_OCTETS = 1024` — bis mentions a 1024 attribute-value cap; ok.
- `MAX_HEADER_OCTETS = 8190` — NOT an RFC limit (bis notes ~8192 implementation defaults). Operational cap, measured on the **fully serialized header** (wire-accurate) — document.
- secret `≥32 bytes`, entropy gate, GCM counter — see R1 / O1.

---

## 8. Verification status (cross-checked 2026-06-07)

**Spec ground truth — triple-source verbatim agreement (no small-model drift):** bis-22 ABNF
identical across datatracker / ietf-archive-html / ietf-txt; RFC 9110 token (`%`=tchar) and
IMF-fixdate confirmed.

**Bun behavior — FIRST-HAND measured this round** (resolves the prior §8↔D5 contradiction): inbound
cookie-NAME percent-decode is **real** (`a%2Cb`→`a,b`, `%C3%A9`→`é`, `n%41`→`nA`), so D5 is justified
and the prior "not yet measured" note is retired. Also measured: value-decode, Max-Age as-is, non-IMF
Expires, first-wins duplicate, default `SameSite=Lax`.

**Behaviorally VERIFIED OK (now need a *locked regression test*, not investigation):**
- HKDF sync(sign)/async(unsign) byte-parity (sha256/384/512) → pin.
- AES-GCM round-trip + AAD name-binding; cross-name decrypt rejected → pin.
- HMAC name-binding; cross-name unsign rejected → pin.
- Inbound duplicate-name first-wins (Bun-version-sensitive, RFC-undefined for servers) → pin, do NOT advertise as guaranteed.

**Still open:**
- Each RFC MUST/SHOULD ↔ a locking test (1:1 map; find blanks) — coverage audit not yet done.
  (100% line/func coverage ≠ every normative rule is pinned.)
- The §5 / R-decisions (4096 measurement, entropy gate, GCM counter, flush isolation) before patching.
