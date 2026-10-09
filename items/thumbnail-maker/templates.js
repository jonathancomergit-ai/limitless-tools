/* ============================================================
   Thumbnail Maker - starter templates (plain data)

   Each one is a whole layout, drawn for YouTube (1280 x 720).
   On another size it is moved there with resizeLayout().
   Your picture is never part of a template: if you have one,
   it is kept, at the bottom of the stack.
   ============================================================ */

const T = (text, x, y, size, more = {}) => ({
  kind: "text", text, x, y, size, rot: 0, font: "grotesk",
  fill: "#FFFFFF", outline: 14, outlineColor: "#000000", shadow: true, glow: false, glowColor: "#FF2D78",
  ...more
});
const S = (shape, x, y, size, more = {}) => ({ kind: "sticker", shape, x, y, size, rot: 0, shadow: true, ...more });

export const TEMPLATES = Object.freeze([
  {
    id: "reveal",
    name: "Big reveal",
    layout: {
      size: "youtube",
      bg: { type: "gradient", c1: "#2A0A5E", c2: "#FF2D78", angle: 135 },
      layers: [
        S("ring", 950, 330, 360, { color: "#FF2D2D", shadow: false }),
        T("YOU WON'T\nBELIEVE THIS", 430, 330, 128, { fill: "#FFE13C", outline: 16, rot: -4 }),
        S("arrow", 740, 560, 150, { rot: -20 }),
        S("shocked", 1120, 600, 170, { rot: 8 })
      ]
    }
  },
  {
    id: "top10",
    name: "Top 10",
    layout: {
      size: "youtube",
      bg: { type: "gradient", c1: "#0B1033", c2: "#05050A", angle: 180 },
      layers: [
        T("TOP 10", 420, 290, 250, { fill: "#FFE13C", outline: 18, glow: true, glowColor: "#FF7A1A", rot: -3 }),
        T("GADGETS OF 2026", 430, 520, 92, { outline: 12 }),
        S("fire", 1000, 330, 300, { rot: 6 }),
        S("star", 1160, 120, 130, { rot: 12 }),
        S("star", 820, 110, 90, { rot: -10 })
      ]
    }
  },
  {
    id: "tutorial",
    name: "Tutorial",
    layout: {
      size: "youtube",
      bg: { type: "solid", c1: "#0E7C86", c2: "#35D6F5", angle: 90 },
      layers: [
        T("HOW TO", 330, 180, 110, { font: "mono", fill: "#0B0C13", outline: 0, shadow: false }),
        T("MAKE IT IN\n5 MINUTES", 420, 420, 132, { outline: 14 }),
        S("check", 1060, 300, 260, { rot: -8 }),
        S("burst", 1110, 590, 190, { color: "#FFE13C", rot: 10 })
      ]
    }
  },
  {
    id: "reaction",
    name: "Reaction",
    layout: {
      size: "youtube",
      bg: { type: "gradient", c1: "#FF3B1F", c2: "#FFC93C", angle: 60 },
      layers: [
        S("shocked", 940, 360, 470, { rot: -6 }),
        T("NO WAY!", 380, 330, 190, { outline: 18, rot: 6, fill: "#FFFFFF" }),
        S("fire", 140, 600, 160, { rot: -10 }),
        S("ring", 600, 590, 150, { color: "#FFFFFF", shadow: false })
      ]
    }
  },
  {
    id: "versus",
    name: "Versus",
    layout: {
      size: "youtube",
      bg: { type: "gradient", c1: "#1E5BFF", c2: "#FF2D2D", angle: 90 },
      layers: [
        T("CATS", 300, 360, 150, { outline: 16 }),
        T("DOGS", 980, 360, 150, { outline: 16 }),
        T("VS", 640, 360, 200, { fill: "#FFE13C", outline: 18, glow: true, glowColor: "#FFFFFF", rot: -8 }),
        S("check", 300, 580, 150),
        S("cross", 980, 580, 150)
      ]
    }
  },
  {
    id: "hook",
    name: "Shorts hook",
    layout: {
      size: "youtube",
      bg: { type: "gradient", c1: "#111111", c2: "#3A1C71", angle: 160 },
      layers: [
        T("WAIT FOR IT…", 640, 150, 120, { fill: "#FFFFFF", outline: 14, glow: true, glowColor: "#35D6F5" }),
        S("arrow", 640, 360, 170, { rot: 90, color: "#35D6F5" }),
        S("shocked", 470, 560, 200, { rot: -10 }),
        S("heart", 820, 560, 190, { rot: 10 })
      ]
    }
  }
]);

export function templateById(id) { return TEMPLATES.find((t) => t.id === id) || null; }
