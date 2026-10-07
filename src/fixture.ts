export function fixtureHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=800,height=480,initial-scale=1">
  <style>
    * { box-sizing: border-box; }
    html, body { width: 800px; height: 480px; margin: 0; overflow: hidden; }
    body {
      background: #fff;
      color: #000;
      font-family: Arial, Helvetica, sans-serif;
      padding: 34px 42px;
    }
    header { display: flex; align-items: center; gap: 22px; border-bottom: 4px solid #000; padding-bottom: 22px; }
    svg { width: 94px; height: 94px; flex: none; }
    h1 { font-size: 52px; line-height: 1; margin: 0 0 10px; }
    header p { font-size: 24px; margin: 0; }
    main { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; padding-top: 26px; }
    section { border: 3px solid #000; border-radius: 10px; min-height: 205px; padding: 22px; }
    h2 { font-size: 29px; margin: 0 0 15px; }
    section p { font-size: 23px; line-height: 1.35; margin: 8px 0; }
    .strong { font-weight: 700; }
  </style>
</head>
<body>
  <header>
    <svg viewBox="0 0 96 96" role="img" aria-label="House">
      <path d="M8 45 48 10l40 35v43H60V60H36v28H8Z" fill="none" stroke="#000" stroke-width="8" stroke-linejoin="round"/>
    </svg>
    <div>
      <h1>Family Dashboard</h1>
      <p>Private BYOS display path verified</p>
    </div>
  </header>
  <main>
    <section>
      <h2>Daily Brief fixture</h2>
      <p class="strong">800 × 480 monochrome PNG</p>
      <p>Bundled icon and text only.</p>
    </section>
    <section>
      <h2>Physical check</h2>
      <p>Confirm orientation, readability, caching, and wake-button behavior.</p>
    </section>
  </main>
</body>
</html>`;
}
