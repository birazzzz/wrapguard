// Builds docs/demo.svg, the animated terminal at the top of the README.
// It replays a real `wrapguard check` run against fynepdf.com after the hero's last
// sentence was lengthened (see the README). Run: node docs/demo.mjs
import { writeFileSync } from "node:fs";

const DURATION = 12; // seconds per loop
const FONT = 13;
const CHAR = 7.8; // fixed character width; textLength keeps every font on this grid
const LINE = 20;
const PAD = 20;
const TOP = 44; // below the title bar
const COLUMNS = 88;

const colors = {
  bg: "#0d1117",
  border: "#30363d",
  text: "#c9d1d9",
  dim: "#8b949e",
  red: "#f85149",
  green: "#3fb950",
  bold: "#f0f6fc",
};

const command = "npx wrapguard check";
const scanning = [
  "Scanning 1/4  / @ 1440px",
  "Scanning 2/4  / @ 1024px",
  "Scanning 3/4  / @ 768px",
  "Scanning 4/4  / @ 390px",
];
// [text, color] runs per line, exactly as the CLI prints them (colors included).
const output = [
  [["Checked 1 page at 4 widths, 188 text elements.", "dim"]],
  [],
  [["/", "bold"]],
  [["  main > section > p  ", "text"], ['"Edit by hand or prompt, review with 15 specialist agents an…"', "dim"]],
  [["    768px 1 → ", "text"], ["2", "red"], ["  ·  ", "dim"], ["390px 2 → ", "text"], ["3", "red"], [" lines", "dim"]],
  [],
  [["Also 1 new, 0 gone, 0 with new copy at the same line count (--verbose lists them).", "dim"]],
  [["✗ 1 piece of text now wraps differently on 1 page.", "red"]],
  [["  If that's intended, run: wrapguard update", "dim"]],
];

const timeline = {
  typeStart: 0.5,
  typeEnd: 1.9,
  scanStart: 2.2,
  scanStep: 0.35,
  outputStep: 0.12,
  hideAt: DURATION - 0.6,
};
timeline.outputStart = timeline.scanStart + scanning.length * timeline.scanStep + 0.1;

const width = PAD * 2 + COLUMNS * CHAR;
const height = TOP + LINE * (output.length + 1) + PAD;
const pct = (seconds) => ((seconds / DURATION) * 100).toFixed(2);
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const y = (row) => TOP + LINE * row + FONT;

const styles = [];
let id = 0;
/** Visible from `start` to `end` seconds of each loop. */
function shown(start, end) {
  const name = `k${id++}`;
  styles.push(
    `@keyframes ${name} { 0%, ${pct(start)}% { opacity: 0 } ${pct(start + 0.01)}%, ${pct(end)}% { opacity: 1 } ${pct(end + 0.01)}%, 100% { opacity: 0 } }`,
    `.${name} { animation: ${name} ${DURATION}s infinite; }`,
  );
  return name;
}

function textLine(runs, row, className) {
  const content = runs.map(([text, color]) => `<tspan fill="${colors[color]}"${color === "bold" ? ' font-weight="700"' : ""}>${escape(text)}</tspan>`).join("");
  const length = runs.reduce((sum, [text]) => sum + [...text].length, 0);
  if (!length) return "";
  return `<text class="${className}" x="${PAD}" y="${y(row)}" textLength="${(length * CHAR).toFixed(1)}" lengthAdjust="spacing">${content}</text>`;
}

const body = [];

// Prompt and command, revealed by a cover that steps right one character at a time.
const commandX = PAD + 2 * CHAR;
const commandWidth = command.length * CHAR;
body.push(`<text x="${PAD}" y="${y(0)}"><tspan fill="${colors.green}">$</tspan></text>`);
body.push(
  `<text x="${commandX}" y="${y(0)}" fill="${colors.text}" textLength="${commandWidth.toFixed(1)}" lengthAdjust="spacing">${command}</text>`,
);
styles.push(
  `@keyframes type { 0%, ${pct(timeline.typeStart)}% { transform: translateX(0); animation-timing-function: steps(${command.length}, end) } ${pct(timeline.typeEnd)}%, 100% { transform: translateX(${commandWidth.toFixed(1)}px) } }`,
  `.typer { animation: type ${DURATION}s infinite; }`,
);
const cursor = shown(0, timeline.scanStart - 0.05);
body.push(
  `<g class="typer"><rect x="${commandX}" y="${y(0) - FONT}" width="${(commandWidth + CHAR * 2).toFixed(1)}" height="${LINE}" fill="${colors.bg}"/>` +
    `<rect class="${cursor}" x="${commandX}" y="${y(0) - FONT + 1}" width="${CHAR}" height="${FONT + 3}" fill="${colors.text}"/></g>`,
);

// Progress, one frame per width, on the line below the command.
scanning.forEach((frame, index) => {
  const start = timeline.scanStart + index * timeline.scanStep;
  body.push(textLine([[frame, "dim"]], 1, `${shown(start, start + timeline.scanStep - 0.01)} scan`));
});

// The report, a line at a time.
output.forEach((runs, index) => {
  const line = textLine(runs, index + 1, shown(timeline.outputStart + index * timeline.outputStep, timeline.hideAt));
  if (line) body.push(line);
});

const plain = [`$ ${command}`, ...output.map((runs) => runs.map(([text]) => text).join(""))].join("\n");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title desc">
<title id="title">wrapguard check catching a line that now wraps</title>
<desc id="desc">${escape(plain)}</desc>
<style>
text { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace; font-size: ${FONT}px; white-space: pre; }
${styles.join("\n")}
@media (prefers-reduced-motion: reduce) {
  [class] { animation: none !important; opacity: 1 !important; }
  .typer, .scan { display: none; }
}
</style>
<rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="10" fill="${colors.bg}" stroke="${colors.border}"/>
<circle cx="20" cy="18" r="6" fill="#ff5f56"/><circle cx="40" cy="18" r="6" fill="#ffbd2e"/><circle cx="60" cy="18" r="6" fill="#27c93f"/>
<text x="${width / 2}" y="22" fill="${colors.dim}" text-anchor="middle" style="font-size:12px">wrapguard check · fynepdf.com</text>
${body.join("\n")}
</svg>
`;

writeFileSync(new URL("./demo.svg", import.meta.url), svg);
console.log(`docs/demo.svg: ${width.toFixed(0)}×${height}px, ${(svg.length / 1024).toFixed(1)} KB`);
