import { readFile, writeFile } from "node:fs/promises";
import { createSign } from "node:crypto";

const documentId = "1x39NgX0RAVRdO8-Uocr18OeSUhaLQy8WN0qIFXKn-iE";
const dataPath = new URL("../data/campaign-dates.json", import.meta.url);
const regions = ["ID", "BR", "MY", "TH", "VN", "TW", "SG", "PH"];

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

async function getAccessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;

  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_JSON;
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson && !keyPath) {
    throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_KEY_JSON.");
  }
  const credentials = JSON.parse(
    keyJson ?? await readFile(keyPath, "utf8"),
  );
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("The Google service account key is missing its email or private key.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const header = encodeBase64Url(JSON.stringify({
    alg: "RS256",
    typ: "JWT",
    ...(credentials.private_key_id ? { kid: credentials.private_key_id } : {}),
  }));
  const payload = encodeBase64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/documents.readonly",
    aud: "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsignedAssertion = `${header}.${payload}`;
  const signature = createSign("RSA-SHA256")
    .update(unsignedAssertion)
    .sign(credentials.private_key)
    .toString("base64url");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsignedAssertion}.${signature}`,
    }),
  });
  if (!tokenResponse.ok) {
    throw new Error(`Google OAuth returned ${tokenResponse.status}: ${await tokenResponse.text()}`);
  }
  const token = await tokenResponse.json();
  if (!token.access_token) throw new Error("Google OAuth returned no access token.");
  return token.access_token;
}

const accessToken = await getAccessToken();

const response = await fetch(
  `https://docs.googleapis.com/v1/documents/${documentId}?includeTabsContent=true`,
  { headers: { Authorization: `Bearer ${accessToken}` } },
);
if (!response.ok) {
  throw new Error(`Google Docs API returned ${response.status}: ${await response.text()}`);
}

const document = await response.json();
const paragraphs = [];

function collectContent(items = []) {
  for (const item of items) {
    if (item.paragraph) {
      paragraphs.push({
        text: (item.paragraph.elements ?? [])
          .map((element) => element.textRun?.content ?? "")
          .join("")
          .trim(),
        style: item.paragraph.paragraphStyle?.namedStyleType ?? "NORMAL_TEXT",
      });
    }
    if (item.table) {
      for (const row of item.table.tableRows ?? []) {
        for (const cell of row.tableCells ?? []) collectContent(cell.content);
      }
    }
    if (item.tableOfContents) collectContent(item.tableOfContents.content);
  }
}

if (document.tabs?.length) {
  for (const tab of document.tabs) collectContent(tab.documentTab?.body?.content);
} else {
  collectContent(document.body?.content);
}

let year = null;
let activeMonth = null;
const campaignsByKey = new Map();

function collectRegions(regionText) {
  if (/\ball\s+regions?\b|\ball\s+regon\b|全部地区/i.test(regionText)) {
    return [...regions];
  }

  const found = new Set();
  for (const match of regionText.toUpperCase().matchAll(/(?:^|[^A-Z])(ID|BR|MY|TH|VN|TW|SG|PH)(?=$|[^A-Z])/g)) {
    found.add(match[1]);
  }
  return regions.filter((region) => found.has(region));
}

for (const paragraph of paragraphs) {
  const text = paragraph.text;
  if (!text) continue;

  const yearMatch = text.match(/(20\d{2})\s*Q[1-4]/i);
  if (yearMatch) year = Number(yearMatch[1]);

  const monthHeading = text.match(/大促生效时间\s*(\d{1,2})月/);
  if (monthHeading) {
    activeMonth = Number(monthHeading[1]);
    continue;
  }

  if (paragraph.style.startsWith("HEADING_")) {
    activeMonth = null;
    continue;
  }

  if (activeMonth === null || !year) continue;

  const dateMatch = text.match(/^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*[：:]/);
  if (!dateMatch) continue;

  const lineMonth = Number(dateMatch[1]);
  const day = Number(dateMatch[2]);
  if (lineMonth !== activeMonth) continue;

  const dateCheck = new Date(Date.UTC(year, lineMonth - 1, day));
  if (
    dateCheck.getUTCFullYear() !== year ||
    dateCheck.getUTCMonth() !== lineMonth - 1 ||
    dateCheck.getUTCDate() !== day
  ) continue;

  const specifications = [
    { label: "动态配置大促", type: "dynamic" },
    { label: "人工配置大促", type: "manual" },
  ];
  const typePattern = /(动态配置大促|人工配置大促)\s*[：:]\s*(.*?)(?=(?:动态配置大促|人工配置大促)\s*[：:]|$)/g;

  for (const match of text.matchAll(typePattern)) {
    const type = specifications.find((item) => item.label === match[1])?.type;
    const entryRegions = collectRegions(match[2]);
    if (!type || !entryRegions.length) continue;

    const date = `${year}-${String(lineMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const key = `${date}:${type}`;
    if (!campaignsByKey.has(key)) campaignsByKey.set(key, { date, type, regions: new Set() });
    for (const region of entryRegions) campaignsByKey.get(key).regions.add(region);
  }
}

if (!campaignsByKey.size || !year) {
  throw new Error("No campaign dates were found. The source document format may have changed.");
}

const campaigns = [...campaignsByKey.values()]
  .map(({ date, type, regions: entryRegions }) => ({
    date,
    type,
    regions: regions.filter((region) => entryRegions.has(region)),
  }))
  .sort((a, b) => b.date.localeCompare(a.date) || a.type.localeCompare(b.type));

const latestMonth = Math.max(...campaigns.map(({ date }) => Number(date.slice(5, 7))));
const output = {
  year,
  asOf: campaigns[0].date,
  regions,
  availableMonths: Array.from({ length: latestMonth }, (_, index) => index + 1),
  campaigns,
};

const previous = JSON.parse(await readFile(dataPath, "utf8"));
if (
  previous.year === output.year &&
  previous.campaigns?.length &&
  campaigns.length < previous.campaigns.length * 0.6
) {
  throw new Error("The source yielded far fewer dates than the current page; refusing to publish a partial parse.");
}

await writeFile(dataPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Updated ${campaigns.length} campaign entries through ${output.asOf}.`);
