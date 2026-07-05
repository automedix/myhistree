import Database from "better-sqlite3";
import { join } from "path";
import pLimit from "p-limit";

const DB_PATH = join(process.cwd(), "data", "myhistoree.db");
const db = new Database(DB_PATH);

async function fetchTitle(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) return "";
  const html = await res.text();
  const match = html.match(/<title>([^]*?)<\/title>/i);
  return match ? match[1].replace(/\s*\|\s*DEXIMED.*?$/i, "").trim() : "";
}

function parseSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const urlMatches = xml.matchAll(/<url>([\s\S]*?)<\/url>/g);
  for (const m of urlMatches) {
    const block = m[1];
    const loc = block.match(/<loc>(.*?)<\/loc>/);
    if (loc && loc[1].includes("/patienteninformationen/")) {
      urls.push(loc[1]);
    }
  }
  return urls;
}

async function main() {
  console.log("Fetching sitemap...");
  const sitemapRes = await fetch("https://deximed.de/sitemap.xml");
  if (!sitemapRes.ok) throw new Error("Failed to fetch sitemap: " + sitemapRes.status);
  const sitemapXml = await sitemapRes.text();
  const patientUrls = parseSitemapUrls(sitemapXml);
  console.log(`Found ${patientUrls.length} patient information URLs.`);

  const limit = pLimit(5);
  let inserted = 0;
  let updated = 0;

  for (const url of patientUrls) {
    const slug = url.replace(/^https?:\/\/deximed\.de\//, "").replace(/\/$/, "");
    const existing = db.prepare("SELECT id FROM deximed_articles WHERE url = ?").get(url) as any;

    if (!existing) {
      const title = await limit(() => fetchTitle(url));
      if (title) {
        db.prepare("INSERT OR IGNORE INTO deximed_articles (title, url, slug) VALUES (?, ?, ?)")
          .run(title, url, slug);
        inserted++;
      }
    } else {
      updated++;
    }
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`Done. Inserted: ${inserted}, Updated: ${updated}`);
  db.close();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
