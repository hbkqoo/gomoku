/* 連珠 26 種標準開局定式資料。
   座標為相對天元 (0,0) 的偏移 (dx,dy)，x 向右為正、y 向下為正；棋盤中心為 (7,7)。
   三手：黑1(天元) → 白2 → 黑3。type 'direct'＝白2 正交相鄰、'indirect'＝白2 對角相鄰。
   eval 為連珠理論（含禁手規則、雙方最佳應對）下的定性評價，出自英文維基百科 Renju
   opening pattern 條目；座標取自 Wikimedia Commons 官方開局圖之像素實測並經對稱推導驗算。
   注意：eval 是「連珠標準規則」下的理論結論，與本遊戲一般對局（可關禁手）的實戰勝負無必然關係，
   僅作為認識棋形與命名的參考。 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.GomokuOpenings = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // 直接型白2 固定 (0,-1)；間接型白2 固定 (1,-1)
  const D = [0, -1], I = [1, -1];
  const list = [
    // ---- 直接型（白2 正上方）----
    { name: '寒星', jp: 'Kansei', type: 'direct', no: 1, b3: [0, -2], ev: '黑必勝' },
    { name: '溪月', jp: 'Keigetsu', type: 'direct', no: 2, b3: [1, -2], ev: '黑必勝' },
    { name: '疏星', jp: 'Sosei', type: 'direct', no: 3, b3: [2, -2], ev: '大致均勢（白略優）' },
    { name: '花月', jp: 'Kagetsu', type: 'direct', no: 4, b3: [1, -1], ev: '黑必勝', star: true,
      note: '最經典、最常見的入門開局之一。黑3 緊貼白2 斜角，形成緊湊的攻擊形。' },
    { name: '殘月', jp: 'Zangetsu', type: 'direct', no: 5, b3: [2, -1], ev: '黑優勢' },
    { name: '雨月', jp: 'Ugetsu', type: 'direct', no: 6, b3: [1, 0], ev: '黑必勝' },
    { name: '金星', jp: 'Kinsei', type: 'direct', no: 7, b3: [2, 0], ev: '黑必勝' },
    { name: '松月', jp: 'Shogetsu', type: 'direct', no: 8, b3: [0, 1], ev: '黑略優' },
    { name: '丘月', jp: 'Kyugetsu', type: 'direct', no: 9, b3: [1, 1], ev: '黑略優' },
    { name: '新月', jp: 'Shingetsu', type: 'direct', no: 10, b3: [2, 1], ev: '黑優勢' },
    { name: '瑞星', jp: 'Zuisei', type: 'direct', no: 11, b3: [0, 2], ev: '大致均勢（黑略優）' },
    { name: '山月', jp: 'Sangetsu', type: 'direct', no: 12, b3: [1, 2], ev: '黑優勢' },
    { name: '遊星', jp: 'Yusei', type: 'direct', no: 13, b3: [2, 2], ev: '白必勝', note: '唯一白必勝的直接開局。' },
    // ---- 間接型（白2 右上方對角）----
    { name: '長星', jp: 'Chosei', type: 'indirect', no: 1, b3: [2, -2], ev: '大致均勢（白略優）' },
    { name: '峽月', jp: 'Kyogetsu', type: 'indirect', no: 2, b3: [2, -1], ev: '黑必勝' },
    { name: '恆星', jp: 'Kosei', type: 'indirect', no: 3, b3: [2, 0], ev: '黑必勝' },
    { name: '水月', jp: 'Suigetsu', type: 'indirect', no: 4, b3: [2, 1], ev: '黑必勝' },
    { name: '流星', jp: 'Ryusei', type: 'indirect', no: 5, b3: [2, 2], ev: '白略優' },
    { name: '雲月', jp: 'Ungetsu', type: 'indirect', no: 6, b3: [1, 0], ev: '黑必勝' },
    { name: '浦月', jp: 'Uragetsu', type: 'indirect', no: 7, b3: [1, 1], ev: '黑必勝', star: true,
      note: '經典對稱形：白2 與黑3 同列、對稱分居黑1 上下，展開成扇形。' },
    { name: '嵐月', jp: 'Rangetsu', type: 'indirect', no: 8, b3: [1, 2], ev: '黑必勝' },
    { name: '銀月', jp: 'Gingetsu', type: 'indirect', no: 9, b3: [0, 1], ev: '黑優勢' },
    { name: '明星', jp: 'Myojo', type: 'indirect', no: 10, b3: [0, 2], ev: '黑必勝' },
    { name: '斜月', jp: 'Shagetsu', type: 'indirect', no: 11, b3: [-1, 1], ev: '黑略優' },
    { name: '名月', jp: 'Meigetsu', type: 'indirect', no: 12, b3: [-1, 2], ev: '黑優勢' },
    { name: '彗星', jp: 'Suisei', type: 'indirect', no: 13, b3: [-2, 2], ev: '白必勝', note: '唯一白必勝的間接開局。' },
  ];
  // 補上完整三手座標（相對天元）
  for (const o of list) {
    o.moves = [[0, 0], o.type === 'direct' ? D : I, o.b3];
    o.typeLabel = o.type === 'direct' ? '直接' : '間接';
  }
  return list;
});
