// images.test.js
import { test, expect } from "bun:test";
import { readdirSync } from "fs";
import { join } from "path";

const IMAGES_DIR = join(import.meta.dir, "site", "images");

// Phone photos carry EXIF (camera, capture time, GPS location) and every file here is
// served publicly, so no image may carry EXIF at all. Strip it, keeping the colour profile:
//   exiftool -all= -tagsfromfile @ -icc_profile -overwrite_original <file>
// EXIF is tagged "Exif" in JPEG APP1 and AVIF items, "EXIF" in WebP, "eXIf" in PNG.
test("site images carry no EXIF metadata", async () => {
  const withExif = [];
  for (const name of readdirSync(IMAGES_DIR)) {
    if (!/\.(jpe?g|webp|avif|png)$/i.test(name)) continue;
    const bytes = Buffer.from(await Bun.file(join(IMAGES_DIR, name)).arrayBuffer());
    if (["Exif", "EXIF", "eXIf"].some((tag) => bytes.includes(tag))) withExif.push(name);
  }
  expect(withExif).toEqual([]);
});
