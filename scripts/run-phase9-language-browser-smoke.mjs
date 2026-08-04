#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import puppeteer from "puppeteer";

const BASE_URL = (process.env.ERP_SMOKE_BASE_URL || "http://127.0.0.1:5000").replace(/\/$/, "");
const USERNAME = process.env.ERP_SMOKE_USERNAME || "";
const PASSWORD = process.env.ERP_SMOKE_PASSWORD || "";
const AUTHENTICATED = Boolean(USERNAME && PASSWORD);
const TIMEOUT_MS = Number(process.env.ERP_SMOKE_TIMEOUT_MS || 45_000);
const OUTPUT_DIR = path.resolve(process.env.ERP_SMOKE_OUTPUT_DIR || "artifacts/phase9-language-browser");
const REQUIRE_EXACT_ROUTES = process.env.ERP_SMOKE_REQUIRE_EXACT_ROUTES === "1";
const STORAGE_KEY = "erp.application-language";
const COOKIE_NAME = "erp_application_language";
const LANGUAGE_EVENT = "erp:application-language-change";

const LANGUAGES = [
  { code: "en", direction: "ltr", name: "English" },
  { code: "ar", direction: "rtl", name: "Arabic" },
  { code: "fr", direction: "ltr", name: "French" },
];

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844, isMobile: true, hasTouch: true },
  { name: "tablet", width: 768, height: 1024, isMobile: true, hasTouch: true },
  { name: "desktop", width: 1440, height: 900, isMobile: false, hasTouch: false },
];

const DEFAULT_AUTHENTICATED_ROUTES = [
  "/tracking",
  "/transaction-journal",
  "/daybook",
  "/accounts",
  "/inventory",
  "/pos",
  "/vouchers",
];

const AUTHENTICATED_ROUTES = (process.env.ERP_SMOKE_ROUTES || DEFAULT_AUTHENTICATED_ROUTES.join(","))
  .split(",")
  .map((route) => route.trim())
  .filter(Boolean)
  .map((route) => (route.startsWith("/") ? route : `/${route}`));

const report = {
  baseUrl: BASE_URL,
  authenticatedRoutes: AUTHENTICATED,
  startedAt: new Date().toISOString(),
  cases: [],
  failures: [],
};

function fileSafe(value) {
  return value.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "root";
}

async function waitForSettledUi(page) {
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

async function applyLanguage(page, language) {
  await page.evaluate(
    ({ storageKey, cookieName, eventName, nextLanguage }) => {
      window.localStorage.setItem(storageKey, nextLanguage);
      document.cookie = `${cookieName}=${nextLanguage}; Path=/; Max-Age=31536000; SameSite=Lax`;
      window.dispatchEvent(new CustomEvent(eventName, { detail: nextLanguage }));
    },
    {
      storageKey: STORAGE_KEY,
      cookieName: COOKIE_NAME,
      eventName: LANGUAGE_EVENT,
      nextLanguage: language,
    },
  );
  await waitForSettledUi(page);
}

async function openRoute(page, route) {
  const response = await page.goto(`${BASE_URL}${route}`, {
    waitUntil: "domcontentloaded",
    timeout: TIMEOUT_MS,
  });
  await waitForSettledUi(page);
  return response?.status() ?? null;
}

async function login(page) {
  await page.waitForSelector('[data-testid="input-username"]', { visible: true, timeout: TIMEOUT_MS });
  await page.type('[data-testid="input-username"]', USERNAME);
  await page.type('[data-testid="input-password"]', PASSWORD);
  await page.click('[data-testid="button-login"]');
  await page.waitForFunction(
    () => window.location.pathname !== "/login" && Boolean(document.getElementById("main-content")),
    { timeout: TIMEOUT_MS },
  );
  await waitForSettledUi(page);
}

async function readPageState(page) {
  return page.evaluate(() => {
    const visibleRect = (element) => {
      if (!(element instanceof HTMLElement)) return null;
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return null;
      if (rect.width <= 0 || rect.height <= 0) return null;
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    };

    const ltrSelectors = [
      "[data-article-code]",
      "[data-container-number]",
      "[data-voucher-number]",
      "[data-currency-value]",
      'input[type="number"]',
      'input[inputmode="decimal"]',
      'input[inputmode="numeric"]',
      'input[type="email"]',
      'input[type="tel"]',
    ];
    const ltrViolations = [];
    for (const selector of ltrSelectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (!(element instanceof HTMLElement)) continue;
        if (window.getComputedStyle(element).direction !== "ltr") {
          ltrViolations.push(selector);
          break;
        }
      }
    }

    const root = document.documentElement;
    const body = document.body;
    return {
      path: `${window.location.pathname}${window.location.search}`,
      language: root.lang,
      direction: root.dir,
      bodyDirection: body?.dir || "",
      dataLanguage: root.dataset.applicationLanguage || "",
      dataDirection: root.dataset.applicationDirection || "",
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rootScrollWidth: root.scrollWidth,
      bodyScrollWidth: body?.scrollWidth || 0,
      horizontalOverflow: Math.max(root.scrollWidth, body?.scrollWidth || 0) > window.innerWidth + 2,
      loginButton: visibleRect(document.querySelector('[data-testid="button-login"]')),
      username: visibleRect(document.querySelector('[data-testid="input-username"]')),
      password: visibleRect(document.querySelector('[data-testid="input-password"]')),
      main: visibleRect(document.getElementById("main-content")),
      shell: visibleRect(document.querySelector('[data-slot="sidebar-wrapper"]')),
      recoveryOverlay: Boolean(document.getElementById("stale-asset-recovery")),
      ltrViolations,
    };
  });
}

function assertPage(state, expectedLanguage, expectedDirection, mode, label) {
  const failures = [];
  if (state.language !== expectedLanguage) {
    failures.push(`${label}: html lang is ${state.language || "missing"}, expected ${expectedLanguage}`);
  }
  if (state.direction !== expectedDirection || state.bodyDirection !== expectedDirection) {
    failures.push(
      `${label}: document direction is html=${state.direction || "missing"}, body=${state.bodyDirection || "missing"}, expected ${expectedDirection}`,
    );
  }
  if (state.dataLanguage !== expectedLanguage || state.dataDirection !== expectedDirection) {
    failures.push(
      `${label}: application direction metadata is ${state.dataLanguage || "missing"}/${state.dataDirection || "missing"}`,
    );
  }
  if (state.horizontalOverflow) {
    failures.push(`${label}: root horizontal overflow (${state.rootScrollWidth}px > ${state.viewport.width}px)`);
  }
  if (state.recoveryOverlay) failures.push(`${label}: stale-asset recovery overlay is visible`);
  if (state.ltrViolations.length > 0) {
    failures.push(`${label}: protected LTR selectors rendered RTL: ${state.ltrViolations.join(", ")}`);
  }

  if (mode === "login") {
    if (!state.username || !state.password || !state.loginButton) failures.push(`${label}: login controls are not all visible`);
    if (state.loginButton && state.loginButton.height < 40) {
      failures.push(`${label}: login touch target is only ${Math.round(state.loginButton.height)}px high`);
    }
  } else {
    if (!state.main) failures.push(`${label}: #main-content is missing or invisible`);
    if (!state.shell) failures.push(`${label}: application shell is missing or invisible`);
  }

  return failures;
}

async function capture(page, language, viewport, route) {
  const directory = path.join(OUTPUT_DIR, language, viewport);
  await fs.mkdir(directory, { recursive: true });
  const file = path.join(directory, `${fileSafe(route)}.png`);
  await page.screenshot({ path: file, fullPage: true });
  return path.relative(process.cwd(), file);
}

const browser = await puppeteer.launch({
  headless: true,
  args: ["--no-sandbox", "--disable-setuid-sandbox"],
});

try {
  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  for (const language of LANGUAGES) {
    for (const viewport of VIEWPORTS) {
      const page = await browser.newPage();
      const browserErrors = [];
      await page.setViewport(viewport);
      page.setDefaultTimeout(TIMEOUT_MS);
      page.setDefaultNavigationTimeout(TIMEOUT_MS);

      await page.evaluateOnNewDocument(
        ({ storageKey, nextLanguage }) => window.localStorage.setItem(storageKey, nextLanguage),
        { storageKey: STORAGE_KEY, nextLanguage: language.code },
      );

      page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));
      page.on("requestfailed", (request) => {
        if (!["document", "script", "stylesheet"].includes(request.resourceType())) return;
        if (!request.url().startsWith(BASE_URL)) return;
        const errorText = request.failure()?.errorText || "unknown";
        if (errorText !== "net::ERR_ABORTED") browserErrors.push(`${request.resourceType()} failed: ${errorText}`);
      });
      page.on("response", (response) => {
        if (!["document", "script", "stylesheet"].includes(response.request().resourceType())) return;
        if (response.url().startsWith(BASE_URL) && response.status() >= 400) {
          browserErrors.push(`${response.request().resourceType()} ${response.status()}: ${response.url()}`);
        }
      });

      try {
        const loginStatus = await openRoute(page, "/login");
        await applyLanguage(page, language.code);
        const loginState = await readPageState(page);
        const loginLabel = `${language.name} ${viewport.name} /login`;
        const loginFailures = assertPage(loginState, language.code, language.direction, "login", loginLabel);
        const loginScreenshot = await capture(page, language.code, viewport.name, "/login");
        report.cases.push({
          language: language.code,
          viewport: viewport.name,
          requestedRoute: "/login",
          status: loginStatus,
          state: loginState,
          screenshot: loginScreenshot,
          failures: loginFailures,
        });
        report.failures.push(...loginFailures);

        if (AUTHENTICATED) {
          await login(page);
          await applyLanguage(page, language.code);
          for (const route of AUTHENTICATED_ROUTES) {
            const status = await openRoute(page, route);
            await applyLanguage(page, language.code);
            const state = await readPageState(page);
            const label = `${language.name} ${viewport.name} ${route}`;
            const failures = assertPage(state, language.code, language.direction, "app", label);
            if (state.path.startsWith("/login")) failures.push(`${label}: authenticated session returned to login`);
            if (REQUIRE_EXACT_ROUTES && !state.path.startsWith(route)) {
              failures.push(`${label}: redirected to ${state.path}`);
            }
            const screenshot = await capture(page, language.code, viewport.name, route);
            report.cases.push({
              language: language.code,
              viewport: viewport.name,
              requestedRoute: route,
              status,
              state,
              screenshot,
              failures,
            });
            report.failures.push(...failures);
          }
        }
      } catch (error) {
        browserErrors.push(error instanceof Error ? error.message : String(error));
      } finally {
        report.failures.push(...browserErrors.map((error) => `${language.name} ${viewport.name}: ${error}`));
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}

report.finishedAt = new Date().toISOString();
report.failures = [...new Set(report.failures)];
await fs.writeFile(path.join(OUTPUT_DIR, "report.json"), `${JSON.stringify(report, null, 2)}\n`);

if (!AUTHENTICATED) {
  console.log("Authenticated route checks were skipped because ERP_SMOKE_USERNAME and ERP_SMOKE_PASSWORD were not provided.");
}

if (report.failures.length > 0) {
  console.error(`Phase 9 language browser smoke failed with ${report.failures.length} issue(s):`);
  for (const failure of report.failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Phase 9 language browser smoke passed for ${LANGUAGES.length} languages and ${VIEWPORTS.length} viewport profiles.`);
console.log(`Report: ${path.join(OUTPUT_DIR, "report.json")}`);
