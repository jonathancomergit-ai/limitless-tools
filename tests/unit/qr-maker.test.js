/* ============================================================
   QR Maker - unit tests
   Reed-Solomon against a known example, format and version
   bits, capacities, a known input's version and size, and the
   helpers (Wi-Fi strings, links, contrast, SVG, recent list).

   The encoder was also checked module-for-module against an
   independent library for every version 1-40 at every level.
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  encode, rsDivisor, rsRemainder, gfMul, formatBits, versionBits, byteCapacity, dataCodewords,
  dataCodewordsFor, alignmentPositions, rawDataModules, sizeOf, utf8, ECL
} from "../../items/qr-maker/qr.js";
import {
  wifiString, wifiEscape, linkFix, linkProblem, payload, contrast, scanCheck, toSvg, svgPath,
  pngScale, addRecent, cleanRecent, normalizeSettings, DEFAULTS, fileStem, MAX_RECENT
} from "../../items/qr-maker/codes.js";

/* ---- Reed-Solomon ------------------------------------------- */

test("Reed-Solomon codewords match the known HELLO WORLD 1-M example", () => {
  /* Data codewords for "HELLO WORLD" at 1-M, and the 10 error
     correction codewords every QR tutorial lists for them. */
  const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
  assert.deepEqual(rsRemainder(data, rsDivisor(10)), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
});

test("GF(256) multiply", () => {
  assert.equal(gfMul(0, 77), 0);
  assert.equal(gfMul(1, 77), 77);
  assert.equal(gfMul(2, 128), 0x1d);          // wraps round the 0x11D polynomial
  assert.equal(gfMul(3, 7), 9);
});

/* ---- format + version bits ---------------------------------- */

test("format bits are right (the standard's table)", () => {
  assert.equal(formatBits(ECL.L, 0).toString(2).padStart(15, "0"), "111011111000100");
  assert.equal(formatBits(ECL.M, 0).toString(2).padStart(15, "0"), "101010000010010");
  assert.equal(formatBits(ECL.Q, 0).toString(2).padStart(15, "0"), "011010101011111");
  assert.equal(formatBits(ECL.H, 0).toString(2).padStart(15, "0"), "001011010001001");
  assert.equal(formatBits(ECL.L, 4).toString(2).padStart(15, "0"), "110011000101111");
  assert.equal(formatBits(ECL.H, 7).toString(2).padStart(15, "0"), "000100000111011");
});

test("version bits are right", () => {
  assert.equal(versionBits(7).toString(2).padStart(18, "0"), "000111110010010100");
  assert.equal(versionBits(40).toString(2).padStart(18, "0"), "101000110001101001");
});

/* ---- sizes + capacity --------------------------------------- */

test("byte capacities match the standard", () => {
  const want = { 1: [17, 14, 11, 7], 2: [32, 26, 20, 14], 10: [271, 213, 151, 119], 40: [2953, 2331, 1663, 1273] };
  for (const [v, caps] of Object.entries(want)) {
    caps.forEach((cap, ecl) => assert.equal(byteCapacity(Number(v), ecl), cap, `version ${v}, level ${"LMQH"[ecl]}`));
  }
  assert.equal(dataCodewords(1, ECL.M), 16);
  assert.equal(rawDataModules(1), 208);
  assert.equal(rawDataModules(40), 29648);
});

test("alignment pattern positions", () => {
  assert.deepEqual(alignmentPositions(1), []);
  assert.deepEqual(alignmentPositions(2), [6, 18]);
  assert.deepEqual(alignmentPositions(7), [6, 22, 38]);
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138]);
  assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170]);
});

test("data codewords: mode, length, bytes, terminator, padding", () => {
  /* "hello" in byte mode at 1-M */
  assert.deepEqual(dataCodewordsFor(utf8("hello"), 1, ECL.M),
    [0x40, 0x56, 0x86, 0x56, 0xc6, 0xc6, 0xf0, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec, 0x11, 0xec]);
});

/* ---- whole codes -------------------------------------------- */

test("a known input gives the expected version and size", () => {
  const q = encode("https://example.com", { ecl: "M" });
  assert.equal(q.version, 2);
  assert.equal(q.size, 25);
  assert.equal(q.modules.length, 25);
  assert.ok(q.modules.every((row) => row.length === 25));
  assert.equal(q.bytes, 19);

  assert.equal(encode("a".repeat(17), { ecl: "L" }).version, 1);
  assert.equal(encode("a".repeat(18), { ecl: "L" }).version, 2);
  assert.equal(encode("a".repeat(2953), { ecl: "L" }).size, sizeOf(40));
});

test("fixed patterns are where they belong", () => {
  const { modules: m, size } = encode("test", { ecl: "Q", mask: 3 });
  /* finder corners dark, separators light */
  for (const [x, y] of [[0, 0], [6, 0], [0, 6], [size - 1, 0], [0, size - 1]]) { assert.equal(m[y][x], true); }
  assert.equal(m[7][7], false);
  /* timing line alternates; the dark module is dark */
  for (let i = 8; i < size - 8; i++) { assert.equal(m[6][i], i % 2 === 0); }
  assert.equal(m[size - 8][8], true);
  /* format bits read back say level Q, mask 3 */
  let bits = 0;
  for (let i = 0; i <= 5; i++) { bits |= (m[i][8] ? 1 : 0) << i; }
  bits |= (m[7][8] ? 1 : 0) << 6;
  bits |= (m[8][8] ? 1 : 0) << 7;
  bits |= (m[8][7] ? 1 : 0) << 8;
  for (let i = 9; i < 15; i++) { bits |= (m[8][14 - i] ? 1 : 0) << i; }
  assert.equal(bits, formatBits(ECL.Q, 3));
});

test("mask choice: forced, or the best of all 8", () => {
  for (let k = 0; k < 8; k++) { assert.equal(encode("mask", { mask: k }).mask, k); }
  const best = encode("mask");
  assert.ok(best.mask >= 0 && best.mask <= 7);
});

test("UTF-8 text and friendly errors", () => {
  assert.equal(encode("héllo ✓").bytes, 10);
  assert.throws(() => encode("x".repeat(3000), { ecl: "L" }), /Too long for a QR code: 3000 bytes/);
  assert.throws(() => encode("x", { ecl: "Z" }), /L, M, Q or H/);
  assert.throws(() => encode("x", { mask: 9 }), /Mask/);
});

/* ---- helpers ------------------------------------------------ */

test("Wi-Fi strings escape special characters", () => {
  assert.equal(wifiString({ ssid: "Home", password: "pa;ss", security: "WPA" }), String.raw`WIFI:T:WPA;S:Home;P:pa\;ss;;`);
  assert.equal(wifiString({ ssid: 'a"b:c', security: "nopass", hidden: true }), String.raw`WIFI:T:nopass;S:a\"b\:c;H:true;;`);
  assert.equal(wifiEscape(String.raw`x\y,z`), String.raw`x\\y\,z`);
});

test("links: https:// added to bare addresses, schemes left alone", () => {
  assert.equal(linkFix("example.com"), "https://example.com");
  assert.equal(linkFix("  http://a.b  "), "http://a.b");
  assert.equal(linkFix("mailto:me@example.com"), "mailto:me@example.com");
  assert.equal(linkFix(""), "");
  assert.match(linkProblem("https://exa mple.com"), /spaces/);
  assert.match(linkProblem("https://nodot"), /full web address/);
  assert.equal(linkProblem("https://example.com/x"), "");
});

test("payload is exactly what was typed (no redirect)", () => {
  assert.equal(payload({ type: "link", link: "shop.example/sale?x=1" }), "https://shop.example/sale?x=1");
  assert.equal(payload({ type: "text", text: " keep  spaces " }), " keep  spaces ");
  assert.equal(payload({ type: "wifi", ssid: "" }), "");
});

test("contrast + scan warnings", () => {
  assert.equal(Math.round(contrast("#000000", "#ffffff")), 21);
  assert.equal(scanCheck("#000000", "#ffffff").level, "ok");
  assert.equal(scanCheck("#777777", "#888888").level, "bad");
  assert.equal(scanCheck("#ffffff", "#000000").level, "warn");   // inverted
});

test("SVG: one path, runs merged, quiet zone in the viewBox", () => {
  const m = [[true, true, false], [false, true, false], [false, false, false]];
  assert.equal(svgPath(m, 1), "M1 1h2v1h-2zM2 2h1v1h-1z");
  const svg = toSvg(m, { border: 1, fg: "#112233", bg: "#fff" });
  assert.match(svg, /viewBox="0 0 5 5"/);
  assert.match(svg, /fill="#112233"/);
  assert.match(svg, /fill="#ffffff"/);
  assert.equal(pngScale(25, 4, 512).px % 33, 0);
});

test("recent list: newest first, no duplicates, never a Wi-Fi password", () => {
  let list = addRecent([], { type: "wifi", ssid: "Home", password: "secret", security: "WPA" });
  assert.equal(list[0].password, undefined);
  assert.ok(!JSON.stringify(list).includes("secret"));
  list = addRecent(list, { type: "link", link: "a.com" });
  list = addRecent(list, { type: "wifi", ssid: "Home", security: "WPA" });
  assert.deepEqual(list.map((r) => r.type), ["wifi", "link"]);
  for (let i = 0; i < 30; i++) { list = addRecent(list, { type: "text", text: String(i) }); }
  assert.equal(list.length, MAX_RECENT);
  assert.deepEqual(cleanRecent([{ type: "evil" }, null, "x"]), []);
});

test("settings are tidied; file names are safe", () => {
  assert.deepEqual(normalizeSettings({}), { ...DEFAULTS, recent: [] });
  const n = normalizeSettings({ ecl: "X", mask: 12, border: -1, size: 99999, fg: "red" });
  assert.equal(n.ecl, "M");
  assert.equal(n.mask, 7);
  assert.equal(n.border, 0);
  assert.equal(n.size, 2048);
  assert.equal(n.fg, "#000000");
  assert.equal(fileStem({ type: "link", link: "www.Example.com/a/b" }), "qr-example.com");
  assert.equal(fileStem({ type: "wifi", ssid: "My Wi-Fi!" }), "qr-wifi-my-wi-fi");
});
