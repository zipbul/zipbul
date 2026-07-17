# @zipbul/conditional-request

## Definition

The conditional-request middleware is a stage in the HTTP request/response pipeline that evaluates the precondition headers carried on an incoming request (`If-Match`, `If-None-Match`, `If-Modified-Since`, `If-Unmodified-Since`) per RFC 9110 §13, deciding one of three outcomes: continue, 304 (Not Modified), or 412 (Precondition Failed). It is evaluate-only.

Validator (ETag/Last-Modified) generation, If-Range/Range/206 byte serving, and cache storage (RFC 9111) are out of scope. The normative rulebook is `STANDARDS.md`.
