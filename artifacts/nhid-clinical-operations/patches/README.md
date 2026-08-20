# Patches

`wouter@3.7.1.patch` is **not applied in this repository.**

It is Manus editor tooling: it makes `<Switch>` publish its route paths to
`window.__WOUTER_ROUTES__` so the Manus preview pane can enumerate routes. It
has no effect on application behaviour.

It is kept here only so the package can be round-tripped back into Manus. It is
deliberately not wired into `pnpm-workspace.yaml`, because `patchedDependencies`
is honoured only at the workspace root and would therefore also patch
`artifacts/nhid-saas`, which does not want it.

To re-enable it inside Manus, restore this block to the package's
`package.json`:

```json
"pnpm": {
  "patchedDependencies": { "wouter@3.7.1": "patches/wouter@3.7.1.patch" }
}
```
