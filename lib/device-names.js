// 모델 코드 → 상품명(market name) 정적 매핑
// ro.product.marketname / ro.config.marketing_name 가 비어있을 때 fallback 으로 사용한다.
//
// 매칭 규칙:
//   1) 정확 일치 (예: "SM-S928N")
//   2) prefix 일치 (예: "SM-S928"  → S24 Ultra 계열 통합 매칭)
//      → 더 구체적인(긴) 키가 먼저 매칭되도록 키 길이 내림차순으로 시도한다.
//   3) Pixel/Xiaomi/OnePlus 등 비-삼성은 model 자체가 보통 상품명이라 그대로 노출.

const SAMSUNG = {
  // ===== Galaxy S 시리즈 =====
  'SM-S938': 'Galaxy S25 Ultra',
  'SM-S936': 'Galaxy S25+',
  'SM-S931': 'Galaxy S25',
  'SM-S928': 'Galaxy S24 Ultra',
  'SM-S926': 'Galaxy S24+',
  'SM-S921': 'Galaxy S24',
  'SM-S918': 'Galaxy S23 Ultra',
  'SM-S916': 'Galaxy S23+',
  'SM-S911': 'Galaxy S23',
  'SM-S711': 'Galaxy S23 FE',
  'SM-S908': 'Galaxy S22 Ultra',
  'SM-S906': 'Galaxy S22+',
  'SM-S901': 'Galaxy S22',
  'SM-G998': 'Galaxy S21 Ultra 5G',
  'SM-G996': 'Galaxy S21+ 5G',
  'SM-G991': 'Galaxy S21 5G',
  'SM-G990': 'Galaxy S21 FE 5G',
  'SM-G988': 'Galaxy S20 Ultra 5G',
  'SM-G986': 'Galaxy S20+ 5G',
  'SM-G981': 'Galaxy S20 5G',
  'SM-G980': 'Galaxy S20',
  'SM-G781': 'Galaxy S20 FE 5G',
  'SM-G770': 'Galaxy S10 Lite',
  'SM-G977': 'Galaxy S10 5G',
  'SM-G975': 'Galaxy S10+',
  'SM-G973': 'Galaxy S10',
  'SM-G970': 'Galaxy S10e',

  // ===== Galaxy Note =====
  'SM-N986': 'Galaxy Note20 Ultra 5G',
  'SM-N981': 'Galaxy Note20 5G',
  'SM-N980': 'Galaxy Note20',
  'SM-N976': 'Galaxy Note10+ 5G',
  'SM-N975': 'Galaxy Note10+',
  'SM-N971': 'Galaxy Note10 5G',
  'SM-N970': 'Galaxy Note10',

  // ===== Galaxy Z Fold / Flip =====
  'SM-F958': 'Galaxy Z Fold7',
  'SM-F956': 'Galaxy Z Fold6',
  'SM-F946': 'Galaxy Z Fold5',
  'SM-F936': 'Galaxy Z Fold4',
  'SM-F926': 'Galaxy Z Fold3 5G',
  'SM-F916': 'Galaxy Z Fold2 5G',
  'SM-F907': 'Galaxy Fold 5G',
  'SM-F900': 'Galaxy Fold',
  'SM-F761': 'Galaxy Z Flip7 FE',
  'SM-F766': 'Galaxy Z Flip7',
  'SM-F741': 'Galaxy Z Flip6',
  'SM-F731': 'Galaxy Z Flip5',
  'SM-F721': 'Galaxy Z Flip4',
  'SM-F711': 'Galaxy Z Flip3 5G',
  'SM-F707': 'Galaxy Z Flip 5G',
  'SM-F700': 'Galaxy Z Flip',

  // ===== Galaxy A 시리즈 =====
  'SM-A566': 'Galaxy A56 5G',
  'SM-A556': 'Galaxy A55 5G',
  'SM-A546': 'Galaxy A54 5G',
  'SM-A536': 'Galaxy A53 5G',
  'SM-A528': 'Galaxy A52s 5G',
  'SM-A526': 'Galaxy A52 5G',
  'SM-A525': 'Galaxy A52',
  'SM-A516': 'Galaxy A51 5G',
  'SM-A515': 'Galaxy A51',
  'SM-A366': 'Galaxy A36 5G',
  'SM-A356': 'Galaxy A35 5G',
  'SM-A346': 'Galaxy A34 5G',
  'SM-A336': 'Galaxy A33 5G',
  'SM-A326': 'Galaxy A32 5G',
  'SM-A325': 'Galaxy A32',
  'SM-A266': 'Galaxy A26 5G',
  'SM-A256': 'Galaxy A25 5G',
  'SM-A245': 'Galaxy A24',
  'SM-A236': 'Galaxy A23 5G',
  'SM-A235': 'Galaxy A23',
  'SM-A226': 'Galaxy A22 5G',
  'SM-A225': 'Galaxy A22',
  'SM-A166': 'Galaxy A16 5G',
  'SM-A156': 'Galaxy A15 5G',
  'SM-A155': 'Galaxy A15',
  'SM-A146': 'Galaxy A14 5G',
  'SM-A145': 'Galaxy A14',
  'SM-A136': 'Galaxy A13 5G',
  'SM-A135': 'Galaxy A13',
  'SM-A127': 'Galaxy A12 Nacho',
  'SM-A125': 'Galaxy A12',
  'SM-A065': 'Galaxy A06',
  'SM-A055': 'Galaxy A05',
  'SM-A057': 'Galaxy A05s',
  'SM-A047': 'Galaxy A04s',
  'SM-A045': 'Galaxy A04',
  'SM-A042': 'Galaxy A04e',
  'SM-A035': 'Galaxy A03',
  'SM-A037': 'Galaxy A03s',
  'SM-A032': 'Galaxy A03 Core',
  'SM-A025': 'Galaxy A02s',
  'SM-A022': 'Galaxy A02',

  // ===== Galaxy M / F (인도 시장 등) =====
  'SM-M556': 'Galaxy M55 5G',
  'SM-M546': 'Galaxy M54 5G',
  'SM-M536': 'Galaxy M53 5G',
  'SM-M526': 'Galaxy M52 5G',
  'SM-M346': 'Galaxy M34 5G',
  'SM-M336': 'Galaxy M33 5G',
  'SM-M236': 'Galaxy M23 5G',
  'SM-M156': 'Galaxy M15 5G',
  'SM-M146': 'Galaxy M14 5G',
  'SM-M135': 'Galaxy M13',
  'SM-E625': 'Galaxy F62',
  'SM-E556': 'Galaxy F55 5G',
  'SM-E546': 'Galaxy F54 5G',

  // ===== Galaxy Tab =====
  'SM-X928': 'Galaxy Tab S9 Ultra 5G',
  'SM-X916': 'Galaxy Tab S9+ 5G',
  'SM-X910': 'Galaxy Tab S9 Ultra',
  'SM-X818': 'Galaxy Tab S9 FE+ 5G',
  'SM-X816': 'Galaxy Tab S9 FE+',
  'SM-X716': 'Galaxy Tab S9 5G',
  'SM-X710': 'Galaxy Tab S9',
  'SM-X516': 'Galaxy Tab S9 FE 5G',
  'SM-X510': 'Galaxy Tab S9 FE',
  'SM-X906': 'Galaxy Tab S8 Ultra 5G',
  'SM-X900': 'Galaxy Tab S8 Ultra',
  'SM-X806': 'Galaxy Tab S8+ 5G',
  'SM-X800': 'Galaxy Tab S8+',
  'SM-X706': 'Galaxy Tab S8 5G',
  'SM-X700': 'Galaxy Tab S8',
  'SM-T976': 'Galaxy Tab S7+ 5G',
  'SM-T970': 'Galaxy Tab S7+',
  'SM-T878': 'Galaxy Tab S7 5G',
  'SM-T870': 'Galaxy Tab S7',
  'SM-T736': 'Galaxy Tab S7 FE 5G',
  'SM-T733': 'Galaxy Tab S7 FE',
  'SM-X216': 'Galaxy Tab A9+ 5G',
  'SM-X210': 'Galaxy Tab A9+',
  'SM-X115': 'Galaxy Tab A9 LTE',
  'SM-X110': 'Galaxy Tab A9',

  // ===== Galaxy XCover (러기드) =====
  'SM-G736': 'Galaxy XCover6 Pro',
  'SM-G715': 'Galaxy XCover Pro',
  'SM-G525': 'Galaxy XCover 5',
  'SM-G398': 'Galaxy XCover 4s',
};

// Pixel: ro.product.model 자체가 보통 "Pixel 8 Pro" 같은 상품명이라 그대로 둔다.
// 다만 일부 codename(시스템 prop)만 잡힐 때 대비해 일부 매핑.
const PIXEL_CODENAMES = {
  // codename → marketing
  'oriole': 'Pixel 6',
  'raven': 'Pixel 6 Pro',
  'bluejay': 'Pixel 6a',
  'panther': 'Pixel 7',
  'cheetah': 'Pixel 7 Pro',
  'lynx': 'Pixel 7a',
  'tangorpro': 'Pixel Tablet',
  'shiba': 'Pixel 8',
  'husky': 'Pixel 8 Pro',
  'akita': 'Pixel 8a',
  'tokay': 'Pixel 9',
  'caiman': 'Pixel 9 Pro',
  'komodo': 'Pixel 9 Pro XL',
  'comet': 'Pixel 9 Pro Fold',
  'tegu': 'Pixel 9a',
};

function lookupSamsung(model) {
  if (!model) return null;
  const upper = model.toUpperCase();
  if (SAMSUNG[upper]) return SAMSUNG[upper];
  // prefix 매칭: 긴 키 우선
  const keys = Object.keys(SAMSUNG).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (upper.startsWith(key)) return SAMSUNG[key];
  }
  return null;
}

function lookupPixel(model, device) {
  if (model && /^pixel\b/i.test(model)) return model; // 이미 상품명
  const cn = (device || '').toLowerCase();
  return PIXEL_CODENAMES[cn] || null;
}

/**
 * @param {{model?: string, manufacturer?: string, brand?: string, device?: string}} info
 * @returns {string|null}
 */
function resolveMarketName(info) {
  if (!info) return null;
  const mfr = (info.manufacturer || info.brand || '').toLowerCase();
  const model = info.model || '';

  if (mfr.includes('samsung') || /^sm-/i.test(model)) {
    return lookupSamsung(model);
  }
  if (mfr.includes('google') || /^pixel/i.test(model)) {
    return lookupPixel(model, info.device);
  }
  // 그 외 제조사(샤오미, 원플러스 등)는 model 자체가 상품명에 가까운 경우가 많아 null 반환
  return null;
}

module.exports = {
  resolveMarketName,
  _SAMSUNG: SAMSUNG,
  _PIXEL_CODENAMES: PIXEL_CODENAMES,
};
