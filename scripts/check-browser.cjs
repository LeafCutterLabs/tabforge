const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');
const checkInteractions = require('../tests/browser-interactions.cjs');
const checkLayout = require('../tests/browser-layout.cjs');

const root = path.resolve(__dirname, '..');
const outputDir = path.join(root, 'output', 'playwright');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

async function main() {
    await fs.mkdir(outputDir, { recursive: true });
    const server = http.createServer(async (request, response) => {
        try {
            const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
            const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
            if (!file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
            const data = await fs.readFile(file);
            response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
            response.end(data);
        } catch { response.writeHead(404).end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    let browser;
    try {
        browser = await chromium.launch({ headless: !process.env.HEADED });
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const externalRequests = [];
        await context.route('**/*', route => {
            const url = new URL(route.request().url());
            if (url.protocol === 'file:' || url.hostname === '127.0.0.1') return route.continue();
            externalRequests.push(url.href);
            return route.abort();
        });
        const page = await context.newPage();
        await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
        await page.waitForSelector('.outline-row');
        assert.equal(await page.evaluate(() => typeof JSZip), 'function', 'ZIP support loads from a local file');
        assert.ok(await page.locator('svg.lucide').count(), 'local icon bundle initializes');
        assert.equal(await page.locator('i[data-lucide]').count(), 0, 'every icon is bundled');
        const localStyle = await page.locator('body').evaluate(body => getComputedStyle(body).display);
        assert.equal(localStyle, 'flex', 'compiled utilities work when opened directly');
        assert.deepEqual(await page.locator('.hidden').evaluateAll(elements => elements
            .filter(element => getComputedStyle(element).display !== 'none').map(element => element.id)), [], 'visibility toggles override component display styles');
        await page.goto(`http://127.0.0.1:${server.address().port}/`);
        const results = await checkInteractions(page, { outputDir });
        const compactLayout = await checkLayout(page, { outputDir });
        assert.deepEqual(externalRequests, [], 'the app needs no external asset requests');
        console.log(JSON.stringify({ directFileOpening: 'passed', externalRequests, ...results, compactLayout }, null, 2));
    } finally {
        await browser?.close();
        await new Promise(resolve => server.close(resolve));
    }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
