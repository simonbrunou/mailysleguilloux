#!/usr/bin/env bash
# Upload every image in site/images/ to the R2 bucket the site serves from.
# Idempotent — re-running just overwrites existing objects.

set -euo pipefail

BUCKET="mailysleguilloux-images"
DIR="$(dirname "$0")/../site/images"

cd "$DIR"

shopt -s nullglob
files=(*.webp *.jpg *.jpeg *.png *.avif *.svg *.gif)
shopt -u nullglob

if [ ${#files[@]} -eq 0 ]; then
    echo "No images found in $DIR"
    exit 1
fi

declare -A MIME=(
    [webp]=image/webp
    [jpg]=image/jpeg
    [jpeg]=image/jpeg
    [png]=image/png
    [avif]=image/avif
    [svg]=image/svg+xml
    [gif]=image/gif
)

for f in "${files[@]}"; do
    ext="${f##*.}"
    ext_lower="${ext,,}"
    content_type="${MIME[$ext_lower]:-application/octet-stream}"

    echo "→ $f  ($content_type)"
    npx wrangler r2 object put "$BUCKET/$f" \
        --file "$f" \
        --content-type "$content_type" \
        --cache-control "public, max-age=31536000, immutable"
done

echo
echo "✅ Uploaded ${#files[@]} file(s) to r2://$BUCKET"
