import { test, expect, Page } from '@playwright/test';
import fs from 'fs';
import path from 'path';

type NotionRow = {
  'No.': string; // 5-digit: 00001
  'Screenshot (Files & media, leave empty)': string; // must stay blank
  'Bug Link (Repro URL)': string;
  'Repeated': 'Yes' | 'No';
  'Priority': 'Urgent' | 'Moderate' | 'Low';
  'Device / Platform': 'D Web' | 'M Web' | 'Android' | 'iOS';
  'Description of Issue': string;
  'Recommendation / Fix Suggestion': string;
  'Status': 'Open' | 'Fixed' | 'Verified';
  'Date Found': string; // DD-MM-YYYY
  'Notes / Validation Comments': string; // must include steps, exp vs actual, language, screenshot instructions
};

const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts');
const SCREENSHOTS_DIR = path.join(ARTIFACTS_DIR, 'screenshots');

function ensureDirs() {
  fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

function cairoTodayDDMMYYYY(): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).formatToParts(new Date());
  const d = parts.find(p => p.type === 'day')?.value ?? '01';
  const m = parts.find(p => p.type === 'month')?.value ?? '01';
  const y = parts.find(p => p.type === 'year')?.value ?? '1970';
  return `${d}-${m}-${y}`;
}

function pad5(n: number) {
  return String(n).padStart(5, '0');
}

function makeIdFactory(start = Number(process.env.START_INDEX ?? '1')) {
  let n = start;
  return () => pad5(n++);
}

function tsvEscape(v: string) {
  return (v ?? '').replace(/\t/g, ' ').replace(/\r?\n/g, ' ');
}

function writeTSV(rows: NotionRow[], outPath: string) {
  const headers = [
    'No.',
    'Screenshot (Files & media, leave empty)',
    'Bug Link (Repro URL)',
    'Repeated',
    'Priority',
    'Device / Platform',
    'Description of Issue',
    'Recommendation / Fix Suggestion',
    'Status',
    'Date Found',
    'Notes / Validation Comments',
  ];

  const lines = [
    headers.join('\t'),
    ...rows.map(r => headers.map(h => tsvEscape((r as any)[h] ?? '')).join('\t')),
  ];

  fs.writeFileSync(outPath, lines.join('\n'), 'utf8');
}

function writeMarkdownTable(rows: NotionRow[], outPath: string) {
  const headers = [
    'No.',
    'Screenshot (Files & media, leave empty)',
    'Bug Link (Repro URL)',
    'Repeated',
    'Priority',
    'Device / Platform',
    'Description of Issue',
    'Recommendation / Fix Suggestion',
    'Status',
    'Date Found',
    'Notes / Validation Comments',
  ];

  const md = [
    `| ${headers.join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map(r => `| ${headers.map(h => (r as any)[h] ?? '').join(' | ')} |`),
  ].join('\n');

  fs.writeFileSync(outPath, md, 'utf8');
}

async function clickIfVisible(page: Page, candidates: { by: string; locator: () => any }[]) {
  for (const c of candidates) {
    const loc = c.locator();
    if ((await loc.count().catch(() => 0)) > 0) {
      const first = loc.first();
      if (await first.isVisible().catch(() => false)) {
        await first.click().catch(() => {});
        return true;
      }
    }
  }
  return false;
}

async function switchToArabic(page: Page): Promise<void> {
  // Common header toggle
  const ok = await clickIfVisible(page, [
    { by: 'role-link-ar', locator: () => page.getByRole('link', { name: /العربية/i }) },
    { by: 'text-ar', locator: () => page.locator('text=العربية') },
  ]);
  await page.waitForTimeout(1200);
  if (!ok) {
    // If already AR via persistence, ok. Otherwise treat as failure in checks.
    // Caller will validate RTL.
  }
}

async function switchToEnglish(page: Page): Promise<void> {
  const ok = await clickIfVisible(page, [
    { by: 'role-link-en', locator: () => page.getByRole('link', { name: /english/i }) },
    { by: 'text-en', locator: () => page.locator('text=/English/i') },
  ]);
  await page.waitForTimeout(1200);
  void ok;
}

async function isRTL(page: Page): Promise<boolean> {
  const dir = await page.evaluate(() => document?.documentElement?.dir || '').catch(() => '');
  if (dir.toLowerCase() === 'rtl') return true;
  const bodyDir = await page.evaluate(() => (document.body ? getComputedStyle(document.body).direction : '')).catch(() => '');
  return bodyDir.toLowerCase() === 'rtl';
}

function weekRotationTag(): string {
  // Deterministic weekly rotation bucket based on ISO week-ish approximation
  const d = new Date();
  const yearStart = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d.getTime() - yearStart.getTime()) / (24 * 3600 * 1000));
  const week = Math.floor(days / 7) + 1;
  const buckets = ['Flights', 'Hotels', 'Cruise', 'Offers'];
  return buckets[week % buckets.length];
}

test.describe('Reserval weekly guest audit (EN + AR)', () => {
  test('Must-not-break first, then weekly rotation feature', async ({ page }) => {
    ensureDirs();

    const nextId = makeIdFactory();
    const dateFound = cairoTodayDDMMYYYY();
    const device: NotionRow['Device / Platform'] = 'D Web';
    const issues: NotionRow[] = [];

    async function captureBug(args: {
      lang: 'EN' | 'AR';
      priority: NotionRow['Priority'];
      url: string;
      description: string;
      recommendation: string;
      repeated?: NotionRow['Repeated'];
      steps: string[];
      expected: string;
      actual: string;
      screenshotInstruction: string;
      extraNotes?: string;
    }) {
      const id = nextId();
      const fileName = `${id}.png`;
      const filePath = path.join(SCREENSHOTS_DIR, fileName);

      await page.screenshot({ path: filePath, fullPage: true }).catch(() => {});

      const notes = [
        `Language: ${args.lang}.`,
        `Steps: ${args.steps.join(' ')}`,
        `Expected: ${args.expected}`,
        `Actual: ${args.actual}`,
        `Screenshot: ${args.screenshotInstruction} Include URL bar.`,
        args.extraNotes ? `Extra: ${args.extraNotes}` : '',
        `Local file: ${fileName}`,
      ].filter(Boolean).join(' ');

      issues.push({
        'No.': id,
        'Screenshot (Files & media, leave empty)': '',
        'Bug Link (Repro URL)': args.url,
        'Repeated': args.repeated ?? 'No',
        'Priority': args.priority,
        'Device / Platform': device,
        'Description of Issue': args.description,
        'Recommendation / Fix Suggestion': args.recommendation,
        'Status': 'Open',
        'Date Found': dateFound,
        'Notes / Validation Comments': notes,
      });
    }

    async function mustNotBreakFlow(lang: 'EN' | 'AR') {
      // Home
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2000);

      if (lang === 'AR') {
        await switchToArabic(page);
        const rtl = await isRTL(page);
        if (!rtl) {
          await captureBug({
            lang,
            priority: 'Urgent',
            url: page.url(),
            description: 'Arabic (RTL) did not apply after switching to Arabic.',
            recommendation: 'Ensure Arabic toggle sets locale and RTL direction consistently on document root.',
            steps: ['Open home page.', 'Click العربية in header.'],
            expected: 'UI switches to Arabic and RTL layout applies.',
            actual: 'RTL not applied, layout remains LTR or language does not switch.',
            screenshotInstruction: 'Capture header language toggle state plus hero section layout showing direction.',
          });
        }
      } else {
        await switchToEnglish(page);
      }

      // Navigation: verify header has at least one primary link and logo
      const logoVisible = await page.locator('img[alt*="reserval" i], img[src*="logo" i]').first().isVisible().catch(() => false);
      if (!logoVisible) {
        await captureBug({
          lang,
          priority: 'Urgent',
          url: page.url(),
          description: 'Header logo not visible, navigation may be broken.',
          recommendation: 'Check header layout CSS and asset loading, verify CDN and caching.',
          steps: ['Open home page as guest.'],
          expected: 'Header logo and primary navigation are visible.',
          actual: 'Logo not visible or header appears broken.',
          screenshotInstruction: 'Capture full top header and above-the-fold area.',
        });
      }

      // Trust pages: Contact and Terms/Policies pages should load
      const trustPaths = ['/contact-us', '/terms', '/privacy-policy', '/about-us'];
      for (const p of trustPaths) {
        const resp = await page.goto(p, { waitUntil: 'domcontentloaded' }).catch(() => null);
        await page.waitForTimeout(1200);
        const status = resp?.status() ?? 0;
        if (!(status >= 200 && status < 400)) {
          await captureBug({
            lang,
            priority: 'Moderate',
            url: page.url(),
            description: `Trust page failed to load (${p}) with status ${status}.`,
            recommendation: 'Verify routing, CDN rules, and server response for this path.',
            steps: [`Open ${p} directly as guest.`],
            expected: 'Page loads with correct content.',
            actual: `Navigation returned HTTP ${status} or blank/unrendered content.`,
            screenshotInstruction: 'Capture full page including any error banners and the URL bar.',
          });
        }
      }

      // Core error/empty states sanity: open a deliberately odd URL and ensure a controlled 404/empty state
      const odd = '/this-page-should-not-exist-xyz';
      await page.goto(odd, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await page.waitForTimeout(1200);
      const hasSomeText = (await page.locator('body').innerText().catch(() => '')).trim().length > 0;
      if (!hasSomeText) {
        await captureBug({
          lang,
          priority: 'Low',
          url: page.url(),
          description: 'Error/empty state may be blank for unknown routes.',
          recommendation: 'Add a branded 404 with recovery links (home, search) in both EN and AR.',
          steps: [`Open ${odd} directly.`],
          expected: 'A friendly 404 or error page with navigation options.',
          actual: 'Page appears blank or unhelpful.',
          screenshotInstruction: 'Capture full page, show lack of content and URL bar.',
        });
      }
    }

    async function weeklyRotationFeature(lang: 'EN' | 'AR') {
      const feature = weekRotationTag();

      // Lightweight rotation that avoids payments and deep assumptions about selectors.
      // It flags issues only on clear breakage (navigation failure, crashes, blank pages).
      const targets: Record<string, string> = {
        Flights: '/flights',
        Hotels: '/hotels',
        Cruise: '/cruise',
        Offers: '/travel-offers',
      };

      const path = targets[feature] ?? '/explore';
      await page.goto(path, { waitUntil: 'domcontentloaded' }).catch(() => null);
      await page.waitForTimeout(2000);

      const bodyText = (await page.locator('body').innerText().catch(() => '')).trim();
      if (bodyText.length < 50) {
        await captureBug({
          lang,
          priority: 'Moderate',
          url: page.url(),
          description: `Weekly rotation page looks blank or unrendered: ${feature} (${path}).`,
          recommendation: 'Check client-side rendering, API calls, and errors in console/network for this section.',
          steps: [`Open ${path} as guest.`],
          expected: `A usable ${feature} entry page with search entry points.`,
          actual: 'Content appears too sparse or blank, possible render/API failure.',
          screenshotInstruction: 'Capture full page including any loaders stuck, empty cards, and URL bar.',
        });
      }
    }

    // Must-not-break first (EN then AR)
    await mustNotBreakFlow('EN');
    await mustNotBreakFlow('AR');

    // Weekly rotation feature (EN then AR)
    await weeklyRotationFeature('EN');
    await weeklyRotationFeature('AR');

    // Exports
    const outTSV = path.join(ARTIFACTS_DIR, 'notion-import.tsv');
    const outMD = path.join(ARTIFACTS_DIR, 'weekly-report.md');
    writeTSV(issues, outTSV);
    writeMarkdownTable(issues, outMD);

    // Optionally fail build if any urgent issues:
    // expect(issues.filter(i => i['Priority'] === 'Urgent').length).toBe(0);
  });
});
