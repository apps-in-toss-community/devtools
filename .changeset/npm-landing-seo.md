---
"@ait-co/devtools": patch
---

docs(npm): add npm/license badges, expand keywords, refresh homepage

- README.md / README.en.md: add npm version + license badges below the
  lang toggle, move "Reference consumer" section below Install so first-
  paint shows the install command.
- package.json: extend `keywords` (`miniapp`, `simulator`, `testing`,
  `vite-plugin`, `webpack-plugin`) for better npm discovery; point
  `homepage` at https://devtools.aitc.dev/ instead of the npm page so
  the registry "homepage" link goes to the live demo.
