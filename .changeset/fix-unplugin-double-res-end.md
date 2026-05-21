---
'@ait-co/devtools': patch
---

Fix double `res.end()` in the unplugin dev-middleware POST handler. On the
invalid-JSON path the catch block already ended the response, then a trailing
`res.end()` ran again and threw `ERR_STREAM_WRITE_AFTER_END`. The success
response now ends inside its own branch so each path ends the response exactly
once.
