/**
 * Generate Tamagotchi pixel art sprites.
 * Character holding a hot dog over a magical fire, with mood escalation.
 * Pure Node.js — no external dependencies.
 *
 * Usage: node scripts/generate-tamagotchi.mjs
 */

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_DIR = join(__dirname, "..", "public", "tamagotchi");

// Grid size for pixel art (rendered with imageRendering: pixelated)
const W = 64;
const H = 64;

// --- Color Palette ---
// Transparent
const _ = [0, 0, 0, 0];
// Character body
const B = [60, 50, 80, 255];     // dark purple body
const b = [90, 75, 120, 255];    // lighter purple body
const S = [220, 190, 160, 255];  // skin tone
const E = [40, 35, 55, 255];     // dark eyes/outline
const W_ = [240, 235, 230, 255]; // white highlights
const H_ = [50, 40, 90, 255];    // hat dark
const h = [80, 65, 140, 255];    // hat lighter
const G = [200, 170, 80, 255];   // gold belt/trim

// Hot dog
const D = [200, 140, 80, 255];   // bun
const d = [180, 60, 50, 255];    // sausage
const m = [220, 180, 50, 255];   // mustard

// Stick
const K = [140, 100, 60, 255];   // brown stick

// Fire colors
const F1 = [248, 81, 73, 255];    // red-orange flame (maestro-red)
const F2 = [245, 158, 11, 255];   // orange flame (maestro-orange)
const F3 = [234, 179, 8, 255];    // yellow flame (maestro-yellow)
const F4 = [188, 140, 255, 255];  // purple magic (maestro-purple)
const F5 = [88, 166, 255, 255];   // blue magic (maestro-accent)

// Sparkle
const SP = [255, 220, 255, 255];  // sparkle white-pink
const S2 = [200, 160, 255, 255];  // sparkle purple
const S3 = [120, 200, 255, 255];  // sparkle blue

// Ember/ash
const A = [80, 70, 65, 255];     // ash gray
const A2 = [120, 100, 85, 255];  // warm gray

// ZZZ for sleeping
const Z = [140, 140, 150, 255];  // muted text color

/**
 * Create a blank 64x64 grid filled with transparent pixels.
 */
function createGrid() {
  return Array.from({ length: H }, () =>
    Array.from({ length: W }, () => [..._])
  );
}

/**
 * Draw a list of pixel specs onto a grid.
 * Each spec is [row, col, color].
 */
function drawPixels(grid, pixels) {
  for (const [r, c, color] of pixels) {
    if (r >= 0 && r < H && c >= 0 && c < W) {
      grid[r][c] = color;
    }
  }
}

/**
 * Draw a filled rectangle.
 */
function drawRect(grid, r0, c0, w, h, color) {
  for (let r = r0; r < r0 + h; r++) {
    for (let c = c0; c < c0 + w; c++) {
      if (r >= 0 && r < H && c >= 0 && c < W) {
        grid[r][c] = color;
      }
    }
  }
}

/**
 * Draw the character body (common across all states).
 * Position: centered, slightly left to leave room for fire on right.
 */
function drawCharacterBase(grid, offsetY = 0) {
  const ox = 14; // x offset
  const oy = 16 + offsetY; // y offset

  // Hat (pointy wizard hat)
  drawPixels(grid, [
    [oy - 6, ox + 7, h], [oy - 6, ox + 8, h],
    [oy - 5, ox + 6, h], [oy - 5, ox + 7, H_], [oy - 5, ox + 8, H_], [oy - 5, ox + 9, h],
    [oy - 4, ox + 5, h], [oy - 4, ox + 6, H_], [oy - 4, ox + 7, H_], [oy - 4, ox + 8, H_], [oy - 4, ox + 9, H_], [oy - 4, ox + 10, h],
    [oy - 3, ox + 4, h], [oy - 3, ox + 5, H_], [oy - 3, ox + 6, H_], [oy - 3, ox + 7, W_], [oy - 3, ox + 8, W_], [oy - 3, ox + 9, H_], [oy - 3, ox + 10, H_], [oy - 3, ox + 11, h],
  ]);

  // Head
  drawRect(grid, oy - 2, ox + 4, 8, 2, S); // forehead
  drawRect(grid, oy, ox + 3, 10, 4, S);      // face

  // Eyes
  drawPixels(grid, [
    [oy, ox + 5, E], [oy, ox + 6, E],
    [oy, ox + 9, E], [oy, ox + 10, E],
    [oy + 1, ox + 5, W_], [oy + 1, ox + 10, W_], // eye highlights
  ]);

  // Mouth
  drawPixels(grid, [
    [oy + 2, ox + 7, E], [oy + 2, ox + 8, E],
  ]);

  // Body (robe)
  drawRect(grid, oy + 4, ox + 3, 10, 8, B);
  drawRect(grid, oy + 4, ox + 5, 6, 8, b);

  // Belt
  drawRect(grid, oy + 7, ox + 3, 10, 1, G);

  // Feet
  drawPixels(grid, [
    [oy + 12, ox + 4, E], [oy + 12, ox + 5, E],
    [oy + 12, ox + 9, E], [oy + 12, ox + 10, E],
  ]);

  return { ox, oy };
}

/**
 * Draw the character's arm extending right, holding a stick with hot dog.
 */
function drawArmAndHotdog(grid, ox, oy, armUp = false) {
  const armY = armUp ? oy + 4 : oy + 6;
  const stickEndX = ox + 22;
  const stickEndY = armUp ? armY - 4 : armY - 2;

  // Arm extending right
  drawPixels(grid, [
    [armY, ox + 13, S], [armY, ox + 14, S], [armY, ox + 15, S],
  ]);

  // Stick
  for (let i = 0; i < 8; i++) {
    const sy = armUp ? armY - Math.floor(i * 0.5) : armY - Math.floor(i * 0.25);
    drawPixels(grid, [[sy, ox + 15 + i, K]]);
  }

  // Hot dog at end of stick
  const hdY = stickEndY;
  drawPixels(grid, [
    // Bun
    [hdY - 1, stickEndX - 1, D], [hdY - 1, stickEndX, D], [hdY - 1, stickEndX + 1, D],
    [hdY + 1, stickEndX - 1, D], [hdY + 1, stickEndX, D], [hdY + 1, stickEndX + 1, D],
    // Sausage
    [hdY, stickEndX - 1, d], [hdY, stickEndX, d], [hdY, stickEndX + 1, d],
    // Mustard
    [hdY, stickEndX, m],
  ]);
}

/**
 * Draw campfire logs.
 */
function drawLogs(grid, baseY, baseX) {
  // Log 1 (diagonal left)
  drawPixels(grid, [
    [baseY, baseX - 2, K], [baseY, baseX - 1, K],
    [baseY + 1, baseX - 3, K], [baseY + 1, baseX - 2, K],
  ]);
  // Log 2 (diagonal right)
  drawPixels(grid, [
    [baseY, baseX + 1, K], [baseY, baseX + 2, K],
    [baseY + 1, baseX + 2, K], [baseY + 1, baseX + 3, K],
  ]);
}

// ============================================================
// State 0: Sleeping - asleep next to dimmed campfire
// ============================================================
function generateState0() {
  const grid = createGrid();

  // Character lying down / slumped (shifted down, slight tilt)
  const { ox, oy } = drawCharacterBase(grid, 4);

  // Closed eyes (horizontal lines instead of dots)
  drawPixels(grid, [
    [oy + 4, ox + 5, S], [oy + 4, ox + 6, S], // cover normal eyes
    [oy + 4, ox + 9, S], [oy + 4, ox + 10, S],
    [oy + 4 + 1, ox + 5, E], [oy + 4 + 1, ox + 6, E], // closed eyes as dashes
    [oy + 4 + 1, ox + 9, E], [oy + 4 + 1, ox + 10, E],
  ]);

  // Hot dog stick resting on ground
  const groundY = oy + 16;
  for (let i = 0; i < 10; i++) {
    drawPixels(grid, [[groundY, ox + 12 + i, K]]);
  }
  // Hot dog on ground
  drawPixels(grid, [
    [groundY - 1, ox + 20, D], [groundY - 1, ox + 21, D], [groundY - 1, ox + 22, D],
    [groundY - 2, ox + 20, d], [groundY - 2, ox + 21, d], [groundY - 2, ox + 22, d],
  ]);

  // Smoldering fire (just embers)
  const fireX = 42;
  const fireY = groundY;
  drawLogs(grid, fireY, fireX);
  drawPixels(grid, [
    [fireY - 1, fireX - 1, A2], [fireY - 1, fireX, F1], [fireY - 1, fireX + 1, A2],
    [fireY - 2, fireX, A],
  ]);

  // ZZZ
  drawPixels(grid, [
    [oy - 2, ox + 16, Z], [oy - 2, ox + 17, Z],
    [oy - 4, ox + 19, Z], [oy - 4, ox + 20, Z],
    [oy - 6, ox + 22, Z],
  ]);

  return grid;
}

// ============================================================
// State 1: Hungry - looking longingly at raw hot dog, tiny fire
// ============================================================
function generateState1() {
  const grid = createGrid();
  const { ox, oy } = drawCharacterBase(grid, 2);

  // Sad/longing mouth
  drawPixels(grid, [
    [oy + 2, ox + 7, S], [oy + 2, ox + 8, S], // cover default mouth
    [oy + 3, ox + 7, E], [oy + 3, ox + 8, E],  // frown
  ]);

  drawArmAndHotdog(grid, ox, oy, false);

  // Tiny fire
  const fireX = 42;
  const fireY = oy + 18;
  drawLogs(grid, fireY, fireX);
  drawPixels(grid, [
    [fireY - 1, fireX, F2],
    [fireY - 2, fireX, F3],
    [fireY - 3, fireX, F1],
  ]);

  // Faint sparkle
  drawPixels(grid, [
    [fireY - 5, fireX + 2, [F4[0], F4[1], F4[2], 100]],
  ]);

  return grid;
}

// ============================================================
// State 2: Bored - slumped, lazily holding hot dog over small fire
// ============================================================
function generateState2() {
  const grid = createGrid();
  const { ox, oy } = drawCharacterBase(grid, 3);

  // Bored expression (half-closed eyes, flat mouth)
  drawPixels(grid, [
    [oy - 1, ox + 5, S], [oy - 1, ox + 6, S],  // half-lid
    [oy - 1, ox + 9, S], [oy - 1, ox + 10, S],
    [oy, ox + 5, E], [oy, ox + 9, E],            // smaller eyes
  ]);

  drawArmAndHotdog(grid, ox, oy, false);

  // Small magical fire
  const fireX = 42;
  const fireY = oy + 17;
  drawLogs(grid, fireY, fireX);
  drawPixels(grid, [
    [fireY - 1, fireX - 1, F1], [fireY - 1, fireX, F2], [fireY - 1, fireX + 1, F1],
    [fireY - 2, fireX - 1, F2], [fireY - 2, fireX, F3], [fireY - 2, fireX + 1, F2],
    [fireY - 3, fireX, F4],
    [fireY - 4, fireX, F5],
  ]);

  // A few sparkles
  drawPixels(grid, [
    [fireY - 6, fireX - 2, S2],
    [fireY - 5, fireX + 3, S3],
  ]);

  return grid;
}

// ============================================================
// State 3: Content - happily roasting over steady magical fire
// ============================================================
function generateState3() {
  const grid = createGrid();
  const { ox, oy } = drawCharacterBase(grid, 1);

  // Happy smile
  drawPixels(grid, [
    [oy + 2, ox + 6, E], [oy + 2, ox + 7, E], [oy + 2, ox + 8, E], [oy + 2, ox + 9, E],
    [oy + 3, ox + 7, E], [oy + 3, ox + 8, E], // wider smile
  ]);

  drawArmAndHotdog(grid, ox, oy, true);

  // Steady magical fire
  const fireX = 42;
  const fireY = oy + 16;
  drawLogs(grid, fireY, fireX);

  // Fire body
  drawPixels(grid, [
    [fireY - 1, fireX - 2, F1], [fireY - 1, fireX - 1, F2], [fireY - 1, fireX, F3], [fireY - 1, fireX + 1, F2], [fireY - 1, fireX + 2, F1],
    [fireY - 2, fireX - 1, F2], [fireY - 2, fireX, F3], [fireY - 2, fireX + 1, F2],
    [fireY - 3, fireX - 2, F4], [fireY - 3, fireX - 1, F3], [fireY - 3, fireX, F3], [fireY - 3, fireX + 1, F3], [fireY - 3, fireX + 2, F4],
    [fireY - 4, fireX - 1, F4], [fireY - 4, fireX, F5], [fireY - 4, fireX + 1, F4],
    [fireY - 5, fireX, F5],
    [fireY - 6, fireX, F4],
  ]);

  // Sparkles
  drawPixels(grid, [
    [fireY - 8, fireX - 3, SP],
    [fireY - 7, fireX + 4, S2],
    [fireY - 9, fireX + 1, S3],
    [oy - 4, ox + 14, SP],
  ]);

  return grid;
}

// ============================================================
// State 4: Ecstatic - roaring magical fire, tons of sparkles & runes
// ============================================================
function generateState4() {
  const grid = createGrid();
  const { ox, oy } = drawCharacterBase(grid, 0);

  // Big grin
  drawPixels(grid, [
    [oy + 2, ox + 5, E], [oy + 2, ox + 6, E], [oy + 2, ox + 7, E],
    [oy + 2, ox + 8, E], [oy + 2, ox + 9, E], [oy + 2, ox + 10, E],
    [oy + 3, ox + 6, E], [oy + 3, ox + 7, W_], [oy + 3, ox + 8, W_], [oy + 3, ox + 9, E],
  ]);

  drawArmAndHotdog(grid, ox, oy, true);

  // Roaring magical fire
  const fireX = 42;
  const fireY = oy + 15;
  drawLogs(grid, fireY, fireX);

  // Large fire
  for (let dy = 1; dy <= 10; dy++) {
    const width = Math.max(1, 6 - Math.floor(dy * 0.5));
    for (let dx = -width; dx <= width; dx++) {
      let color;
      if (dy <= 2) color = F1;
      else if (dy <= 4) color = F2;
      else if (dy <= 6) color = F3;
      else if (dy <= 8) color = F4;
      else color = F5;
      drawPixels(grid, [[fireY - dy, fireX + dx, color]]);
    }
  }

  // Extra flame wisps
  drawPixels(grid, [
    [fireY - 11, fireX - 1, F5], [fireY - 11, fireX + 1, F4],
    [fireY - 12, fireX, SP],
  ]);

  // Abundant sparkles
  const sparkles = [
    [8, 35, SP], [10, 50, S2], [6, 48, S3], [12, 55, SP],
    [5, 38, S2], [14, 45, S3], [4, 52, SP], [9, 58, S2],
    [7, 32, S3], [3, 44, SP], [11, 38, S2], [15, 52, S3],
    [6, 28, SP], [13, 30, S2],
    // Near character
    [oy - 6, ox + 2, SP], [oy - 5, ox + 14, S2],
    [oy - 3, ox - 1, S3], [oy + 2, ox + 16, SP],
  ];
  drawPixels(grid, sparkles);

  // Magical runes (small symbols near fire)
  // Rune 1: diamond shape
  drawPixels(grid, [
    [fireY - 8, fireX + 6, F4],
    [fireY - 9, fireX + 5, F4], [fireY - 9, fireX + 7, F4],
    [fireY - 10, fireX + 6, F4],
  ]);
  // Rune 2: plus shape
  drawPixels(grid, [
    [fireY - 7, fireX - 6, F5],
    [fireY - 8, fireX - 7, F5], [fireY - 8, fireX - 6, F5], [fireY - 8, fireX - 5, F5],
    [fireY - 9, fireX - 6, F5],
  ]);

  return grid;
}

// ============================================================
// PNG Encoder (minimal, supports RGBA)
// ============================================================

function encodePNG(grid) {
  const height = grid.length;
  const width = grid[0].length;

  // Build raw pixel data with filter byte per row
  const rawData = Buffer.alloc(height * (1 + width * 4));
  let offset = 0;
  for (let y = 0; y < height; y++) {
    rawData[offset++] = 0; // filter: None
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = grid[y][x];
      rawData[offset++] = r;
      rawData[offset++] = g;
      rawData[offset++] = b;
      rawData[offset++] = a;
    }
  }

  const compressed = deflateSync(rawData, { level: 9 });

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = makeChunk("IHDR", ihdr);
  const idatChunk = makeChunk("IDAT", compressed);
  const iendChunk = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// ============================================================
// Main
// ============================================================

const states = [
  { fn: generateState0, file: "usage_state_0.png", label: "Sleeping" },
  { fn: generateState1, file: "usage_state_1.png", label: "Hungry" },
  { fn: generateState2, file: "usage_state_2.png", label: "Bored" },
  { fn: generateState3, file: "usage_state_3.png", label: "Content" },
  { fn: generateState4, file: "usage_state_4.png", label: "Happy/Ecstatic" },
];

for (const { fn, file, label } of states) {
  const grid = fn();
  const png = encodePNG(grid);
  const path = join(OUTPUT_DIR, file);
  writeFileSync(path, png);
  console.log(`Generated ${file} (${label}) — ${png.length} bytes`);
}

console.log("\nDone! All 5 Tamagotchi sprites generated.");
