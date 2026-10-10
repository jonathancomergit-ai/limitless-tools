/* ============================================================
   File Converter - odd keys stay plain data
   A column, key or tag called "__proto__" must come through
   as a normal key, not vanish (or change the object's type).
   ============================================================ */

import { test } from "node:test";
import assert from "node:assert/strict";
import { rowsToObjects, parseCSV } from "../../items/file-converter/csv.js";
import { parseYAML } from "../../items/file-converter/yaml.js";
import { parseXML, xmlToValue } from "../../items/file-converter/xml.js";
import { convertText } from "../../items/file-converter/convert.js";

const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

test("CSV: a __proto__ column survives to JSON, YAML, XML and back", () => {
  const csv = "__proto__,name\r\n1,Ada\r\n2,Bo\r\n";
  const [first] = rowsToObjects(parseCSV(csv));
  assert.ok(own(first, "__proto__"));
  assert.equal(first.__proto__, 1);
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.deepEqual(Object.keys(first), ["__proto__", "name"]);

  const json = convertText(csv, "csv", "json").text;
  assert.match(json, /"__proto__": 1/);
  assert.deepEqual(JSON.parse(json).map((o) => Object.keys(o)), [["__proto__", "name"], ["__proto__", "name"]]);
  assert.equal(convertText(csv, "csv", "csv").text, csv);
  assert.equal(convertText(convertText(csv, "csv", "yaml").text, "yaml", "csv").text, csv);
  assert.match(convertText(csv, "csv", "xml").text, /<__proto__>1<\/__proto__>/);
});

test("YAML: __proto__ keys (block and flow) are kept as data", () => {
  const v = parseYAML("__proto__: 1\nb: {__proto__: 2, c: 3}\n");
  assert.ok(own(v, "__proto__"));
  assert.equal(v.__proto__, 1);
  assert.ok(own(v.b, "__proto__"));
  assert.equal(v.b.__proto__, 2);
  assert.equal(JSON.stringify(v), '{"__proto__":1,"b":{"__proto__":2,"c":3}}');
  assert.equal(Object.getPrototypeOf(v), Object.prototype);
});

test("XML: a <__proto__> element and attribute are kept as data", () => {
  const v = xmlToValue(parseXML('<r __proto__="a"><__proto__>x</__proto__><n>1</n></r>'));
  assert.ok(own(v.r, "__proto__"));
  assert.equal(v.r.__proto__, "x");
  assert.equal(v.r["@__proto__"], "a");
  assert.equal(JSON.stringify(v), '{"r":{"@__proto__":"a","__proto__":"x","n":1}}');
  const back = convertText(JSON.stringify(v), "json", "xml").text;
  assert.match(back, /<r __proto__="a">/);
  assert.match(back, /<__proto__>x<\/__proto__>/);
});
