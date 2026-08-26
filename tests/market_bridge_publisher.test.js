'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const { ALLOWLIST, publishMarketBridges, validateBridgeContent } = require('../scripts/publish_market_bridges');

const SYMBOLS = ['2899.HK', '1810.HK', '1357.HK', '601138.SS', '605499.SS', '603296.SS', '159300.SZ', '510980.SS', '159312.SZ', '159369.SZ', '512400.SS', '517520.SS', '588060.SS', '560780.SS', '601869.SS', '510880.SS', '159928.SZ', '2513.HK', '603800.SS'];
const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function bridge(date, symbols = SYMBOLS, generatedAt = `${date}T09:38:31.000000+00:00`) {
  return `window.MARKET_DATA_BRIDGE = ${JSON.stringify({ generatedAt, stocks: symbols.map((symbol, index) => ({
    symbol,
    priceHistory: [{ date, open: 10 + index, high: 11 + index, low: 9 + index, close: 10.5 + index, volume: 1000 + index, is_complete_bar: true }],
    marketDataFreshness: { last_trade_date: date },
    technicalIndicators: { last_trade_date: date }
  })) })};\n`;
}

function status(date, generatedAt = `${date}T09:38:31.000000+00:00`) {
  return `window.MARKET_TASK_STATUS = ${JSON.stringify({
    generated_at: `${date}T17:38:34+08:00`, task_exists: true, enabled: true, last_task_result: 0, latest_data_trade_date: date,
    latest_run: { status: 'success', exit_code: 0, bridge_status: 'success', workbench_delivery_status: 'success', delivered_stock_count: 19, delivered_generated_at: generatedAt, latest_trade_date: date }
  })};\n`;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, 'utf8');
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'market-publisher-test-'));
  const dev = path.join(root, 'dev');
  const remote = path.join(root, 'remote.git');
  fs.mkdirSync(dev);
  git(['init', '--quiet', '--initial-branch=main'], dev);
  git(['config', 'user.name', 'Test User'], dev);
  git(['config', 'user.email', 'test@example.invalid'], dev);
  write(path.join(dev, ALLOWLIST[0]), bridge('2026-08-13'));
  write(path.join(dev, ALLOWLIST[1]), status('2026-08-13', '2026-08-13T09:38:31.000000+00:00'));
  write(path.join(dev, 'src/unrelated.js'), 'module.exports = 1;\n');
  git(['add', '.'], dev);
  git(['commit', '--quiet', '-m', 'seed'], dev);
  git(['init', '--quiet', '--bare', remote], root);
  git(['remote', 'add', 'origin', remote], dev);
  git(['push', '--quiet', '-u', 'origin', 'main'], dev);
  return {
    root, dev, remote,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
    publish: options => publishMarketBridges({ sourceDataPath: path.join(dev, ALLOWLIST[0]), sourceStatusPath: path.join(dev, ALLOWLIST[1]), remote, ...options })
  };
}

function remoteHead(f) { return git(['rev-parse', 'refs/heads/main'], f.remote); }
function remoteFile(f, file) { return git(['show', `refs/heads/main:${file}`], f.remote); }

test('valid bridge publishes only allowlisted files and leaves unrelated dirty work untouched', () => {
  const f = fixture();
  try {
    write(path.join(f.dev, ALLOWLIST[0]), bridge('2026-08-14'));
    write(path.join(f.dev, ALLOWLIST[1]), status('2026-08-14'));
    write(path.join(f.dev, 'src/unrelated.js'), 'module.exports = 2;\n');
    const result = f.publish();
    assert.equal(result.status, 'published');
    assert.deepEqual(result.stagedPaths, [...ALLOWLIST].sort());
    assert.match(fs.readFileSync(path.join(f.dev, 'src/unrelated.js'), 'utf8'), /2/);
    assert.deepEqual(git(['show', '--pretty=', '--name-only', 'refs/heads/main'], f.remote).split(/\r?\n/).filter(Boolean).sort(), [...ALLOWLIST].sort());
  } finally { f.cleanup(); }
});

test('malformed bridge fails closed without a commit or push', () => {
  const f = fixture();
  try {
    const before = remoteHead(f);
    write(path.join(f.dev, ALLOWLIST[0]), 'window.MARKET_DATA_BRIDGE = nope;\n');
    assert.throws(() => f.publish(), /Invalid MARKET_DATA_BRIDGE/);
    assert.equal(remoteHead(f), before);
  } finally { f.cleanup(); }
});

test('symbol collapse from 19 to 2 fails closed', () => {
  const f = fixture();
  try {
    const before = remoteHead(f);
    write(path.join(f.dev, ALLOWLIST[0]), bridge('2026-08-14', SYMBOLS.slice(0, 2)));
    assert.throws(() => f.publish(), /Symbol collapse guard/);
    assert.equal(remoteHead(f), before);
  } finally { f.cleanup(); }
});

test('identical market bridge is a successful no-op even when status timestamp changes', () => {
  const f = fixture();
  try {
    const before = remoteHead(f);
    write(path.join(f.dev, ALLOWLIST[1]), status('2026-08-13', '2026-08-13T09:38:31.000000+00:00'));
    const result = f.publish();
    assert.equal(result.status, 'no-change');
    assert.equal(remoteHead(f), before);
  } finally { f.cleanup(); }
});

test('remote divergence immediately before push fails closed without force', () => {
  const f = fixture();
  try {
    write(path.join(f.dev, ALLOWLIST[0]), bridge('2026-08-14'));
    write(path.join(f.dev, ALLOWLIST[1]), status('2026-08-14'));
    assert.throws(() => f.publish({ beforePush: () => {
      const racer = path.join(f.root, 'racer');
      git(['clone', '--quiet', '--branch', 'main', f.remote, racer], f.root);
      git(['config', 'user.name', 'Race User'], racer);
      git(['config', 'user.email', 'race@example.invalid'], racer);
      write(path.join(racer, 'race.txt'), 'remote moved\n');
      git(['add', 'race.txt'], racer);
      git(['commit', '--quiet', '-m', 'race'], racer);
      git(['push', '--quiet', 'origin', 'main'], racer);
    } }), /diverged/);
    assert.equal(remoteFile(f, ALLOWLIST[0]).trim(), bridge('2026-08-13').trim());
  } finally { f.cleanup(); }
});

test('task status freshness conflict fails closed', () => {
  const f = fixture();
  try {
    const before = remoteHead(f);
    write(path.join(f.dev, ALLOWLIST[0]), bridge('2026-08-14'));
    write(path.join(f.dev, ALLOWLIST[1]), status('2026-08-13'));
    assert.throws(() => f.publish(), /status date conflicts/);
    assert.equal(remoteHead(f), before);
  } finally { f.cleanup(); }
});

test('priceHistory and canonical freshness must agree', () => {
  const content = bridge('2026-08-14').replace('"last_trade_date":"2026-08-14"', '"last_trade_date":"2026-08-13"');
  assert.throws(() => validateBridgeContent(content), /freshness date conflicts/);
});

test('dry run creates an allowlisted commit but does not move the remote', () => {
  const f = fixture();
  try {
    const before = remoteHead(f);
    write(path.join(f.dev, ALLOWLIST[0]), bridge('2026-08-14'));
    write(path.join(f.dev, ALLOWLIST[1]), status('2026-08-14'));
    const result = f.publish({ dryRun: true });
    assert.equal(result.status, 'dry-run');
    assert.deepEqual(result.stagedPaths, [...ALLOWLIST].sort());
    assert.equal(remoteHead(f), before);
  } finally { f.cleanup(); }
});

test('manual-run task history is accepted only for a no-push operational dry run', () => {
  const f = fixture();
  try {
    const before = remoteHead(f);
    write(path.join(f.dev, ALLOWLIST[0]), bridge('2026-08-14'));
    write(path.join(f.dev, ALLOWLIST[1]), status('2026-08-14').replace('"last_task_result":0','"last_task_result":1'));
    assert.throws(() => f.publish({ dryRun: true }), /Scheduled task result is not successful/);
    assert.throws(() => f.publish({ acceptManualRun: true }), /only with --dry-run/);
    const result = f.publish({ dryRun: true, acceptManualRun: true });
    assert.equal(result.status, 'dry-run');
    assert.equal(remoteHead(f), before);
  } finally { f.cleanup(); }
});
