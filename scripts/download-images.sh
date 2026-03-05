#!/bin/bash
# Download and optimize images from the original Wix site
# Run this once after cloning the repo

set -e

cd "$(dirname "$0")/../site/images"

echo "📥 Downloading images from Wix..."

# Main photo
wget -q -O mailys.jpg "https://static.wixstatic.com/media/950ab8_108ba9d8880540cfa07a4d4dfdc7ea3c~mv2.jpeg"
echo "✓ mailys.jpg"

# Service photos
wget -q -O prestation-humains.jpg "https://static.wixstatic.com/media/950ab8_7766640a1925482ca3547ade09b07b30~mv2.jpeg"
echo "✓ prestation-humains.jpg"

wget -q -O prestation-animaux.jpg "https://static.wixstatic.com/media/950ab8_ae9af35ce0b04d40a4e090d5b23ae720~mv2.jpeg"
echo "✓ prestation-animaux.jpg"

# Cabinet photos
wget -q -O cabinet-1.png "https://static.wixstatic.com/media/950ab8_6ec03911e94e4d4495f4b1c4bab5c9b6~mv2.png"
echo "✓ cabinet-1.png (will convert to jpg)"

wget -q -O cabinet-2.png "https://static.wixstatic.com/media/950ab8_e7d83dbd9a5d4e07985fb6b43bc0c4ef~mv2.png"
echo "✓ cabinet-2.png (will convert to jpg)"

wget -q -O cabinet-3.png "https://static.wixstatic.com/media/950ab8_c68bbafbc0a94058bdb8cfad6deaf35f~mv2.png"
echo "✓ cabinet-3.png (will convert to jpg)"

wget -q -O cabinet-4.jpg "https://static.wixstatic.com/media/950ab8_9702c25f875f4a6999e61adc390e76f9~mv2.jpg"
echo "✓ cabinet-4.jpg"

echo ""
echo "📦 Optimizing images..."

# Convert large PNGs to optimized JPGs using ImageMagick
if command -v magick &> /dev/null; then
    for f in cabinet-1.png cabinet-2.png cabinet-3.png; do
        base="${f%.png}"
        magick "$f" -resize "800x800>" -quality 85 "${base}.jpg"
        rm "$f"
        echo "✓ Converted $f -> ${base}.jpg"
    done
    # Optimize JPGs
    for f in mailys.jpg prestation-humains.jpg prestation-animaux.jpg cabinet-4.jpg; do
        magick "$f" -resize "800x800>" -quality 85 "${f%.jpg}-opt.jpg"
        mv "${f%.jpg}-opt.jpg" "$f"
    done
    # Resize mailys.jpg larger for hero
    magick mailys.jpg -resize "760x1086>" -quality 85 mailys-opt.jpg
    mv mailys-opt.jpg mailys.jpg
    echo "✓ Image optimization complete"
elif command -v convert &> /dev/null; then
    for f in cabinet-1.png cabinet-2.png cabinet-3.png; do
        base="${f%.png}"
        convert "$f" -resize "800x800>" -quality 85 "${base}.jpg"
        rm "$f"
        echo "✓ Converted $f -> ${base}.jpg"
    done
    for f in mailys.jpg prestation-humains.jpg prestation-animaux.jpg cabinet-4.jpg; do
        convert "$f" -resize "800x800>" -quality 85 "${f%.jpg}-opt.jpg"
        mv "${f%.jpg}-opt.jpg" "$f"
    done
    convert mailys.jpg -resize "760x1086>" -quality 85 mailys-opt.jpg
    mv mailys-opt.jpg mailys.jpg
    echo "✓ Image optimization complete"
else
    echo "⚠ ImageMagick not installed, skipping optimization"
fi

echo ""
echo "✅ Done! Don't forget to:"
echo "   1. Create og-image.jpg (1200x630) for social sharing"
echo "   2. Create favicons at realfavicongenerator.net"
