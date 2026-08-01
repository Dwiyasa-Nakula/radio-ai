import assert from 'node:assert/strict';
import test from 'node:test';
import {
  JMA_REGIONAL_TARGETS,
  parseJmaRegionalForecast,
} from '../../../src/app/lib/segments/weatherJapan';

test('regional parser aligns evening forecasts with the next available temperature day', () => {
  const data = [{
    reportDatetime: '2026-07-29T17:00:00+09:00',
    timeSeries: [
      {
        timeDefines: ['2026-07-29T17:00:00+09:00', '2026-07-30T00:00:00+09:00'],
        areas: [{
          area: { name: '東京地方' },
          weathers: ['晴れ', 'くもり　時々　雨'],
        }],
      },
      {
        timeDefines: ['2026-07-30T12:00:00+09:00', '2026-07-30T18:00:00+09:00'],
        areas: [{ area: { name: '東京地方' }, pops: ['30', '40'] }],
      },
      {
        timeDefines: ['2026-07-30T00:00:00+09:00', '2026-07-30T09:00:00+09:00'],
        areas: [{ area: { name: '東京' }, temps: ['20', '31'] }],
      },
    ],
  }];

  const forecast = parseJmaRegionalForecast(
    data,
    { officeCode: '130000', region: '関東', weatherAreaHint: '東京', temperatureAreaHint: '東京' },
    new Date('2026-07-29T09:00:00Z')
  );

  assert.equal(forecast.forecastDate, '2026-07-30');
  assert.equal(forecast.todayWeather, 'くもり　時々　雨');
  assert.equal(forecast.todayTempMin, '20');
  assert.equal(forecast.todayTempMax, '31');
  assert.equal(forecast.eveningRainChance, '40');
});

test('nationwide targets cover every major region with independent JMA offices', () => {
  assert.deepEqual(
    JMA_REGIONAL_TARGETS.map((target) => target.region),
    ['北海道', '東北', '関東', '甲信越', '北陸', '東海', '近畿', '中国', '四国', '九州北部', '九州南部', '沖縄']
  );
  assert.equal(new Set(JMA_REGIONAL_TARGETS.map((target) => target.officeCode)).size, JMA_REGIONAL_TARGETS.length);
});
