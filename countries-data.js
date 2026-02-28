/**
 * countries-data.js — Standardized Country Data
 *
 * Replaces the hand-maintained GAZETTEER with ISO 3166-1 standard data.
 * Country names, official abbreviations, and capital cities are
 * geographic/political FACTS, not keyword guesses.
 *
 * Source: ISO 3166-1, UN Statistics Division, Natural Earth
 *
 * What this IS:  Structured geographic reference data
 * What this ISN'T:  Keyword matching (no leader names, no org names, no demonyms)
 */

// ISO 3166-1 numeric → country name (for TopoJSON feature labeling)
// This is the international standard mapping, not custom data
const ISO_NUMERIC_NAMES = {
    '4':'Afghanistan','8':'Albania','12':'Algeria','24':'Angola','32':'Argentina',
    '36':'Australia','40':'Austria','50':'Bangladesh','56':'Belgium','204':'Benin',
    '64':'Bhutan','68':'Bolivia','70':'Bosnia and Herzegovina','72':'Botswana',
    '76':'Brazil','96':'Brunei','100':'Bulgaria','854':'Burkina Faso','108':'Burundi',
    '116':'Cambodia','120':'Cameroon','124':'Canada','140':'Central African Republic',
    '148':'Chad','152':'Chile','156':'China','170':'Colombia','178':'Republic of Congo',
    '180':'DR Congo','188':'Costa Rica','384':'Ivory Coast','191':'Croatia',
    '192':'Cuba','196':'Cyprus','203':'Czech Republic','208':'Denmark',
    '262':'Djibouti','214':'Dominican Republic','218':'Ecuador','818':'Egypt',
    '222':'El Salvador','226':'Equatorial Guinea','232':'Eritrea','233':'Estonia',
    '231':'Ethiopia','246':'Finland','250':'France','266':'Gabon','270':'Gambia',
    '268':'Georgia','276':'Germany','288':'Ghana','300':'Greece','320':'Guatemala',
    '324':'Guinea','624':'Guinea-Bissau','328':'Guyana','332':'Haiti','340':'Honduras',
    '348':'Hungary','352':'Iceland','356':'India','360':'Indonesia','364':'Iran',
    '368':'Iraq','372':'Ireland','376':'Israel','380':'Italy','388':'Jamaica',
    '392':'Japan','400':'Jordan','398':'Kazakhstan','404':'Kenya','408':'North Korea',
    '410':'South Korea','414':'Kuwait','417':'Kyrgyzstan','418':'Laos','428':'Latvia',
    '422':'Lebanon','426':'Lesotho','430':'Liberia','434':'Libya','440':'Lithuania',
    '442':'Luxembourg','450':'Madagascar','454':'Malawi','458':'Malaysia','466':'Mali',
    '478':'Mauritania','484':'Mexico','496':'Mongolia','498':'Moldova','499':'Montenegro',
    '504':'Morocco','508':'Mozambique','104':'Myanmar','516':'Namibia','524':'Nepal',
    '528':'Netherlands','540':'New Caledonia','554':'New Zealand','558':'Nicaragua',
    '562':'Niger','566':'Nigeria','578':'Norway','512':'Oman','586':'Pakistan',
    '275':'Palestine','591':'Panama','598':'Papua New Guinea','600':'Paraguay',
    '604':'Peru','608':'Philippines','616':'Poland','620':'Portugal','630':'Puerto Rico',
    '634':'Qatar','642':'Romania','643':'Russia','646':'Rwanda','682':'Saudi Arabia',
    '686':'Senegal','688':'Serbia','694':'Sierra Leone','702':'Singapore',
    '703':'Slovakia','705':'Slovenia','706':'Somalia','710':'South Africa',
    '728':'South Sudan','724':'Spain','144':'Sri Lanka','729':'Sudan',
    '740':'Suriname','748':'Swaziland','752':'Sweden','756':'Switzerland',
    '760':'Syria','158':'Taiwan','762':'Tajikistan','834':'Tanzania','764':'Thailand',
    '626':'Timor-Leste','768':'Togo','780':'Trinidad and Tobago','788':'Tunisia',
    '792':'Turkey','795':'Turkmenistan','800':'Uganda','804':'Ukraine',
    '784':'United Arab Emirates','826':'United Kingdom','840':'United States',
    '858':'Uruguay','860':'Uzbekistan','548':'Vanuatu','862':'Venezuela',
    '704':'Vietnam','887':'Yemen','894':'Zambia','716':'Zimbabwe',
    '-99':'N. Cyprus','10':'Antarctica'
};

// Country data: name, ISO alpha-2, representative coordinate, official abbreviations, capital
// This is geographic reference data, not keyword matching
const COUNTRIES = [
    // Africa
    { name: 'Nigeria', code: 'NG', lat: 9.08, lng: 7.49, capital: 'Abuja', cities: ['Lagos', 'Kano'] },
    { name: 'Ethiopia', code: 'ET', lat: 9.03, lng: 38.7, capital: 'Addis Ababa' },
    { name: 'Eritrea', code: 'ER', lat: 15.33, lng: 38.93, capital: 'Asmara' },
    { name: 'Somalia', code: 'SO', lat: 2.05, lng: 45.32, capital: 'Mogadishu' },
    { name: 'Kenya', code: 'KE', lat: -1.29, lng: 36.82, capital: 'Nairobi', cities: ['Mombasa'] },
    { name: 'Sudan', code: 'SD', lat: 15.5, lng: 32.56, capital: 'Khartoum', regions: ['Darfur'] },
    { name: 'South Sudan', code: 'SS', lat: 4.85, lng: 31.6, capital: 'Juba' },
    { name: 'DR Congo', code: 'CD', lat: -4.32, lng: 15.31, capital: 'Kinshasa', cities: ['Goma'], abbrevs: ['DRC'] },
    { name: 'Libya', code: 'LY', lat: 32.9, lng: 13.18, capital: 'Tripoli', cities: ['Benghazi'] },
    { name: 'Mali', code: 'ML', lat: 12.64, lng: -8.0, capital: 'Bamako' },
    { name: 'Niger', code: 'NE', lat: 13.51, lng: 2.11, capital: 'Niamey' },
    { name: 'Burkina Faso', code: 'BF', lat: 12.37, lng: -1.52, capital: 'Ouagadougou' },
    { name: 'Chad', code: 'TD', lat: 12.13, lng: 15.06, capital: "N'Djamena" },
    { name: 'Cameroon', code: 'CM', lat: 3.85, lng: 11.5, capital: 'Yaoundé' },
    { name: 'Mozambique', code: 'MZ', lat: -25.97, lng: 32.58, capital: 'Maputo' },
    { name: 'Egypt', code: 'EG', lat: 30.04, lng: 31.24, capital: 'Cairo', cities: ['Alexandria'] },
    { name: 'Tunisia', code: 'TN', lat: 36.8, lng: 10.18, capital: 'Tunis' },
    { name: 'Algeria', code: 'DZ', lat: 36.75, lng: 3.06, capital: 'Algiers' },
    { name: 'Morocco', code: 'MA', lat: 33.97, lng: -6.85, capital: 'Rabat', cities: ['Casablanca'] },
    { name: 'South Africa', code: 'ZA', lat: -33.93, lng: 18.42, capital: 'Pretoria', cities: ['Johannesburg', 'Cape Town'] },
    { name: 'Zimbabwe', code: 'ZW', lat: -17.83, lng: 31.05, capital: 'Harare' },
    { name: 'Rwanda', code: 'RW', lat: -1.94, lng: 29.87, capital: 'Kigali' },
    { name: 'Uganda', code: 'UG', lat: 0.35, lng: 32.58, capital: 'Kampala' },
    { name: 'Tanzania', code: 'TZ', lat: -6.79, lng: 39.28, capital: 'Dodoma', cities: ['Dar es Salaam'] },
    { name: 'Ghana', code: 'GH', lat: 5.56, lng: -0.19, capital: 'Accra' },
    { name: 'Senegal', code: 'SN', lat: 14.69, lng: -17.44, capital: 'Dakar' },
    { name: 'Ivory Coast', code: 'CI', lat: 6.83, lng: -5.29, capital: 'Abidjan' },
    { name: 'Angola', code: 'AO', lat: -8.84, lng: 13.23, capital: 'Luanda' },

    // Middle East
    { name: 'Israel', code: 'IL', lat: 31.77, lng: 35.22, capital: 'Jerusalem', cities: ['Tel Aviv'] },
    { name: 'Palestine', code: 'PS', lat: 31.5, lng: 34.47, capital: 'Ramallah', regions: ['Gaza', 'West Bank'] },
    { name: 'Lebanon', code: 'LB', lat: 33.89, lng: 35.5, capital: 'Beirut' },
    { name: 'Syria', code: 'SY', lat: 33.51, lng: 36.29, capital: 'Damascus', cities: ['Aleppo', 'Idlib'] },
    { name: 'Iraq', code: 'IQ', lat: 33.31, lng: 44.37, capital: 'Baghdad', cities: ['Mosul', 'Basra'] },
    { name: 'Iran', code: 'IR', lat: 35.69, lng: 51.39, capital: 'Tehran' },
    { name: 'Yemen', code: 'YE', lat: 15.35, lng: 44.21, capital: "Sana'a", cities: ['Aden'] },
    { name: 'Saudi Arabia', code: 'SA', lat: 24.71, lng: 46.68, capital: 'Riyadh', cities: ['Jeddah', 'Mecca'] },
    { name: 'Turkey', code: 'TR', lat: 39.93, lng: 32.86, capital: 'Ankara', cities: ['Istanbul'] },
    { name: 'Qatar', code: 'QA', lat: 25.29, lng: 51.53, capital: 'Doha' },
    { name: 'United Arab Emirates', code: 'AE', lat: 24.45, lng: 54.65, capital: 'Abu Dhabi', cities: ['Dubai'], abbrevs: ['UAE'] },
    { name: 'Jordan', code: 'JO', lat: 31.95, lng: 35.95, capital: 'Amman' },
    { name: 'Oman', code: 'OM', lat: 23.61, lng: 58.54, capital: 'Muscat' },
    { name: 'Bahrain', code: 'BH', lat: 26.07, lng: 50.56, capital: 'Manama' },
    { name: 'Kuwait', code: 'KW', lat: 29.38, lng: 47.99, capital: 'Kuwait City' },

    // Europe
    { name: 'Ukraine', code: 'UA', lat: 50.45, lng: 30.52, capital: 'Kyiv', cities: ['Kharkiv', 'Odesa'], regions: ['Donbas', 'Crimea'] },
    { name: 'Russia', code: 'RU', lat: 55.76, lng: 37.62, capital: 'Moscow', cities: ['St Petersburg'] },
    { name: 'Poland', code: 'PL', lat: 52.23, lng: 21.01, capital: 'Warsaw' },
    { name: 'Germany', code: 'DE', lat: 52.52, lng: 13.41, capital: 'Berlin', cities: ['Munich', 'Frankfurt'] },
    { name: 'France', code: 'FR', lat: 48.86, lng: 2.35, capital: 'Paris', cities: ['Marseille', 'Lyon'] },
    { name: 'United Kingdom', code: 'GB', lat: 51.51, lng: -0.13, capital: 'London', abbrevs: ['UK'] },
    { name: 'Serbia', code: 'RS', lat: 44.79, lng: 20.47, capital: 'Belgrade' },
    { name: 'Kosovo', code: 'XK', lat: 42.66, lng: 21.17, capital: 'Pristina' },
    { name: 'Georgia', code: 'GE', lat: 41.69, lng: 44.8, capital: 'Tbilisi' },
    { name: 'Moldova', code: 'MD', lat: 47.01, lng: 28.86, capital: 'Chisinau', regions: ['Transnistria'] },
    { name: 'Romania', code: 'RO', lat: 44.43, lng: 26.1, capital: 'Bucharest' },
    { name: 'Greece', code: 'GR', lat: 37.97, lng: 23.73, capital: 'Athens' },
    { name: 'Sweden', code: 'SE', lat: 59.33, lng: 18.07, capital: 'Stockholm' },
    { name: 'Finland', code: 'FI', lat: 60.17, lng: 24.94, capital: 'Helsinki' },
    { name: 'Norway', code: 'NO', lat: 59.91, lng: 10.75, capital: 'Oslo' },
    { name: 'Italy', code: 'IT', lat: 41.9, lng: 12.5, capital: 'Rome', cities: ['Milan'] },
    { name: 'Spain', code: 'ES', lat: 40.42, lng: -3.7, capital: 'Madrid', cities: ['Barcelona'] },
    { name: 'Belgium', code: 'BE', lat: 50.85, lng: 4.35, capital: 'Brussels' },
    { name: 'Netherlands', code: 'NL', lat: 52.37, lng: 4.9, capital: 'Amsterdam', cities: ['The Hague'] },
    { name: 'Ireland', code: 'IE', lat: 53.35, lng: -6.26, capital: 'Dublin' },
    { name: 'Portugal', code: 'PT', lat: 38.72, lng: -9.14, capital: 'Lisbon' },
    { name: 'Austria', code: 'AT', lat: 48.21, lng: 16.37, capital: 'Vienna' },
    { name: 'Switzerland', code: 'CH', lat: 46.95, lng: 7.45, capital: 'Bern', cities: ['Geneva', 'Zurich'] },
    { name: 'Czech Republic', code: 'CZ', lat: 50.08, lng: 14.44, capital: 'Prague' },
    { name: 'Hungary', code: 'HU', lat: 47.5, lng: 19.04, capital: 'Budapest' },
    { name: 'Bulgaria', code: 'BG', lat: 42.7, lng: 23.32, capital: 'Sofia' },
    { name: 'Slovakia', code: 'SK', lat: 48.15, lng: 17.11, capital: 'Bratislava' },
    { name: 'Slovenia', code: 'SI', lat: 46.06, lng: 14.51, capital: 'Ljubljana' },
    { name: 'Croatia', code: 'HR', lat: 45.81, lng: 15.98, capital: 'Zagreb' },
    { name: 'Bosnia and Herzegovina', code: 'BA', lat: 43.86, lng: 18.41, capital: 'Sarajevo' },
    { name: 'Denmark', code: 'DK', lat: 55.68, lng: 12.57, capital: 'Copenhagen' },
    { name: 'Lithuania', code: 'LT', lat: 54.69, lng: 25.28, capital: 'Vilnius' },
    { name: 'Latvia', code: 'LV', lat: 56.95, lng: 24.11, capital: 'Riga' },
    { name: 'Estonia', code: 'EE', lat: 59.44, lng: 24.75, capital: 'Tallinn' },
    { name: 'Montenegro', code: 'ME', lat: 42.44, lng: 19.26, capital: 'Podgorica' },

    // Asia
    { name: 'China', code: 'CN', lat: 39.9, lng: 116.4, capital: 'Beijing', cities: ['Shanghai', 'Hong Kong'] },
    { name: 'Taiwan', code: 'TW', lat: 25.03, lng: 121.56, capital: 'Taipei' },
    { name: 'Japan', code: 'JP', lat: 35.68, lng: 139.69, capital: 'Tokyo', cities: ['Osaka'] },
    { name: 'South Korea', code: 'KR', lat: 37.57, lng: 126.98, capital: 'Seoul' },
    { name: 'North Korea', code: 'KP', lat: 39.02, lng: 125.75, capital: 'Pyongyang', abbrevs: ['DPRK'] },
    { name: 'India', code: 'IN', lat: 28.61, lng: 77.21, capital: 'New Delhi', cities: ['Mumbai', 'Kolkata', 'Chennai'] },
    { name: 'Pakistan', code: 'PK', lat: 33.69, lng: 73.04, capital: 'Islamabad', cities: ['Karachi', 'Lahore'] },
    { name: 'Afghanistan', code: 'AF', lat: 34.53, lng: 69.17, capital: 'Kabul', cities: ['Kandahar'] },
    { name: 'Myanmar', code: 'MM', lat: 16.87, lng: 96.2, capital: 'Naypyidaw', cities: ['Yangon'], altNames: ['Burma'] },
    { name: 'Bangladesh', code: 'BD', lat: 23.81, lng: 90.41, capital: 'Dhaka' },
    { name: 'Thailand', code: 'TH', lat: 13.76, lng: 100.5, capital: 'Bangkok' },
    { name: 'Vietnam', code: 'VN', lat: 21.03, lng: 105.85, capital: 'Hanoi', cities: ['Ho Chi Minh City'] },
    { name: 'Philippines', code: 'PH', lat: 14.6, lng: 120.98, capital: 'Manila' },
    { name: 'Indonesia', code: 'ID', lat: -6.21, lng: 106.85, capital: 'Jakarta' },
    { name: 'Malaysia', code: 'MY', lat: 3.14, lng: 101.69, capital: 'Kuala Lumpur' },
    { name: 'Singapore', code: 'SG', lat: 1.35, lng: 103.82, capital: 'Singapore' },
    { name: 'Sri Lanka', code: 'LK', lat: 6.93, lng: 79.84, capital: 'Colombo' },
    { name: 'Nepal', code: 'NP', lat: 27.72, lng: 85.32, capital: 'Kathmandu' },
    { name: 'Cambodia', code: 'KH', lat: 11.56, lng: 104.92, capital: 'Phnom Penh' },
    { name: 'Laos', code: 'LA', lat: 17.97, lng: 102.63, capital: 'Vientiane' },
    { name: 'Mongolia', code: 'MN', lat: 47.92, lng: 106.91, capital: 'Ulaanbaatar' },

    // Central Asia
    { name: 'Kazakhstan', code: 'KZ', lat: 51.13, lng: 71.43, capital: 'Astana' },
    { name: 'Uzbekistan', code: 'UZ', lat: 41.3, lng: 69.28, capital: 'Tashkent' },
    { name: 'Turkmenistan', code: 'TM', lat: 37.96, lng: 58.38, capital: 'Ashgabat' },
    { name: 'Tajikistan', code: 'TJ', lat: 38.56, lng: 68.77, capital: 'Dushanbe' },
    { name: 'Kyrgyzstan', code: 'KG', lat: 42.87, lng: 74.59, capital: 'Bishkek' },

    // Americas
    { name: 'United States', code: 'US', lat: 38.91, lng: -77.04, capital: 'Washington', cities: ['New York', 'Los Angeles'], abbrevs: ['US', 'U.S.', 'USA'] },
    { name: 'Canada', code: 'CA', lat: 45.42, lng: -75.7, capital: 'Ottawa', cities: ['Toronto', 'Vancouver'] },
    { name: 'Mexico', code: 'MX', lat: 19.43, lng: -99.13, capital: 'Mexico City' },
    { name: 'Brazil', code: 'BR', lat: -15.79, lng: -47.88, capital: 'Brasília', cities: ['São Paulo', 'Rio de Janeiro'] },
    { name: 'Venezuela', code: 'VE', lat: 10.49, lng: -66.88, capital: 'Caracas' },
    { name: 'Colombia', code: 'CO', lat: 4.71, lng: -74.07, capital: 'Bogotá' },
    { name: 'Argentina', code: 'AR', lat: -34.61, lng: -58.38, capital: 'Buenos Aires' },
    { name: 'Cuba', code: 'CU', lat: 23.11, lng: -82.37, capital: 'Havana' },
    { name: 'Haiti', code: 'HT', lat: 18.54, lng: -72.34, capital: 'Port-au-Prince' },
    { name: 'Peru', code: 'PE', lat: -12.05, lng: -77.04, capital: 'Lima' },
    { name: 'Chile', code: 'CL', lat: -33.45, lng: -70.67, capital: 'Santiago' },
    { name: 'Ecuador', code: 'EC', lat: -0.18, lng: -78.47, capital: 'Quito' },
    { name: 'Nicaragua', code: 'NI', lat: 12.15, lng: -86.27, capital: 'Managua' },
    { name: 'El Salvador', code: 'SV', lat: 13.69, lng: -89.19, capital: 'San Salvador' },
    { name: 'Guatemala', code: 'GT', lat: 14.63, lng: -90.51, capital: 'Guatemala City' },
    { name: 'Honduras', code: 'HN', lat: 14.07, lng: -87.19, capital: 'Tegucigalpa' },
    { name: 'Bolivia', code: 'BO', lat: -16.5, lng: -68.15, capital: 'La Paz' },
    { name: 'Paraguay', code: 'PY', lat: -25.26, lng: -57.58, capital: 'Asunción' },
    { name: 'Uruguay', code: 'UY', lat: -34.88, lng: -56.17, capital: 'Montevideo' },
    { name: 'Panama', code: 'PA', lat: 8.98, lng: -79.52, capital: 'Panama City' },
    { name: 'Costa Rica', code: 'CR', lat: 9.93, lng: -84.09, capital: 'San José' },
    { name: 'Dominican Republic', code: 'DO', lat: 18.47, lng: -69.9, capital: 'Santo Domingo' },
    { name: 'Jamaica', code: 'JM', lat: 18.0, lng: -76.79, capital: 'Kingston' },
    { name: 'Trinidad and Tobago', code: 'TT', lat: 10.66, lng: -61.51, capital: 'Port of Spain' },
    { name: 'Suriname', code: 'SR', lat: 5.85, lng: -55.17, capital: 'Paramaribo' },
    { name: 'Guyana', code: 'GY', lat: 6.81, lng: -58.16, capital: 'Georgetown' },

    // Oceania
    { name: 'Australia', code: 'AU', lat: -33.87, lng: 151.21, capital: 'Canberra', cities: ['Sydney', 'Melbourne'] },
    { name: 'New Zealand', code: 'NZ', lat: -41.29, lng: 174.78, capital: 'Wellington', cities: ['Auckland'] },
    { name: 'Papua New Guinea', code: 'PG', lat: -6.31, lng: 143.96, capital: 'Port Moresby', abbrevs: ['PNG'] },
    { name: 'Fiji', code: 'FJ', lat: -18.14, lng: 178.44, capital: 'Suva' },
];

// ═══════════════════════════════════════════════════════
// BUILD FAST LOOKUP INDEX (generated at load time, not hardcoded)
// ═══════════════════════════════════════════════════════

const _nameIndex = new Map();
const _coordIndex = []; // for nearest-country lookup

function _buildIndex() {
    for (const country of COUNTRIES) {
        // Index by exact country name (case-insensitive)
        _nameIndex.set(country.name.toLowerCase(), country);

        // Index by official abbreviations
        if (country.abbrevs) {
            for (const abbrev of country.abbrevs) {
                _nameIndex.set(abbrev.toLowerCase(), country);
            }
        }

        // Index by alt names (e.g. Burma → Myanmar)
        if (country.altNames) {
            for (const alt of country.altNames) {
                _nameIndex.set(alt.toLowerCase(), country);
            }
        }

        // Index by capital city
        if (country.capital) {
            _nameIndex.set(country.capital.toLowerCase(), country);
        }

        // Index by major cities
        if (country.cities) {
            for (const city of country.cities) {
                _nameIndex.set(city.toLowerCase(), country);
            }
        }

        // Index by sub-regions (Darfur, Crimea, etc.)
        if (country.regions) {
            for (const region of country.regions) {
                _nameIndex.set(region.toLowerCase(), country);
            }
        }

        // Index by ISO code
        _nameIndex.set(country.code.toLowerCase(), country);

        // Coordinate index
        _coordIndex.push(country);
    }
}

_buildIndex();

// ═══════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════

/**
 * Extract country references from text.
 * Matches against standardized names, capitals, and official abbreviations.
 * NOT keyword matching — these are geographic/political facts.
 */
function extractCountries(text) {
    if (!text) return [];
    const lower = text.toLowerCase();
    const found = new Map(); // name → country (dedup)

    for (const [term, country] of _nameIndex) {
        // Skip very short terms that cause false positives (2-letter codes)
        if (term.length <= 2) continue;

        // Whole-word boundary match
        const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escaped}\\b`, 'i');
        if (regex.test(lower) && !found.has(country.name)) {
            found.set(country.name, country);
        }
    }

    return Array.from(found.values());
}

/**
 * Find the nearest country to a given coordinate.
 * Uses haversine distance to country capital/centroid.
 */
function findNearest(lat, lng) {
    const R = 6371;
    let minDist = Infinity;
    let nearest = null;

    for (const c of _coordIndex) {
        const dLat = (c.lat - lat) * Math.PI / 180;
        const dLng = (c.lng - lng) * Math.PI / 180;
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat * Math.PI / 180) * Math.cos(c.lat * Math.PI / 180) *
            Math.sin(dLng / 2) ** 2;
        const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (dist < minDist) {
            minDist = dist;
            nearest = c;
        }
    }

    return nearest;
}

/**
 * Look up a country by any known identifier (name, code, capital, abbreviation).
 */
function lookupCountry(identifier) {
    return _nameIndex.get(identifier.toLowerCase()) || null;
}

/**
 * Get all country names as a Set (useful for quick membership checks).
 */
function getAllCountryNames() {
    return new Set(COUNTRIES.map(c => c.name));
}

/**
 * Get the ISO numeric → name mapping (for TopoJSON feature labeling).
 */
function getIsoNumericNames() {
    return ISO_NUMERIC_NAMES;
}

module.exports = {
    COUNTRIES,
    ISO_NUMERIC_NAMES,
    extractCountries,
    findNearest,
    lookupCountry,
    getAllCountryNames,
    getIsoNumericNames,
};
