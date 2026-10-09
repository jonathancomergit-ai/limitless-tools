/* ============================================================
   Pixel Studio - palette presets (plain data, no DOM)

   PICO-8     the 16 colours of the PICO-8 fantasy console
   Game Boy   the 4 greens of the original Game Boy screen
   NES-ish    54 colours close to what the NES could show
              (one of the near-whites left out)
   ============================================================ */

export const PRESETS = {
  pico8: {
    name: "PICO-8",
    colors: [
      "#000000", "#1d2b53", "#7e2553", "#008751", "#ab5236", "#5f574f", "#c2c3c7", "#fff1e8",
      "#ff004d", "#ffa300", "#ffec27", "#00e436", "#29adff", "#83769c", "#ff77a8", "#ffccaa"
    ]
  },
  gameboy: {
    name: "Game Boy",
    colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"]
  },
  nes: {
    name: "NES-ish",
    colors: [
      "#7c7c7c", "#0000fc", "#0000bc", "#4428bc", "#940084", "#a80020", "#a81000", "#881400",
      "#503000", "#007800", "#006800", "#005800", "#004058", "#000000",
      "#bcbcbc", "#0078f8", "#0058f8", "#6844fc", "#d800cc", "#e40058", "#f83800", "#e45c10",
      "#ac7c00", "#00b800", "#00a800", "#00a844", "#008888",
      "#f8f8f8", "#3cbcfc", "#6888fc", "#9878f8", "#f878f8", "#f85898", "#f87858", "#fca044",
      "#f8b800", "#b8f818", "#58d854", "#58f898", "#00e8d8", "#787878",
      "#a4e4fc", "#b8b8f8", "#d8b8f8", "#f8b8f8", "#f8a4c0", "#f0d0b0", "#fce0a8", "#f8d878",
      "#d8f878", "#b8f8b8", "#b8f8d8", "#00fcfc", "#f8d8f8"
    ]
  }
};

export const PRESET_KEYS = Object.keys(PRESETS);
export const MAX_CUSTOM = 32;
