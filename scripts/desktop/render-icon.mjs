#!/usr/bin/env node
/** Renders desktop/build/icon.html to the app icon (1024×1024, transparent corners): `node scripts/desktop/render-icon.mjs`. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const build = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "desktop", "build");
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 } });
await page.goto(`file://${path.join(build, "icon.html")}`);
await page.screenshot({ path: path.join(build, "icon.png"), omitBackground: true });
await browser.close();
console.log("desktop/build/icon.png");
