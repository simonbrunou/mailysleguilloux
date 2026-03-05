#!/bin/bash
# Download and optimize images from the original Wix site
# Run this once after cloning the repo

set -e

cd "$(dirname "$0")/site/images"

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
echo "✓ cabinet-1.png"

wget -q -O cabinet-2.png "https://static.wixstatic.com/media/950ab8_e7d83dbd9a5d4e07985fb6b43bc0c4ef~mv2.png"
echo "✓ cabinet-2.png"

wget -q -O cabinet-3.png "https://static.wixstatic.com/media/950ab8_c68bbafbc0a94058bdb8cfad6deaf35f~mv2.png"
echo "✓ cabinet-3.png"

wget -q -O cabinet-4.jpg "https://static.wixstatic.com/media/950ab8_9702c25f875f4a6999e61adc390e76f9~mv2.jpg"
echo "✓ cabinet-4.jpg"

echo ""
echo "📦 Optimizing images..."

# Check if optimization tools are available
if command -v jpegoptim &> /dev/null; then
    jpegoptim --strip-all --max=85 -q *.jpg
    echo "✓ JPEG optimization complete"
else
    echo "⚠ jpegoptim not installed, skipping JPEG optimization"
fi

if command -v optipng &> /dev/null; then
    optipng -o2 -quiet *.png
    echo "✓ PNG optimization complete"
else
    echo "⚠ optipng not installed, skipping PNG optimization"
fi

echo ""
echo "✅ Done! Don't forget to:"
echo "   1. Update index.html to reference images/mailys.jpg etc."
echo "   2. Create og-image.jpg (1200x630) for social sharing"
echo "   3. Create favicons at realfavicongenerator.net"
