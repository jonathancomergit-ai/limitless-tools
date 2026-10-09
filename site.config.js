/* ============================================================
   Limitless Lab - wing settings

   The ONE file in the kit that is different in each repo.
   Everything in kit/ reads its wing name, emoji and colour
   from here, so kit/ itself can stay identical everywhere.

   To set up a repo, change the four lines marked  <-- here.

   The three wings:
     wing: "arcade"    name: "Arcade"    emoji: "🎮"  accent: "hot"
     wing: "lab"       name: "Lab"       emoji: "🔬"  accent: "cyan"
     wing: "workshop"  name: "Workshop"  emoji: "🧰"  accent: "amber"
   ============================================================ */

export default {
  brand: "Limitless Lab",

  /* Short id. Also the save namespace, so never rename it once
     the site is live - everybody's saves would vanish. */
  wing: "workshop",                                          // <-- here

  name: "Workshop",                                          // <-- here
  emoji: "🧰",                                             // <-- here

  /* hot (pink) | cyan | amber. All three pass WCAG AA on the
     dark surfaces, as text and as a button with dark text. */
  accent: "amber",                                           // <-- here

  /* One line under the big title on the hub. */
  tagline: "Free tools for devs, creators and makers. Your files never leave your device.",

  /* Where "Limitless Lab" in the header points. */
  home: { label: "jonjoe1001.dev", url: "https://jonjoe1001.dev/" },

  /* Cross-links in the hub footer. Each wing is its own repo,
     published by GitHub Pages under jonjoe1001.dev/<repo>/.
     A null url is simply not shown. */
  wings: [
    { wing: "arcade",   name: "Arcade",   emoji: "🎮", url: "https://jonjoe1001.dev/limitless-arcade/" },
    { wing: "lab",      name: "Lab",      emoji: "🔬", url: "https://jonjoe1001.dev/limitless-lab/" },
    { wing: "workshop", name: "Workshop", emoji: "🧰", url: "https://jonjoe1001.dev/limitless-tools/" }
  ]
};
