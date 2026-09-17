/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    // Next 14 : ces paquets restent en require() cote serveur et ne passent
    // pas par webpack. Indispensable pour onnxruntime-node (binaire natif
    // .node) et pour les paquets CJS lourds de l'ingestion.
    serverComponentsExternalPackages: [
      'onnxruntime-node',
      '@xenova/transformers',
      'sharp',
      'pdf-parse',
      'tesseract.js',
      'pdfkit',
      // Rasterisation PDF (§8). @napi-rs/canvas embarque un binaire natif
      // `skia.*.node` que webpack ne sait pas parser : sans cette ligne, le
      // build echoue sur « Module parse failed: Unexpected character ».
      '@napi-rs/canvas',
      'pdfjs-dist',
    ],
    serverActions: { bodySizeLimit: '12mb' },
  },
};

module.exports = nextConfig;
