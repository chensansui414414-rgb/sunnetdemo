type RgbaImage = {
  width: number;
  height: number;
  data: Uint8Array;
};

export type RadarCityCalibration = {
  regionCode: string;
  x: number;
  y: number;
  radiusPx: number;
  mapBottom: number;
};

export type RadarAreaMetrics = {
  echoCoverage: number;
  strongEchoCoverage: number;
  maxDbz: number;
  meanDbz: number;
  sampledPixels: number;
};

export type RadarImageMetrics = {
  city: RadarAreaMetrics;
  sunrisePath: RadarAreaMetrics;
  sunsetPath: RadarAreaMetrics;
};

// Pixel control points are fitted against the labelled city dots in each CMA
// regional PNG. They are suitable for regional risk statistics, not official
// grid-point retrieval. Keep this explicit until CMA publishes the projection.
export const radarCityCalibrations: Record<string, RadarCityCalibration> = {
  北京: { regionCode: "ANCN", x: 552, y: 324, radiusPx: 52, mapBottom: 828 },
  上海: { regionCode: "AECN", x: 520, y: 536, radiusPx: 48, mapBottom: 1205 },
  南京: { regionCode: "AECN", x: 416, y: 496, radiusPx: 48, mapBottom: 1205 },
  南通: { regionCode: "AECN", x: 493, y: 488, radiusPx: 48, mapBottom: 1205 },
  广州: { regionCode: "ASCN", x: 688, y: 319, radiusPx: 52, mapBottom: 837 },
  成都: { regionCode: "ASWC", x: 554, y: 197, radiusPx: 50, mapBottom: 697 },
};

// Official legend values sampled from the fixed 5 dBZ colour blocks printed in
// CMA regional composite-reflectivity PNG products.
const RADAR_PALETTE = [
  { dbz: 5, rgb: [62, 158, 232] },
  { dbz: 10, rgb: [94, 224, 224] },
  { dbz: 15, rgb: [103, 239, 66] },
  { dbz: 20, rgb: [0, 216, 0] },
  { dbz: 25, rgb: [0, 153, 0] },
  { dbz: 30, rgb: [255, 255, 0] },
  { dbz: 35, rgb: [245, 204, 0] },
  { dbz: 40, rgb: [255, 153, 0] },
  { dbz: 45, rgb: [255, 31, 15] },
  { dbz: 50, rgb: [221, 0, 0] },
  { dbz: 55, rgb: [187, 0, 0] },
  { dbz: 60, rgb: [243, 0, 232] },
  { dbz: 65, rgb: [154, 0, 184] },
  { dbz: 70, rgb: [173, 145, 229] },
] as const;

function readUint32(bytes: Uint8Array, offset: number) {
  return (
    bytes[offset] * 0x1000000 +
    (bytes[offset + 1] << 16) +
    (bytes[offset + 2] << 8) +
    bytes[offset + 3]
  );
}

async function inflate(bytes: Uint8Array) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function paeth(a: number, b: number, c: number) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export async function decodeRadarPng(buffer: ArrayBuffer): Promise<RgbaImage> {
  const bytes = new Uint8Array(buffer);
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) throw new Error("CMA radar file is not a PNG");

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat: Uint8Array[] = [];
  let idatLength = 0;

  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = readUint32(bytes, offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    if (type === "IHDR") {
      width = readUint32(bytes, dataStart);
      height = readUint32(bytes, dataStart + 4);
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      const interlace = bytes[dataStart + 12];
      if (interlace !== 0) throw new Error("Interlaced CMA radar PNG is not supported");
    } else if (type === "IDAT") {
      const chunk = bytes.slice(dataStart, dataStart + length);
      idat.push(chunk);
      idatLength += chunk.length;
    } else if (type === "IEND") {
      break;
    }
    offset = dataStart + length + 4;
  }

  if (!width || !height || bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported CMA radar PNG format: ${width}x${height}, depth=${bitDepth}, color=${colorType}`);
  }

  const compressed = new Uint8Array(idatLength);
  let cursor = 0;
  for (const chunk of idat) {
    compressed.set(chunk, cursor);
    cursor += chunk.length;
  }

  const raw = await inflate(compressed);
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const decoded = new Uint8Array(height * stride);
  let inputOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[inputOffset++];
    const rowOffset = y * stride;
    const previousOffset = rowOffset - stride;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[inputOffset++];
      const left = x >= channels ? decoded[rowOffset + x - channels] : 0;
      const up = y > 0 ? decoded[previousOffset + x] : 0;
      const upperLeft = y > 0 && x >= channels ? decoded[previousOffset + x - channels] : 0;
      if (filter === 0) decoded[rowOffset + x] = value;
      else if (filter === 1) decoded[rowOffset + x] = (value + left) & 255;
      else if (filter === 2) decoded[rowOffset + x] = (value + up) & 255;
      else if (filter === 3) decoded[rowOffset + x] = (value + Math.floor((left + up) / 2)) & 255;
      else if (filter === 4) decoded[rowOffset + x] = (value + paeth(left, up, upperLeft)) & 255;
      else throw new Error(`Unsupported CMA radar PNG filter: ${filter}`);
    }
  }

  if (channels === 4) return { width, height, data: decoded };
  const rgba = new Uint8Array(width * height * 4);
  for (let source = 0, target = 0; source < decoded.length; source += 3, target += 4) {
    rgba[target] = decoded[source];
    rgba[target + 1] = decoded[source + 1];
    rgba[target + 2] = decoded[source + 2];
    rgba[target + 3] = 255;
  }
  return { width, height, data: rgba };
}

function dbzFromPixel(r: number, g: number, b: number) {
  let nearest: (typeof RADAR_PALETTE)[number] | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const entry of RADAR_PALETTE) {
    const distance =
      (r - entry.rgb[0]) ** 2 +
      (g - entry.rgb[1]) ** 2 +
      (b - entry.rgb[2]) ** 2;
    if (distance < nearestDistance) {
      nearest = entry;
      nearestDistance = distance;
    }
  }
  // Anti-aliased map labels, borders, sea and background must not be counted as
  // radar. Real echo pixels remain very close to one of the fixed legend colours.
  return nearest && nearestDistance <= 28 ** 2 ? nearest.dbz : 0;
}

function analyzeArea(
  image: RgbaImage,
  calibration: RadarCityCalibration,
  direction: "city" | "east" | "west",
): RadarAreaMetrics {
  const { x: centerX, y: centerY, radiusPx } = calibration;
  const outerRadius = direction === "city" ? radiusPx : Math.round(radiusPx * 1.9);
  const innerRadius = direction === "city" ? 0 : Math.round(radiusPx * 0.45);
  let echoPixels = 0;
  let strongPixels = 0;
  let sampledPixels = 0;
  let dbzTotal = 0;
  let maxDbz = 0;

  const minX = Math.max(0, centerX - outerRadius);
  const maxX = Math.min(image.width - 1, centerX + outerRadius);
  const minY = Math.max(0, centerY - outerRadius);
  const maxY = Math.min(Math.min(image.height - 1, calibration.mapBottom), centerY + outerRadius);
  for (let y = minY; y <= maxY; y += 2) {
    for (let x = minX; x <= maxX; x += 2) {
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.hypot(dx, dy);
      if (distance > outerRadius || distance < innerRadius) continue;
      if (direction === "east" && dx <= Math.abs(dy) * 0.45) continue;
      if (direction === "west" && -dx <= Math.abs(dy) * 0.45) continue;
      sampledPixels += 1;
      const offset = (y * image.width + x) * 4;
      const dbz = dbzFromPixel(image.data[offset], image.data[offset + 1], image.data[offset + 2]);
      if (!dbz) continue;
      echoPixels += 1;
      dbzTotal += dbz;
      if (dbz >= 35) strongPixels += 1;
      if (dbz > maxDbz) maxDbz = dbz;
    }
  }

  return {
    echoCoverage: sampledPixels ? Math.round((echoPixels / sampledPixels) * 100) : 0,
    strongEchoCoverage: sampledPixels ? Math.round((strongPixels / sampledPixels) * 100) : 0,
    maxDbz,
    meanDbz: echoPixels ? Math.round((dbzTotal / echoPixels) * 10) / 10 : 0,
    sampledPixels,
  };
}

export function analyzeRadarImage(image: RgbaImage, calibration: RadarCityCalibration): RadarImageMetrics {
  return {
    city: analyzeArea(image, calibration, "city"),
    sunrisePath: analyzeArea(image, calibration, "east"),
    sunsetPath: analyzeArea(image, calibration, "west"),
  };
}
