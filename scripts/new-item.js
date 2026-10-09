/* ============================================================
   New item, in one command

     npm run new-item -- <slug> "<Title>" --tags game,puzzle --blurb "One line."

   1. copies items/_template to items/<slug>
   2. puts the title into index.html, main.js, smoke.js, README.md
   3. adds an entry to items.json, dated today (or turns its
      "Coming soon" entry into a real one, keeping its blurb + tags)

   Then: build it, run `npm test`, look at the screenshots.
   Nothing is overwritten - it stops if the folder exists.
   ============================================================ */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkItem } from "../kit/items.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function fail(msg) {
  console.error(`\n  ${msg}\n\n  Usage: npm run new-item -- <slug> "<Title>" --tags a,b --blurb "One line."\n`);
  process.exit(1);
}

/* ---- read the arguments ---- */
const args = process.argv.slice(2);
const flags = {};
const plain = [];
for (let i = 0; i < args.length; i++) {
  if (args[i].startsWith("--")) { flags[args[i].slice(2)] = args[i + 1] ?? ""; i++; } else { plain.push(args[i]); }
}
const [slug, title] = plain;
if (!slug || !title) { fail("Need a slug and a title."); }

const entry = {
  slug,
  title,
  blurb: flags.blurb || `${title}. Describe it in one line.`,
  tags: (flags.tags || "new").split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
  added: new Date().toISOString().slice(0, 10)
};
const problems = checkItem(entry);
if (problems.length) { fail(problems.join("\n  ")); }

const from = path.join(ROOT, "items", "_template");
const to = path.join(ROOT, "items", slug);
if (fs.existsSync(to)) { fail(`items/${slug}/ already exists.`); }

const listPath = path.join(ROOT, "items.json");
const list = JSON.parse(fs.readFileSync(listPath, "utf8"));
/* A "soon" entry is the plan for this item: building it replaces it. */
const planned = list.findIndex((i) => i.slug === slug && i.soon);
if (planned === -1 && list.some((i) => i.slug === slug)) { fail(`${slug} is already in items.json.`); }
if (planned !== -1) {
  const plan = list.splice(planned, 1)[0];
  if (!flags.blurb) { entry.blurb = plan.blurb; }
  if (!flags.tags) { entry.tags = plan.tags; }
}

/* ---- 1 + 2. copy the template, fill in the title ---- */
fs.cpSync(from, to, { recursive: true });
for (const name of fs.readdirSync(to)) {
  const file = path.join(to, name);
  const text = fs.readFileSync(file, "utf8")
    .replaceAll("ITEM TITLE", title)
    .replaceAll("ONE LINE ABOUT THE ITEM.", entry.blurb)
    .replaceAll("`your-slug`", `\`${slug}\``)
    .replaceAll("YYYY-MM-DD", entry.added);
  fs.writeFileSync(file, text);
}

/* ---- 3. list it on the hub ---- */
list.push(entry);
fs.writeFileSync(listPath, JSON.stringify(list, null, 2) + "\n");

console.log(`
  Made items/${slug}/ and added it to items.json.

  Next:
    1. Build it in items/${slug}/main.js (search for TODO)
    2. Fill in items/${slug}/README.md and the blurb in items.json
    3. Update items/${slug}/smoke.js
    4. npm test
    5. Look at test-results/screens/${slug}-phone.png and -desktop.png
`);
