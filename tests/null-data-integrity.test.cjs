const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const helpers = import(pathToFileURL(path.join(root, 'frontend/src/utils/numbers.js')));
const cases = [
  [null, null], [undefined, null], ['', null], ['   ', null],
  [0, 0], ['0', 0], [72500, 72500], ['72500', 72500],
  [-1250, -1250], ['-1250', -1250], [2.75, 2.75],
  [NaN, null], [Infinity, null], ['invalid', null],
  ['72,500', null], ['7 2500', null], [false, null], [[], null], [{}, null]
];

// Evaluate the production functions without starting Express or making API calls.
function backend() {
  const source = read('server.js');
  const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end));
  const context = vm.createContext({
    buildGeminiPrompt: () => '',
    callGeminiPromptWithRetry: async () => ({ analysis: {} })
  });
  vm.runInContext(
    section('const parseNumber =', 'const validateSymbol =') +
    section('const calculateRiskReward =', 'const assessLatestNews =') +
    section('const analyzeStockWithGemini =', 'const buildRecommendationGeminiPrompt =') +
    '\nthis.analyze = analyzeStockWithGemini;', context
  );
  return context;
}

async function frontend(file, marketContext = {}) {
  const source = read(file);
  const context = vm.createContext({
    ...await helpers,
    // Synthetic fixture data is confined to this test; no real API calls.
    fetch: async () => ({ ok: true, json: async () => ({ marketContext }) })
  });
  vm.runInContext(source.slice(source.indexOf('const API_BASE_URL'),
    source.indexOf('export default function App')) +
    '\nthis.service = new RealStockBackendService();' +
    '\nthis.formatters = [formatKRW, formatNumberWithUnit, formatTradingValue];', context);
  return { source, context };
}

test('missing and valid numeric inputs remain distinct', async () => {
  const { toNullableNumber, hasNumber } = await helpers;
  for (const [input, expected] of cases) {
    assert.equal(toNullableNumber(input), expected);
    assert.equal(hasNumber(input), expected !== null);
  }
});

test('AI price and risk response mappings preserve missing values and zero', async () => {
  const { analyze } = backend();
  for (const [input, expected] of cases) {
    const result = await analyze({ quote: {}, news: [], strategy: {
      entryPrice: input, takeProfitPrice: input, stopLossPrice: input,
      riskRewardRatio: input, entryToStopRate: input,
      riskRewardAssessment: { available: true }
    } });
    for (const field of ['entryPrice', 'targetPrice', 'stopLossPrice', 'riskRewardRatio']) {
      assert.equal(result.analysis.strategyExplanation[field], expected, field);
    }
    assert.equal(result.riskReward.entryRiskPercent, expected === null ? null : Math.abs(expected));
    assert.equal(result.riskReward.rewardGreaterThanRisk, expected === null ? null : expected >= 1);
  }
});

test('ordinary AI price and risk calculations are unchanged', async () => {
  const result = await backend().analyze({ quote: {}, news: [], strategy: {
    currentPrice: 10000, entryPrice: 9500, takeProfitPrice: 12000,
    stopLossPrice: 9000, riskRewardRatio: 5, entryToStopRate: -5.26,
    riskRewardAssessment: { available: true }
  } });
  assert.equal(result.analysis.strategyExplanation.entryPrice, 9500);
  assert.equal(result.analysis.strategyExplanation.targetPrice, 12000);
  assert.equal(result.analysis.strategyExplanation.stopLossPrice, 9000);
  assert.equal(result.riskReward.currentRiskRewardRatio, 2);
  assert.equal(result.riskReward.entryRiskPercent, 5.26);
});

test('supply sum requires both values, including genuine zero', async () => {
  for (const [input, expected] of cases) {
    for (const missingSide of ['foreignerNet', 'institutionNet']) {
      const market = { foreignerNet: 50, institutionNet: 50, [missingSide]: input };
      const { context } = await frontend('frontend/src/App.jsx', market);
      const result = await context.service.getStockStrategy('TEST_ONLY');
      assert.equal(result[missingSide], expected);
      assert.equal(result.netSupplyTotal, expected === null ? null : expected + 50);
    }
  }
  const { context } = await frontend('frontend/src/App.jsx', { foreignerNet: null, institutionNet: null });
  assert.equal((await context.service.getStockStrategy('TEST_ONLY')).netSupplyTotal, null);
});

for (const file of ['frontend/src/App.jsx']) {
  test(`${file}: price/supply/value formatters preserve missing and normal values`, async () => {
    const { context } = await frontend(file);
    for (const format of context.formatters) {
      for (const input of [null, undefined, '', '   ', NaN, Infinity]) {
        assert.equal(format(input), '데이터 없음');
      }
      assert.notEqual(format(0), '데이터 없음');
      assert.equal(format(0), format('0'));
      assert.equal(format(72500), format('72500'));
    }
    assert.equal(context.formatters[0](72500), '72,500원');
    assert.equal(context.formatters[1](-1250, '주'), '-1,250주');
  });

}

// Each expected UI location must remain covered, even if its guard changes.
const riskDisplays = [
  ['item.riskReward.currentUpsidePercent', 1],
  ['item.riskReward.currentDownsidePercent', 1],
  ['item.riskReward.currentRiskRewardRatio', 1],
  ['item.riskReward.entryRiskRewardRatio', 1],
  ['strategyData.currentToEntryRate', 1],
  ['strategyData.riskRewardRatio', 2],
  ['strategyData.entryToTargetRate', 1],
  ['strategyData.entryToStopRate', 1]
];

for (const [field, expectedCount] of riskDisplays) {
  test(`UI ${field}: missing values never display 0.00 (${expectedCount} locations)`, async () => {
    const { source, context } = await frontend('frontend/src/App.jsx');
    // Match actual conditional expressions independently of the numeric guard's name.
    const expressions = [...source.matchAll(/\{([^{}]+?\?\s*`[^`]*`\s*:\s*'데이터 없음')\}/g)]
      .map(([, expression]) => expression)
      .filter((expression) => expression.includes(`Number(${field})`));
    assert.equal(expressions.length, expectedCount, `Missing or duplicate display: ${field}`);
    for (const [input, expected] of cases) {
      const fields = new Proxy({}, { get: () => input });
      context.item = { riskReward: fields };
      context.strategyData = fields;
      for (const expression of expressions) {
        const display = vm.runInContext(expression, context);
        if (expected === null) assert.equal(display, '데이터 없음');
        else assert.ok(display.includes(expected.toFixed(2)), display);
      }
    }
  });
}

for (const [inputField, outputField] of [
  ['entryPrice', 'entryPrice'],
  ['takeProfitPrice', 'targetPrice'],
  ['stopLossPrice', 'stopLossPrice']
]) {
  test(`AI ${outputField}: null remains null`, async () => {
    const result = await backend().analyze({ quote: {}, news: [], strategy: {
      entryPrice: 9500, takeProfitPrice: 12000, stopLossPrice: 9000,
      [inputField]: null
    } });
    assert.equal(result.analysis.strategyExplanation[outputField], null);
  });
}

for (const [label, foreignerNet, institutionNet, expected] of [
  ['missing foreigner', null, 100, null],
  ['missing institution', 100, null, null],
  ['both numeric', 1200, -200, 1000],
  ['zero is valid', 0, 0, 0],
  ['string zero is valid', '0', '0', 0]
]) {
  test(`supply total: ${label}`, async () => {
    const { context } = await frontend('frontend/src/App.jsx', { foreignerNet, institutionNet });
    const result = await context.service.getStockStrategy('TEST_ONLY');
    assert.equal(result.netSupplyTotal, expected);
  });
}

for (const [label, input] of [
  ['comma string', '72,500'], ['internal whitespace', '7 2500'],
  ['boolean', false], ['array', []], ['object', {}]
]) {
  test(`reject ${label} in frontend helper and AI response`, async () => {
    const { toNullableNumber, hasNumber } = await helpers;
    assert.equal(toNullableNumber(input), null);
    assert.equal(hasNumber(input), false);
    const result = await backend().analyze({ quote: {}, news: [], strategy: {
      entryPrice: input, takeProfitPrice: input, stopLossPrice: input,
      riskRewardRatio: input, entryToStopRate: input,
      riskRewardAssessment: { available: true }
    } });
    for (const field of ['entryPrice', 'targetPrice', 'stopLossPrice', 'riskRewardRatio']) {
      assert.equal(result.analysis.strategyExplanation[field], null);
    }
    assert.equal(result.riskReward.entryRiskPercent, null);
    assert.equal(result.riskReward.rewardGreaterThanRisk, null);
  });
}
