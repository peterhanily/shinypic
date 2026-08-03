export const DEMOS = Object.freeze([
  Object.freeze({
    id: "city",
    title: "Neon rain",
    short: "Street lights",
    source: "./assets/demos/neon-rain.jpg",
    fileName: "neon-rain-demo.jpg",
    alt: "A rain-slick blue-hour city street with small cyan and amber lights",
    recipe: "clean",
    selection: "lights",
    amount: 0.84,
    area: 0.24,
    bloom: 0.38,
    color: "#ffffff",
    colorName: "Pearl",
  }),
  Object.freeze({
    id: "crystal",
    title: "Cut crystal",
    short: "Tiny glints",
    source: "./assets/demos/crystal-light.jpg",
    fileName: "cut-crystal-demo.jpg",
    alt: "Cut crystal and reflective objects making small bright glints on a dark table",
    recipe: "sparkle",
    selection: "lights",
    amount: 0.96,
    area: 0.08,
    bloom: 0.14,
    color: "#ffffff",
    colorName: "Pearl",
  }),
  Object.freeze({
    id: "iris",
    title: "Iris after rain",
    short: "Colour play",
    source: "./assets/demos/iris-after-rain.jpg",
    fileName: "iris-after-rain-demo.jpg",
    alt: "A deep violet iris with reflective raindrops against a dark garden",
    recipe: "neon",
    selection: "lights",
    amount: 0.88,
    area: 0.18,
    bloom: 0.42,
    color: "#ff79d9",
    colorName: "Pink",
  }),
  Object.freeze({
    id: "chainlink",
    title: "The original idea",
    short: "Chainlink study",
    source: "./assets/demos/chainlink-case-study.svg",
    fileName: "chainlink-case-study.svg",
    alt: "The white Chainlink symbol centered on an official blue background",
    recipe: "sparkle",
    selection: "lights",
    amount: 0.98,
    area: 0.12,
    bloom: 0.08,
    color: "#ffffff",
    colorName: "Pearl",
    caseStudy: true,
  }),
]);

export function demoById(id) {
  return DEMOS.find((demo) => demo.id === id) || null;
}

export function resolvedDemoUrl(demo, embeddedAssets = globalThis.__SHINYPIC_ASSETS__ || {}) {
  return embeddedAssets.demoUrls?.[demo.id] || demo.source;
}
