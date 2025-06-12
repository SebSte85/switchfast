const fs = require("fs");
const path = require("path");

// Erstelle dist/assets Verzeichnis falls es nicht existiert
const assetsDir = path.join(__dirname, "..", "dist", "assets");
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Kopiere alle PNG-Dateien aus src/assets nach dist/assets
const srcAssetsDir = path.join(__dirname, "..", "src", "assets");
const files = fs.readdirSync(srcAssetsDir);

files
  .filter((file) => file.endsWith(".png"))
  .forEach((file) => {
    const srcPath = path.join(srcAssetsDir, file);
    const destPath = path.join(assetsDir, file);
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied ${file} to dist/assets/`);
  });

console.log("Assets copied successfully!");
