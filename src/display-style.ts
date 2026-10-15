export const DISPLAY_BASE_CSS = `
  * { box-sizing: border-box; }
  :root { --ink: #000; --paper: #fff; }
  html, body { width: 800px; height: 480px; margin: 0; overflow: hidden; }
  body {
    color: var(--ink);
    background: var(--paper);
    font-family: "Arial Narrow", Arial, Helvetica, sans-serif;
  }
  .label {
    font-size: 12px;
    font-weight: 900;
    letter-spacing: .11em;
    line-height: 1;
    text-transform: uppercase;
  }
  .serif {
    font-family: Georgia, "Times New Roman", serif;
    font-style: italic;
    font-weight: 700;
    letter-spacing: -.035em;
  }
  .number {
    font-stretch: condensed;
    font-variant-numeric: tabular-nums;
    font-weight: 900;
    letter-spacing: -.055em;
  }
  .inverted { color: var(--paper); background: var(--ink); }
`;
