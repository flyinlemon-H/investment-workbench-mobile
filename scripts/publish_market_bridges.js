'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ALLOWLIST = Object.freeze([
  'data/market_data_bridge.js',
  'data/market_task_status_bridge.js'
]);
const DEFAULT_REMOTE = 'https://github.com/flyinlemon-H/investment-workbench-mobile.git';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SYMBOL_PATTERN = /^\d{4,6}\.(?:HK|SS|SZ)$/;

function fail(message) {
  throw new Error(message);
}

function runGit(args, options = {}) {
  return execFileSync(options.gitBinary || 'git', args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: options.env || process.env,
    maxBuffer: 32 * 1024 * 1024
  }).trim();
}

function readAssignment(content, globalName) {
  const escaped = globalName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = content.match(new RegExp(`^\\s*window\\.${escaped}\\s*=\\s*(\\{.*\\})\\s*;\\s*$`, 's'));
  if (!match) fail(`Invalid ${globalName} global assignment.`);
  try {
    return JSON.parse(match[1]);
  } catch (error) {
    fail(`Invalid ${globalName} JSON: ${error.message}`);
  }
}

function isoTimestamp(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(Date.parse(value))) {
    fail(`${field} must be a valid ISO timestamp.`);
  }
  return value;
}

function finiteNumber(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`${field} must be a finite number.`);
}

function validateBridgeContent(content, { minimumSymbols = 19 } = {}) {
  const bridge = readAssignment(content, 'MARKET_DATA_BRIDGE');
  isoTimestamp(bridge.generatedAt, 'generatedAt');
  if (!Array.isArray(bridge.stocks) || bridge.stocks.length < minimumSymbols) {
    fail(`Symbol collapse guard failed: expected at least ${minimumSymbols}, received ${bridge.stocks?.length || 0}.`);
  }

  const symbols = new Set();
  const lastDates = new Map();
  for (const stock of bridge.stocks) {
    const symbol = String(stock?.symbol || '').trim().toUpperCase();
    if (!SYMBOL_PATTERN.test(symbol)) fail(`Invalid canonical symbol: ${symbol || '<empty>'}.`);
    if (symbols.has(symbol)) fail(`Duplicate canonical symbol: ${symbol}.`);
    symbols.add(symbol);

    if (!Array.isArray(stock.priceHistory) || stock.priceHistory.length === 0) {
      fail(`${symbol} has empty priceHistory.`);
    }
    let previousDate = '';
    for (const [index, bar] of stock.priceHistory.entries()) {
      if (!DATE_PATTERN.test(String(bar?.date || ''))) fail(`${symbol} priceHistory[${index}] has an invalid date.`);
      if (previousDate && bar.date <= previousDate) fail(`${symbol} priceHistory is not strictly date-ascending.`);
      previousDate = bar.date;
      for (const field of ['open', 'high', 'low', 'close', 'volume']) finiteNumber(bar[field], `${symbol}.${bar.date}.${field}`);
      if (bar.is_complete_bar !== true) fail(`${symbol}.${bar.date} is not a complete daily bar.`);
    }
    const lastDate = stock.priceHistory.at(-1).date;
    if (stock.marketDataFreshness?.last_trade_date !== lastDate) {
      fail(`${symbol} freshness date conflicts with priceHistory (${stock.marketDataFreshness?.last_trade_date || '<empty>'} != ${lastDate}).`);
    }
    if (stock.technicalIndicators?.last_trade_date !== lastDate) {
      fail(`${symbol} indicator date conflicts with priceHistory (${stock.technicalIndicators?.last_trade_date || '<empty>'} != ${lastDate}).`);
    }
    lastDates.set(symbol, lastDate);
  }

  return {
    bridge,
    symbolCount: symbols.size,
    lastDates,
    latestDate: [...lastDates.values()].sort().at(-1)
  };
}

function validateStatusContent(content, bridgeSummary) {
  const status = readAssignment(content, 'MARKET_TASK_STATUS');
  isoTimestamp(status.generated_at, 'status.generated_at');
  if (status.task_exists !== true || status.enabled !== true) fail('Scheduled task status is not enabled/available.');
  if (status.last_task_result !== 0) fail(`Scheduled task result is not successful: ${status.last_task_result}.`);
  if (status.latest_data_trade_date !== bridgeSummary.latestDate) {
    fail(`Task status date conflicts with bridge (${status.latest_data_trade_date || '<empty>'} != ${bridgeSummary.latestDate}).`);
  }
  const latest = status.latest_run;
  if (!latest || latest.status !== 'success' || latest.exit_code !== 0 || latest.bridge_status !== 'success' || latest.workbench_delivery_status !== 'success') {
    fail('Latest market update/delivery status is not fully successful.');
  }
  if (latest.delivered_stock_count !== bridgeSummary.symbolCount) fail('Delivered stock count conflicts with bridge.');
  if (latest.delivered_generated_at !== bridgeSummary.bridge.generatedAt) fail('Delivered generatedAt conflicts with bridge.');
  if (latest.latest_trade_date !== bridgeSummary.latestDate) fail('Latest run trade date conflicts with bridge.');
  return status;
}

function remoteHead(remote, branch, gitOptions) {
  const output = runGit(['ls-remote', '--heads', remote, `refs/heads/${branch}`], gitOptions);
  const match = output.match(/^([0-9a-f]{40})\s+refs\/heads\/.+$/);
  if (!match) fail(`Cannot resolve exactly one remote ${branch} head.`);
  return match[1];
}

function compareAgainstPublished(incoming, published) {
  if (incoming.symbolCount < published.symbolCount) {
    fail(`Symbol collapse guard failed against production: ${published.symbolCount} -> ${incoming.symbolCount}.`);
  }
  if (Date.parse(incoming.bridge.generatedAt) < Date.parse(published.bridge.generatedAt)) {
    fail('Incoming generatedAt is older than production.');
  }
  for (const [symbol, publishedDate] of published.lastDates) {
    const incomingDate = incoming.lastDates.get(symbol);
    if (!incomingDate) fail(`Incoming bridge lost production symbol ${symbol}.`);
    if (incomingDate < publishedDate) fail(`Incoming ${symbol} date regressed (${publishedDate} -> ${incomingDate}).`);
  }
}

function publishMarketBridges(options) {
  const sourceDataPath = path.resolve(options.sourceDataPath);
  const sourceStatusPath = path.resolve(options.sourceStatusPath);
  const remote = options.remote || DEFAULT_REMOTE;
  const branch = options.branch || 'main';
  const minimumSymbols = options.minimumSymbols ?? 19;
  const gitOptions = { gitBinary: options.gitBinary, env: options.env };
  const dataContent = fs.readFileSync(sourceDataPath, 'utf8');
  const statusContent = fs.readFileSync(sourceStatusPath, 'utf8');
  const incoming = validateBridgeContent(dataContent, { minimumSymbols });
  validateStatusContent(statusContent, incoming);

  const expectedRemoteHead = remoteHead(remote, branch, gitOptions);
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'investment-workbench-market-publish-'));
  const clonePath = path.join(tempRoot, 'repo');
  try {
    runGit(['clone', '--quiet', '--no-tags', '--single-branch', '--branch', branch, remote, clonePath], gitOptions);
    const cloneGit = { ...gitOptions, cwd: clonePath };
    const clonedHead = runGit(['rev-parse', 'HEAD'], cloneGit);
    if (clonedHead !== expectedRemoteHead) fail('Remote main changed during clone; refusing to publish.');
    if (runGit(['status', '--porcelain'], cloneGit)) fail('Isolated publish clone is unexpectedly dirty.');

    const publishedDataPath = path.join(clonePath, ALLOWLIST[0]);
    const publishedStatusPath = path.join(clonePath, ALLOWLIST[1]);
    const publishedDataContent = fs.readFileSync(publishedDataPath, 'utf8');
    const published = validateBridgeContent(publishedDataContent, { minimumSymbols });
    compareAgainstPublished(incoming, published);

    if (dataContent.replace(/\r\n/g, '\n') === publishedDataContent.replace(/\r\n/g, '\n')) {
      return { status: 'no-change', remoteHead: expectedRemoteHead, latestDate: incoming.latestDate, symbolCount: incoming.symbolCount };
    }

    fs.copyFileSync(sourceDataPath, publishedDataPath);
    fs.copyFileSync(sourceStatusPath, publishedStatusPath);
    validateBridgeContent(fs.readFileSync(publishedDataPath, 'utf8'), { minimumSymbols });
    validateStatusContent(fs.readFileSync(publishedStatusPath, 'utf8'), incoming);

    const changedPaths = runGit(['diff', '--name-only'], cloneGit).split(/\r?\n/).filter(Boolean).map(item => item.replace(/\\/g, '/')).sort();
    const allowedSorted = [...ALLOWLIST].sort();
    if (!changedPaths.length || changedPaths.some(item => !allowedSorted.includes(item))) {
      fail(`Publish clone contains a non-allowlisted change: ${changedPaths.join(', ') || '<none>'}.`);
    }

    runGit(['add', '--', ...ALLOWLIST], cloneGit);
    const stagedPaths = runGit(['diff', '--cached', '--name-only'], cloneGit).split(/\r?\n/).filter(Boolean).sort();
    if (!stagedPaths.length || stagedPaths.some(item => !allowedSorted.includes(item))) {
      fail(`Staged file allowlist violation: ${stagedPaths.join(', ') || '<none>'}.`);
    }
    const unstaged = runGit(['diff', '--name-only'], cloneGit);
    if (unstaged) fail(`Unstaged changes appeared in publish clone: ${unstaged}.`);

    runGit(['config', 'user.name', options.committerName || 'Investment Workbench Market Publisher'], cloneGit);
    runGit(['config', 'user.email', options.committerEmail || 'market-publisher@investment-workbench.local'], cloneGit);
    runGit(['commit', '--quiet', '-m', `Daily market data update ${incoming.latestDate}`], cloneGit);
    const commit = runGit(['rev-parse', 'HEAD'], cloneGit);

    if (typeof options.beforePush === 'function') options.beforePush({ expectedRemoteHead, clonePath, commit });
    const currentRemoteHead = remoteHead(remote, branch, gitOptions);
    if (currentRemoteHead !== expectedRemoteHead) {
      fail(`Remote ${branch} diverged (${expectedRemoteHead} -> ${currentRemoteHead}); refusing to push.`);
    }
    if (!options.dryRun) runGit(['push', '--quiet', 'origin', `HEAD:refs/heads/${branch}`], cloneGit);
    return { status: options.dryRun ? 'dry-run' : 'published', previousHead: expectedRemoteHead, commit, latestDate: incoming.latestDate, symbolCount: incoming.symbolCount, stagedPaths };
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === '--dry-run') result.dryRun = true;
    else if (key.startsWith('--')) result[key.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = argv[++index];
    else fail(`Unknown argument: ${key}`);
  }
  for (const required of ['sourceDataPath', 'sourceStatusPath']) if (!result[required]) fail(`Missing --${required.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}.`);
  return result;
}

if (require.main === module) {
  try {
    const result = publishMarketBridges(parseArgs(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`marketPublishStatus: failed\nmarketPublishError: ${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { ALLOWLIST, publishMarketBridges, readAssignment, validateBridgeContent, validateStatusContent };
