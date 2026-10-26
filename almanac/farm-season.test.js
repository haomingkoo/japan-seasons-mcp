import { describe, expect, it } from 'vitest';
import { parseSeasonWindows } from './farm-season.js';

describe('parseSeasonWindows', () => {
  it('reads month thirds across the new year', () => {
    expect(parseSeasonWindows('営業：12月中旬～5月中旬 10:00～15:00')).toEqual([{ fruit: null, from: [12, 11], to: [5, 20] }]);
  });

  it('reads a bare month range and full-width digits', () => {
    expect(parseSeasonWindows('営業期間：火曜～日曜日まで 月曜休み ７～１１月 雨天中止')).toEqual([{ fruit: null, from: [7, 1], to: [11, 31] }]);
  });

  it('reads exact dates with years, weekdays and spaces', () => {
    expect(parseSeasonWindows('開園：期間：2020 年 12 月 12 日（土）～ 2021 年 5 月上旬まで')).toEqual([{ fruit: null, from: [12, 12], to: [5, 10] }]);
  });

  it('reads から as a range and 翌 for next year', () => {
    expect(parseSeasonWindows('営業時間：10：00～16：00（12月から5月）')).toEqual([{ fruit: null, from: [12, 1], to: [5, 31] }]);
    expect(parseSeasonWindows('開園：12月下旬～翌5月下旬')).toEqual([{ fruit: null, from: [12, 21], to: [5, 31] }]);
  });

  it('tags a window with the fruit named just before it', () => {
    expect(parseSeasonWindows('開園：いちご狩り 1月上旬～5月上旬、ブルーベリー狩り 6月下旬～8月中旬')).toEqual([
      { fruit: 'Strawberry', from: [1, 1], to: [5, 10] },
      { fruit: 'Blueberry', from: [6, 21], to: [8, 20] },
    ]);
  });

  it('reads a fruit named after the range and skips other activities', () => {
    expect(parseSeasonWindows('営業期間：11月～6月：イチゴ狩り、２～6月：フルーツトマト狩り、8～10月:ブドウ狩り')).toEqual([
      { fruit: 'Strawberry', from: [11, 1], to: [6, 31] },
      { fruit: 'Grape', from: [8, 1], to: [10, 31] },
    ]);
    expect(parseSeasonWindows('営業時間：●7月中旬～8月末 9：00～17：00 （ブルーベリー狩り）')).toEqual([{ fruit: 'Blueberry', from: [7, 11], to: [8, 31] }]);
  });

  it('reads month/day dates', () => {
    expect(parseSeasonWindows('営業期間：8/1～10月中旬')).toEqual([{ fruit: null, from: [8, 1], to: [10, 20] }]);
    expect(parseSeasonWindows('開園時間：１２月９～６月上旬 9：00～日没まで')).toEqual([{ fruit: null, from: [12, 9], to: [6, 10] }]);
  });

  it('ignores closures named after the range, shop hours and year-round business hours', () => {
    expect(parseSeasonWindows('営業：９月中旬～１２月中旬まで（期間内は無休、１月～８月は基本お休みです）')).toEqual([{ fruit: null, from: [9, 11], to: [12, 20] }]);
    expect(parseSeasonWindows('開園：5月～12月 販売（いちご・シャーベット）')).toEqual([]);
    expect(parseSeasonWindows('営業：1月4日～12月31日 8:00～17:00')).toEqual([]);
    expect(parseSeasonWindows('営業期間：ブルーベリー狩り：6月10日～8月中旬 カフェ：4月～10月')).toEqual([{ fruit: 'Blueberry', from: [6, 10], to: [8, 20] }]);
    expect(parseSeasonWindows('営業時間：道の駅【軽食】10：00～15：00 ※3月～11月無休')).toEqual([]);
  });

  it('prefers a fruit written straight after the range', () => {
    expect(parseSeasonWindows('営業時間：8～9月末 ぶどう狩り体験 11月中旬～3月みかん狩り')).toEqual([
      { fruit: 'Grape', from: [8, 1], to: [9, 31] },
      { fruit: 'Mandarin Orange', from: [11, 11], to: [3, 31] },
    ]);
  });

  it('ignores opening hours, closures and winter hours', () => {
    expect(parseSeasonWindows('営業：9時～16時30分 / その他：年中無休')).toEqual([]);
    expect(parseSeasonWindows('営業：8時～17時 / 休業：12月下旬～翌5月下旬、営業期間中は無休')).toEqual([]);
    expect(parseSeasonWindows('営業時間：12月～8月 / 10：00～15：30 9月～11月 / 休業')).toEqual([{ fruit: null, from: [12, 1], to: [8, 31] }]);
    expect(parseSeasonWindows('開園時間：午前9時～午後5時（冬期間11月～2月は午前9時～午後4時） / 休園日：12月29日～1月4日まで')).toEqual([]);
  });
});

