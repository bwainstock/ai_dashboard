# Ticket #49: four-gray rendering acceptance

Daily Brief and Calendar View share one native-scale rendering pipeline. Browser
screenshots are quantized without spatial dithering to exact luminance values
`0`, `85`, `170`, and `255`.
`shared/four-gray-contract.mjs` is the single palette, dimension, opacity, and
quantization source used by Worker rendering and Node acceptance scripts.

Automated coverage verifies:

- deterministic nearest-level conversion of representative antialiased edge
  values;
- opaque neutral 800x480 PNGs within the configured byte limit;
- rejection of a fifth gray, RGB color, alpha, wrong dimensions, overflow,
  unreadable text, and oversized output;
- validation before atomic publication and again before authenticated image
  delivery;
- explicit Daily Brief and Calendar View identity, one shared generation, and
  per-view ETag revalidation;
- unchanged private delivery, source fallback, and prior-generation retention.

Run the focused checks:

```sh
npx vitest run \
  test/epaper-rendering.test.ts \
  test/png-contract.test.ts \
  test/render-validation.test.ts \
  test/generation.test.ts \
  test/worker.test.ts \
  test/device-acceptance.test.mjs \
  test/gmail-privacy.test.ts
```

Then run the repository-standard full check:

```sh
npm run check
```
