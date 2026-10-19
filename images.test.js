// images.test.js
import { test, expect } from "bun:test";
import { readdirSync } from "fs";
import { join } from "path";

const IMAGES_DIR = join(import.meta.dir, "site", "images");

// Phone photos carry EXIF and XMP (camera, capture time, GPS location) and every file here
// is served publicly, so no image may carry either. Strip both, keeping the colour profile:
//   exiftool -all= -tagsfromfile @ -icc_profile -overwrite_original <file>
// EXIF is tagged "Exif" in JPEG APP1 and AVIF items, "EXIF" in WebP, "eXIf" in PNG.
// XMP (which can hold exif:GPSLatitude on its own) always opens an "xmpmeta" packet.
const METADATA_TAGS = ["Exif", "EXIF", "eXIf", "xmpmeta"];

test("site images carry no EXIF or XMP metadata", async () => {
  const withMetadata = [];
  for (const name of readdirSync(IMAGES_DIR)) {
    if (!/\.(jpe?g|webp|avif|png)$/i.test(name)) continue;
    const bytes = Buffer.from(await Bun.file(join(IMAGES_DIR, name)).arrayBuffer());
    if (METADATA_TAGS.some((tag) => bytes.includes(tag))) withMetadata.push(name);
  }
  expect(withMetadata).toEqual([]);
});
