const AERONET_BASE_URL = "https://aeronet.gsfc.nasa.gov/cgi-bin/print_web_data_v3";
const CACHE_TTL_MS = 60 * 60 * 1000;

type CacheValue = {
  expiresAt: number;
  payload: AeronetPayload;
};

type AeronetPayload = {
  source: string;
  site: string;
  time: string[];
  aerosol_optical_depth: number[];
  aod_method: "aeronet_hourly_observation";
  wavelength: string;
  level: "2.0";
  latest_time?: string;
};

const cache = new Map<string, CacheValue>();

function dateParts(date = new Date()) {
  return {
    year: String(date.getUTCFullYear()),
    month: String(date.getUTCMonth() + 1),
    day: String(date.getUTCDate()),
  };
}

function numberFrom(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) && parsed > -900 ? parsed : undefined;
}

function normalizeDateTime(date?: string, time?: string) {
  if (!date || !time) return undefined;
  const [day, month, year] = date.split(":");
  if (!day || !month || !year) return undefined;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${time.slice(0, 5)}`;
}

function parseAeronetText(text: string, site: string): AeronetPayload {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const headerIndex = lines.findIndex((line) => line.includes("Date(") && line.includes("Time("));
  if (headerIndex < 0) throw new Error("AERONET response has no table header");

  const headers = lines[headerIndex].split(",").map((item) => item.trim());
  const rows = lines.slice(headerIndex + 1).map((line) => line.split(",").map((item) => item.trim()));
  const dateIndex = headers.findIndex((item) => item.startsWith("Date("));
  const timeIndex = headers.findIndex((item) => item.startsWith("Time("));
  const preferredColumns = ["AOD_500nm", "AOD_550nm", "AOD_440nm", "AOD_675nm", "AOD_870nm"];
  const aodIndex = preferredColumns.map((name) => headers.indexOf(name)).find((index) => index >= 0);
  if (aodIndex === undefined || aodIndex < 0) throw new Error("AERONET response has no supported AOD column");

  const values = rows
    .map((row) => ({
      time: normalizeDateTime(row[dateIndex], row[timeIndex]),
      aod: numberFrom(row[aodIndex]),
    }))
    .filter((row): row is { time: string; aod: number } => Boolean(row.time) && row.aod !== undefined);

  if (!values.length) throw new Error("AERONET response has no valid AOD observation");
  const latest = values[values.length - 1];
  return {
    source: "AERONET Level 2.0 Direct Sun AOD",
    site,
    time: [latest.time],
    aerosol_optical_depth: [Number(latest.aod.toFixed(3))],
    aod_method: "aeronet_hourly_observation",
    wavelength: headers[aodIndex],
    level: "2.0",
    latest_time: latest.time,
  };
}

async function fetchAeronet(site: string) {
  const today = new Date();
  const from = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const start = dateParts(from);
  const end = dateParts(today);
  const url = new URL(AERONET_BASE_URL);
  url.searchParams.set("site", site);
  url.searchParams.set("year", start.year);
  url.searchParams.set("month", start.month);
  url.searchParams.set("day", start.day);
  url.searchParams.set("year2", end.year);
  url.searchParams.set("month2", end.month);
  url.searchParams.set("day2", end.day);
  url.searchParams.set("AOD20", "1");
  url.searchParams.set("AVG", "10");
  url.searchParams.set("if_no_html", "1");

  const response = await fetch(url.toString(), {
    headers: {
      Accept: "text/plain,text/csv,*/*",
      "User-Agent": "GlowCast/1.0",
    },
    next: { revalidate: 3600 },
  });
  if (!response.ok) throw new Error(`AERONET request failed: ${response.status}`);
  const text = await response.text();
  return parseAeronetText(text, site);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const site = url.searchParams.get("site") || "Nanjing";
  const cached = cache.get(site);

  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ ...cached.payload, cache: "hit" });
  }

  try {
    const payload = await fetchAeronet(site);
    cache.set(site, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      payload,
    });
    return Response.json({ ...payload, cache: "miss" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown AERONET error";
    return Response.json(
      {
        error: message,
        source: "AERONET Level 2.0 Direct Sun AOD",
        site,
      },
      { status: 502 },
    );
  }
}
