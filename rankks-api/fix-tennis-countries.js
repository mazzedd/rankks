// fix-tennis-countries.js
// Run from C:\DATA\RANKKS APP\rankks-api
// node fix-tennis-countries.js

const https = require('https')
const { queryAll, queryOne } = require('./src/db')

// ── Sackmann IOC → ISO2 mapping ───────────────────────────────────────────────
// Sackmann uses IOC 3-letter codes, we need ISO2
const IOC_TO_ISO2 = {
  AFG: 'AF', ALB: 'AL', ALG: 'DZ', AND: 'AD', ANG: 'AO', ANT: 'AG',
  ARG: 'AR', ARM: 'AM', ARU: 'AW', ASA: 'AS', AUS: 'AU', AUT: 'AT',
  AZE: 'AZ', BAH: 'BS', BAN: 'BD', BAR: 'BB', BDI: 'BI', BEL: 'BE',
  BEN: 'BJ', BER: 'BM', BHU: 'BT', BIH: 'BA', BIZ: 'BZ', BLR: 'BY',
  BOL: 'BO', BOT: 'BW', BRA: 'BR', BRN: 'BH', BRU: 'BN', BUL: 'BG',
  BUR: 'BF', CAF: 'CF', CAM: 'KH', CAN: 'CA', CAY: 'KY', CGO: 'CG',
  CHA: 'TD', CHI: 'CL', CHN: 'CN', CIV: 'CI', CMR: 'CM', COD: 'CD',
  COK: 'CK', COL: 'CO', COM: 'KM', CPV: 'CV', CRC: 'CR', CRO: 'HR',
  CUB: 'CU', CYP: 'CY', CZE: 'CZ', DEN: 'DK', DJI: 'DJ', DOM: 'DO',
  ECU: 'EC', EGY: 'EG', ERI: 'ER', ESA: 'SV', ESP: 'ES', EST: 'EE',
  ETH: 'ET', FIJ: 'FJ', FIN: 'FI', FRA: 'FR', GAB: 'GA', GAM: 'GM',
  GBR: 'GB', GBS: 'GW', GEO: 'GE', GEQ: 'GQ', GER: 'DE', GHA: 'GH',
  GRE: 'GR', GRN: 'GD', GUA: 'GT', GUI: 'GN', GUM: 'GU', GUY: 'GY',
  HAI: 'HT', HKG: 'HK', HON: 'HN', HUN: 'HU', INA: 'ID', IND: 'IN',
  IRI: 'IR', IRL: 'IE', IRQ: 'IQ', ISL: 'IS', ISR: 'IL', ISV: 'VI',
  ITA: 'IT', IVB: 'VG', JAM: 'JM', JOR: 'JO', JPN: 'JP', KAZ: 'KZ',
  KEN: 'KE', KGZ: 'KG', KIR: 'KI', KOR: 'KR', KOS: 'XK', KSA: 'SA',
  KUW: 'KW', LAO: 'LA', LAT: 'LV', LBA: 'LY', LBN: 'LB', LBR: 'LR',
  LCA: 'LC', LES: 'LS', LIE: 'LI', LTU: 'LT', LUX: 'LU', MAD: 'MG',
  MAR: 'MA', MAS: 'MY', MAW: 'MW', MDA: 'MD', MDV: 'MV', MEX: 'MX',
  MGL: 'MN', MKD: 'MK', MLI: 'ML', MLT: 'MT', MNE: 'ME', MON: 'MC',
  MOZ: 'MZ', MRI: 'MU', MTN: 'MR', MYA: 'MM', NAM: 'NA', NCA: 'NI',
  NED: 'NL', NEP: 'NP', NGR: 'NG', NIG: 'NE', NOR: 'NO', NRU: 'NR',
  NZL: 'NZ', OMA: 'OM', PAK: 'PK', PAN: 'PA', PAR: 'PY', PER: 'PE',
  PHI: 'PH', PLE: 'PS', PLW: 'PW', PNG: 'PG', POL: 'PL', POR: 'PT',
  PRK: 'KP', PUR: 'PR', QAT: 'QA', ROU: 'RO', RSA: 'ZA', RUS: 'RU',
  RWA: 'RW', SAM: 'WS', SEN: 'SN', SEY: 'SC', SKN: 'KN', SLE: 'SL',
  SLO: 'SI', SMR: 'SM', SOL: 'SB', SOM: 'SO', SRB: 'RS', SRI: 'LK',
  SSD: 'SS', STP: 'ST', SUD: 'SD', SUI: 'CH', SUR: 'SR', SVK: 'SK',
  SWE: 'SE', SWZ: 'SZ', SYR: 'SY', TAN: 'TZ', TGA: 'TO', THA: 'TH',
  TJK: 'TJ', TKM: 'TM', TLS: 'TL', TOG: 'TG', TPE: 'TW', TTO: 'TT',
  TUN: 'TN', TUR: 'TR', TUV: 'TV', UAE: 'AE', UGA: 'UG', UKR: 'UA',
  URU: 'UY', USA: 'US', UZB: 'UZ', VAN: 'VU', VEN: 'VE', VIE: 'VN',
  VIN: 'VC', YEM: 'YE', ZAM: 'ZM', ZIM: 'ZW',
}

function fetchCSV(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => resolve(data))
      res.on('error', reject)
    }).on('error', reject)
  })
}

function parseCSV(text) {
  const lines = text.trim().split('\n')
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
  return lines.slice(1).map(line => {
    const vals = line.split(',').map(v => v.trim().replace(/"/g, ''))
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']))
  })
}

function normalizeName(name) {
  return name.toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z\s]/g, '')
    .trim()
}

async function main() {
  console.log('Fetching Sackmann ATP players...')
  const atpCsv = await fetchCSV('https://raw.githubusercontent.com/JeffSackmann/tennis_atp/master/atp_players.csv')
  console.log('Fetching Sackmann WTA players...')
  const wtaCsv = await fetchCSV('https://raw.githubusercontent.com/JeffSackmann/tennis_wta/master/wta_players.csv')

  const atpPlayers = parseCSV(atpCsv)
  const wtaPlayers = parseCSV(wtaCsv)
  const allPlayers = [...atpPlayers, ...wtaPlayers]

  console.log(`Loaded ${allPlayers.length} Sackmann players`)

  // Build lookup: normalized full name → ioc code
  const sackmannMap = {}
  for (const p of allPlayers) {
    const first = (p.name_first || '').trim()
    const last  = (p.name_last  || '').trim()
    if (!first && !last) continue
    const full = normalizeName(`${first} ${last}`)
    const ioc  = (p.ioc || p.country || '').toUpperCase()
    if (full && ioc) sackmannMap[full] = ioc
  }

  // Get all tennis entities with null country_id
  const missing = await queryAll(`
    SELECT DISTINCT e.id, e.canonical_name, e.slug
    FROM entities e
    JOIN player_attributes pa ON pa.entity_id = e.id
    WHERE e.country_id IS NULL
      AND pa.sport_id = 2
    UNION
    SELECT DISTINCT e.id, e.canonical_name, e.slug
    FROM entities e
    WHERE e.country_id IS NULL
      AND EXISTS (
        SELECT 1 FROM games g
        WHERE g.home_entity_id = e.id
           OR g.away_entity_id = e.id
           OR g.winner_entity_id = e.id
      )
      AND e.entity_type IN ('player', 'athlete')
    ORDER BY canonical_name
  `)

  console.log(`\nFound ${missing.length} tennis entities with null country_id`)

  // Load countries table
  const countries = await queryAll(`SELECT id, iso2 FROM countries`)
  const iso2ToId = Object.fromEntries(countries.map(c => [c.iso2.toUpperCase(), c.id]))

  let updated = 0
  let notFound = 0
  const notFoundList = []

  for (const entity of missing) {
    const normalized = normalizeName(entity.canonical_name)
    const ioc = sackmannMap[normalized]

    if (!ioc) {
      notFound++
      notFoundList.push(entity.canonical_name)
      continue
    }

    const iso2 = IOC_TO_ISO2[ioc]
    if (!iso2) {
      console.log(`  No ISO2 mapping for IOC code: ${ioc} (${entity.canonical_name})`)
      notFoundList.push(entity.canonical_name)
      notFound++
      continue
    }

    const countryId = iso2ToId[iso2]
    if (!countryId) {
      console.log(`  Country not in DB: ${iso2} (${entity.canonical_name})`)
      notFoundList.push(entity.canonical_name)
      notFound++
      continue
    }

    await queryAll(
      `UPDATE entities SET country_id = $1 WHERE id = $2`,
      [countryId, entity.id]
    )
    console.log(`  ✓ ${entity.canonical_name} → ${iso2} (${ioc})`)
    updated++
  }

  console.log(`\n✅ Updated: ${updated}`)
  console.log(`❌ Not matched: ${notFound}`)
  if (notFoundList.length) {
    console.log('\nNot found in Sackmann:')
    notFoundList.forEach(n => console.log(' -', n))
  }

  process.exit(0)
}

main().catch(err => { console.error(err); process.exit(1) })