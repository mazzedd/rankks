// src/utils/countryContinent.js
// Static ISO2 -> continent lookup (Mohamed 2026-08-25, HomeTennisTemplate.jsx:
// "After All Categories, add All Areas (Africa, Asia, Europe, Oceania,
// North America, South-America)"). Continent membership is a fixed
// geographic fact, not app data — no backend column for it exists (the
// countries table only carries iso2/name), so this is a plain client-side
// map keyed by the same iso2 every row's Flag/country columns already use.
// A few transcontinental countries follow the convention sports bodies
// commonly use (e.g. Russia and Turkey grouped under Europe, matching
// Tennis Europe/UEFA-style federations) rather than the strict UN
// geoscheme — pick differently here if that reads wrong for this app.
export const CONTINENTS = ['Africa', 'Asia', 'Europe', 'North America', 'Oceania', 'South America']

const EUROPE = ['AL','AD','AT','BY','BE','BA','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IS','IE','IT','XK','LV','LI','LT','LU','MT','MD','MC','ME','NL','MK','NO','PL','PT','RO','RU','SM','RS','SK','SI','ES','SE','CH','TR','UA','GB','VA']
const ASIA = ['AF','AM','AZ','BH','BD','BT','BN','KH','CN','GE','IN','ID','IR','IQ','IL','JP','JO','KZ','KW','KG','LA','LB','MY','MV','MN','MM','NP','KP','OM','PK','PS','PH','QA','SA','SG','KR','LK','SY','TW','TJ','TH','TL','TM','AE','UZ','VN','YE']
const AFRICA = ['DZ','AO','BJ','BW','BF','BI','CV','CM','CF','TD','KM','CG','CD','CI','DJ','EG','GQ','ER','SZ','ET','GA','GM','GH','GN','GW','KE','LS','LR','LY','MG','MW','ML','MR','MU','MA','MZ','NA','NE','NG','RW','ST','SN','SC','SL','SO','ZA','SS','SD','TZ','TG','TN','UG','ZM','ZW']
const NORTH_AMERICA = ['AG','BS','BB','BZ','CA','CR','CU','DM','DO','SV','GD','GT','HT','HN','JM','MX','NI','PA','KN','LC','VC','TT','US']
const SOUTH_AMERICA = ['AR','BO','BR','CL','CO','EC','GY','PY','PE','SR','UY','VE']
const OCEANIA = ['AU','FJ','KI','MH','FM','NR','NZ','PW','PG','WS','SB','TO','TV','VU']

const MAP = {}
for (const iso2 of EUROPE) MAP[iso2] = 'Europe'
for (const iso2 of ASIA) MAP[iso2] = 'Asia'
for (const iso2 of AFRICA) MAP[iso2] = 'Africa'
for (const iso2 of NORTH_AMERICA) MAP[iso2] = 'North America'
for (const iso2 of SOUTH_AMERICA) MAP[iso2] = 'South America'
for (const iso2 of OCEANIA) MAP[iso2] = 'Oceania'

export function continentForIso2(iso2) {
  if (!iso2) return null
  return MAP[iso2.toUpperCase()] || null
}
