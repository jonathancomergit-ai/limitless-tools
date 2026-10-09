/* Runs once before the Playwright suite: clear old screenshots,
   so a deleted or renamed item never leaves a stale picture. */

import fs from "node:fs";
import { SCREENS } from "./helpers.js";

export default function globalSetup() {
  fs.rmSync(SCREENS, { recursive: true, force: true });
  fs.mkdirSync(SCREENS, { recursive: true });
}
