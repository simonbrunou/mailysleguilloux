# site/images/

Local working copies of the images served by the site. The deployed site does **not** read from this directory — images live in the R2 bucket `mailysleguilloux-images` and are served by the Worker at `/images/*`.

Upload the contents of this directory to R2:

```bash
./scripts/upload-images.sh
```

Expected files:

- `mailys.{webp,jpg}` — hero portrait
- `prestation-humains.{webp,jpg}`
- `prestation-animaux.{webp,jpg}`
- `cabinet-{1,2,3,4}.{webp,jpg}`
- `og-image.jpg` — 1200×630 for social previews
- `favicon.avif`
