/**
 * discovery.js — Autonomous Situation Discovery Engine
 * 
 * No hardcoded regions. Discovers active global situations
 * organically from GDELT geo-events and parsed RSS headlines.
 */

// ═══════════════════════════════════════════════════════
// COUNTRY / TERRITORY GAZETTEER
// ═══════════════════════════════════════════════════════
const GAZETTEER = [
    // ── Africa ──
    { name: 'Nigeria', lat: 9.08, lng: 7.49, aliases: ['nigerian', 'abuja', 'lagos', 'boko haram'] },
    { name: 'Ethiopia', lat: 9.03, lng: 38.7, aliases: ['ethiopian', 'addis ababa', 'tigray', 'amhara'] },
    { name: 'Eritrea', lat: 15.33, lng: 38.93, aliases: ['eritrean', 'asmara'] },
    { name: 'Somalia', lat: 2.05, lng: 45.32, aliases: ['somali', 'mogadishu', 'al-shabaab', 'alshabaab'] },
    { name: 'Kenya', lat: -1.29, lng: 36.82, aliases: ['kenyan', 'nairobi', 'mombasa'] },
    { name: 'Sudan', lat: 15.5, lng: 32.56, aliases: ['sudanese', 'khartoum', 'darfur', 'rsf'] },
    { name: 'South Sudan', lat: 4.85, lng: 31.6, aliases: ['south sudanese', 'juba'] },
    { name: 'DR Congo', lat: -4.32, lng: 15.31, aliases: ['drc', 'congo', 'congolese', 'kinshasa', 'goma', 'm23'] },
    { name: 'Libya', lat: 32.9, lng: 13.18, aliases: ['libyan', 'tripoli', 'benghazi', 'haftar'] },
    { name: 'Mali', lat: 12.64, lng: -8.0, aliases: ['malian', 'bamako', 'sahel'] },
    { name: 'Niger', lat: 13.51, lng: 2.11, aliases: ['nigerien'] },
    { name: 'Burkina Faso', lat: 12.37, lng: -1.52, aliases: ['burkinabe', 'ouagadougou'] },
    { name: 'Chad', lat: 12.13, lng: 15.06, aliases: ['chadian', 'ndjamena'] },
    { name: 'Cameroon', lat: 3.85, lng: 11.5, aliases: ['cameroonian', 'anglophone'] },
    { name: 'Mozambique', lat: -25.97, lng: 32.58, aliases: ['mozambican', 'cabo delgado'] },
    { name: 'Egypt', lat: 30.04, lng: 31.24, aliases: ['egyptian', 'cairo', 'sinai'] },
    { name: 'Tunisia', lat: 36.8, lng: 10.18, aliases: ['tunisian', 'tunis'] },
    { name: 'Algeria', lat: 36.75, lng: 3.06, aliases: ['algerian', 'algiers'] },
    { name: 'Morocco', lat: 33.97, lng: -6.85, aliases: ['moroccan', 'rabat', 'western sahara'] },
    { name: 'South Africa', lat: -33.93, lng: 18.42, aliases: ['south african', 'pretoria', 'johannesburg', 'cape town'] },
    { name: 'Zimbabwe', lat: -17.83, lng: 31.05, aliases: ['zimbabwean', 'harare'] },
    { name: 'Rwanda', lat: -1.94, lng: 29.87, aliases: ['rwandan', 'kigali'] },
    { name: 'Uganda', lat: 0.35, lng: 32.58, aliases: ['ugandan', 'kampala'] },
    { name: 'Tanzania', lat: -6.79, lng: 39.28, aliases: ['tanzanian', 'dar es salaam'] },

    // ── Middle East ──
    { name: 'Israel', lat: 31.77, lng: 35.22, aliases: ['israeli', 'jerusalem', 'tel aviv', 'idf', 'netanyahu'] },
    { name: 'Palestine', lat: 31.5, lng: 34.47, aliases: ['palestinian', 'gaza', 'west bank', 'hamas', 'ramallah'] },
    { name: 'Lebanon', lat: 33.89, lng: 35.5, aliases: ['lebanese', 'beirut', 'hezbollah'] },
    { name: 'Syria', lat: 33.51, lng: 36.29, aliases: ['syrian', 'damascus', 'aleppo', 'assad', 'idlib'] },
    { name: 'Iraq', lat: 33.31, lng: 44.37, aliases: ['iraqi', 'baghdad', 'mosul', 'isis', 'kurdistan'] },
    { name: 'Iran', lat: 35.69, lng: 51.39, aliases: ['iranian', 'tehran', 'irgc', 'khamenei', 'persian'] },
    { name: 'Yemen', lat: 15.35, lng: 44.21, aliases: ['yemeni', 'sanaa', 'houthi', 'aden'] },
    { name: 'Saudi Arabia', lat: 24.71, lng: 46.68, aliases: ['saudi', 'riyadh', 'mbs'] },
    { name: 'Turkey', lat: 39.93, lng: 32.86, aliases: ['turkish', 'ankara', 'istanbul', 'erdogan', 'türkiye'] },
    { name: 'Qatar', lat: 25.29, lng: 51.53, aliases: ['qatari', 'doha'] },
    { name: 'UAE', lat: 24.45, lng: 54.65, aliases: ['emirati', 'abu dhabi', 'dubai', 'united arab emirates'] },
    { name: 'Jordan', lat: 31.95, lng: 35.95, aliases: ['jordanian', 'amman'] },
    { name: 'Oman', lat: 23.61, lng: 58.54, aliases: ['omani', 'muscat'] },
    { name: 'Bahrain', lat: 26.07, lng: 50.56, aliases: ['bahraini', 'manama'] },
    { name: 'Kuwait', lat: 29.38, lng: 47.99, aliases: ['kuwaiti'] },

    // ── Europe ──
    { name: 'Ukraine', lat: 50.45, lng: 30.52, aliases: ['ukrainian', 'kyiv', 'kiev', 'zelensky', 'donbas', 'crimea', 'kherson', 'zaporizhzhia'] },
    { name: 'Russia', lat: 55.76, lng: 37.62, aliases: ['russian', 'moscow', 'kremlin', 'putin', 'belgorod'] },
    { name: 'Poland', lat: 52.23, lng: 21.01, aliases: ['polish', 'warsaw'] },
    { name: 'Germany', lat: 52.52, lng: 13.41, aliases: ['german', 'berlin', 'scholz'] },
    { name: 'France', lat: 48.86, lng: 2.35, aliases: ['french', 'paris', 'macron'] },
    { name: 'UK', lat: 51.51, lng: -0.13, aliases: ['britain', 'british', 'london', 'united kingdom', 'england'] },
    { name: 'Serbia', lat: 44.79, lng: 20.47, aliases: ['serbian', 'belgrade'] },
    { name: 'Kosovo', lat: 42.66, lng: 21.17, aliases: ['kosovar', 'pristina'] },
    { name: 'Georgia', lat: 41.69, lng: 44.8, aliases: ['georgian', 'tbilisi'] },
    { name: 'Moldova', lat: 47.01, lng: 28.86, aliases: ['moldovan', 'chisinau', 'transnistria'] },
    { name: 'Romania', lat: 44.43, lng: 26.1, aliases: ['romanian', 'bucharest'] },
    { name: 'Greece', lat: 37.97, lng: 23.73, aliases: ['greek', 'athens'] },
    { name: 'Sweden', lat: 59.33, lng: 18.07, aliases: ['swedish', 'stockholm'] },
    { name: 'Finland', lat: 60.17, lng: 24.94, aliases: ['finnish', 'helsinki'] },
    { name: 'Norway', lat: 59.91, lng: 10.75, aliases: ['norwegian', 'oslo'] },
    { name: 'Italy', lat: 41.9, lng: 12.5, aliases: ['italian', 'rome'] },
    { name: 'Spain', lat: 40.42, lng: -3.7, aliases: ['spanish', 'madrid'] },
    { name: 'Belgium', lat: 50.85, lng: 4.35, aliases: ['belgian', 'brussels'] },
    { name: 'Netherlands', lat: 52.37, lng: 4.9, aliases: ['dutch', 'amsterdam', 'the hague'] },

    // ── Asia ──
    { name: 'China', lat: 39.9, lng: 116.4, aliases: ['chinese', 'beijing', 'xi jinping', 'pla'] },
    { name: 'Taiwan', lat: 25.03, lng: 121.56, aliases: ['taiwanese', 'taipei', 'taiwan strait'] },
    { name: 'Japan', lat: 35.68, lng: 139.69, aliases: ['japanese', 'tokyo'] },
    { name: 'South Korea', lat: 37.57, lng: 126.98, aliases: ['south korean', 'seoul'] },
    { name: 'North Korea', lat: 39.02, lng: 125.75, aliases: ['north korean', 'pyongyang', 'dprk', 'kim jong un'] },
    { name: 'India', lat: 28.61, lng: 77.21, aliases: ['indian', 'new delhi', 'delhi', 'kashmir', 'modi'] },
    { name: 'Pakistan', lat: 33.69, lng: 73.04, aliases: ['pakistani', 'islamabad', 'karachi', 'lahore'] },
    { name: 'Afghanistan', lat: 34.53, lng: 69.17, aliases: ['afghan', 'kabul', 'taliban', 'kandahar'] },
    { name: 'Myanmar', lat: 16.87, lng: 96.2, aliases: ['burmese', 'burma', 'naypyidaw', 'yangon', 'rohingya', 'junta'] },
    { name: 'Bangladesh', lat: 23.81, lng: 90.41, aliases: ['bangladeshi', 'dhaka'] },
    { name: 'Thailand', lat: 13.76, lng: 100.5, aliases: ['thai', 'bangkok'] },
    { name: 'Vietnam', lat: 21.03, lng: 105.85, aliases: ['vietnamese', 'hanoi'] },
    { name: 'Philippines', lat: 14.6, lng: 120.98, aliases: ['filipino', 'philippine', 'manila', 'south china sea'] },
    { name: 'Indonesia', lat: -6.21, lng: 106.85, aliases: ['indonesian', 'jakarta'] },
    { name: 'Malaysia', lat: 3.14, lng: 101.69, aliases: ['malaysian', 'kuala lumpur'] },
    { name: 'Singapore', lat: 1.35, lng: 103.82, aliases: ['singaporean'] },
    { name: 'Sri Lanka', lat: 6.93, lng: 79.84, aliases: ['sri lankan', 'colombo'] },
    { name: 'Nepal', lat: 27.72, lng: 85.32, aliases: ['nepalese', 'kathmandu'] },
    { name: 'Cambodia', lat: 11.56, lng: 104.92, aliases: ['cambodian', 'phnom penh'] },

    // ── Central Asia ──
    { name: 'Kazakhstan', lat: 51.13, lng: 71.43, aliases: ['kazakh', 'nur-sultan', 'astana'] },
    { name: 'Uzbekistan', lat: 41.3, lng: 69.28, aliases: ['uzbek', 'tashkent'] },
    { name: 'Turkmenistan', lat: 37.96, lng: 58.38, aliases: ['turkmen', 'ashgabat'] },
    { name: 'Tajikistan', lat: 38.56, lng: 68.77, aliases: ['tajik', 'dushanbe'] },
    { name: 'Kyrgyzstan', lat: 42.87, lng: 74.59, aliases: ['kyrgyz', 'bishkek'] },

    // ── Americas ──
    { name: 'United States', lat: 38.91, lng: -77.04, aliases: ['u.s.', 'us', 'american', 'washington', 'pentagon', 'white house', 'trump', 'biden'] },
    { name: 'Canada', lat: 45.42, lng: -75.7, aliases: ['canadian', 'ottawa', 'trudeau'] },
    { name: 'Mexico', lat: 19.43, lng: -99.13, aliases: ['mexican', 'mexico city', 'cartel'] },
    { name: 'Brazil', lat: -15.79, lng: -47.88, aliases: ['brazilian', 'brasilia', 'sao paulo'] },
    { name: 'Venezuela', lat: 10.49, lng: -66.88, aliases: ['venezuelan', 'caracas', 'maduro'] },
    { name: 'Colombia', lat: 4.71, lng: -74.07, aliases: ['colombian', 'bogota'] },
    { name: 'Argentina', lat: -34.61, lng: -58.38, aliases: ['argentine', 'buenos aires', 'milei'] },
    { name: 'Cuba', lat: 23.11, lng: -82.37, aliases: ['cuban', 'havana'] },
    { name: 'Haiti', lat: 18.54, lng: -72.34, aliases: ['haitian', 'port-au-prince'] },
    { name: 'Peru', lat: -12.05, lng: -77.04, aliases: ['peruvian', 'lima'] },
    { name: 'Chile', lat: -33.45, lng: -70.67, aliases: ['chilean', 'santiago'] },
    { name: 'Ecuador', lat: -0.18, lng: -78.47, aliases: ['ecuadorian', 'quito'] },
    { name: 'Nicaragua', lat: 12.15, lng: -86.27, aliases: ['nicaraguan', 'managua'] },
    { name: 'El Salvador', lat: 13.69, lng: -89.19, aliases: ['salvadoran', 'bukele'] },
    { name: 'Guatemala', lat: 14.63, lng: -90.51, aliases: ['guatemalan'] },
    { name: 'Honduras', lat: 14.07, lng: -87.19, aliases: ['honduran'] },

    // ── Oceania ──
    { name: 'Australia', lat: -33.87, lng: 151.21, aliases: ['australian', 'canberra', 'sydney'] },
    { name: 'New Zealand', lat: -41.29, lng: 174.78, aliases: ['new zealander', 'wellington'] },
    { name: 'Papua New Guinea', lat: -6.31, lng: 143.96, aliases: ['png'] },
    { name: 'Fiji', lat: -18.14, lng: 178.44, aliases: ['fijian', 'suva'] },
];

// Build fast-lookup structures
const COUNTRY_LOOKUP = new Map();
GAZETTEER.forEach(c => {
    COUNTRY_LOOKUP.set(c.name.toLowerCase(), c);
    c.aliases.forEach(a => COUNTRY_LOOKUP.set(a.toLowerCase(), c));
});

// ═══════════════════════════════════════════════════════
// SEVERITY KEYWORDS — weight articles by threat level
// ═══════════════════════════════════════════════════════
const SEVERITY_TERMS = {
    critical: ['war', 'killed', 'airstrike', 'bombing', 'massacre', 'genocide', 'invasion', 'missile', 'casualt', 'death toll', 'dead', 'execution', 'shelling'],
    elevated: ['conflict', 'fighting', 'attack', 'troops', 'military', 'clash', 'violence', 'crisis', 'urgent', 'hostage', 'artillery', 'drone', 'refugee', 'displacement', 'humanitarian'],
    moderate: ['tension', 'sanctions', 'protest', 'unrest', 'dispute', 'threat', 'warning', 'escalat', 'opposition', 'riot', 'detain', 'arrest']
};

// ═══════════════════════════════════════════════════════
// CATEGORY DETECTION
// ═══════════════════════════════════════════════════════
const CATEGORY_PATTERNS = [
    { label: 'War', terms: ['war', 'invasion', 'frontline', 'offensive', 'battlefield'] },
    { label: 'Armed Conflict', terms: ['conflict', 'fighting', 'rebel', 'insurgent', 'militia', 'guerrilla'] },
    { label: 'Military Operations', terms: ['airstrike', 'bombing', 'missile', 'drone strike', 'military operation', 'troops deployed'] },
    { label: 'Humanitarian Crisis', terms: ['humanitarian', 'refugee', 'famine', 'displacement', 'aid', 'starvation'] },
    { label: 'Civil Unrest', terms: ['protest', 'riot', 'demonstration', 'unrest', 'uprising', 'revolution'] },
    { label: 'Political Crisis', terms: ['coup', 'election', 'political crisis', 'opposition', 'authoritarian'] },
    { label: 'Terrorism', terms: ['terror', 'extremist', 'jihad', 'suicide bomb', 'al-qaeda', 'isis'] },
    { label: 'Maritime Dispute', terms: ['maritime', 'naval', 'territorial waters', 'south china sea', 'strait'] },
    { label: 'Nuclear Tension', terms: ['nuclear', 'uranium', 'enrichment', 'nonproliferation', 'warhead'] },
    { label: 'Sanctions & Diplomacy', terms: ['sanction', 'embargo', 'diplomatic', 'negotiation', 'treaty'] },
    { label: 'Security Crisis', terms: ['security', 'crime', 'gang', 'cartel', 'kidnap', 'extortion'] },
    { label: 'Geopolitical Tension', terms: ['tension', 'standoff', 'disputed', 'escalation'] },
];

// ═══════════════════════════════════════════════════════
// LOCATION EXTRACTION
// ═══════════════════════════════════════════════════════

/**
 * Extract country/territory references from raw text.
 * Returns an array of matching gazetteer entries (deduplicated).
 */
function extractLocations(text) {
    if (!text) return [];
    const lower = text.toLowerCase();
    const found = new Set();
    const results = [];

    for (const [term, entry] of COUNTRY_LOOKUP) {
        // Only match whole words (avoid "iran" matching in "terrain")
        const wordBoundary = new RegExp(`\\b${escapeRegex(term)}\\b`, 'i');
        if (wordBoundary.test(lower) && !found.has(entry.name)) {
            found.add(entry.name);
            results.push(entry);
        }
    }

    return results;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════════════════════════════════════════════
// GDELT GEO QUERIES
// ═══════════════════════════════════════════════════════

const GEO_THEMES = [
    { label: 'conflict', query: '(conflict OR war OR fighting OR battle)' },
    { label: 'crisis', query: '(crisis OR humanitarian OR refugee OR famine)' },
    { label: 'military', query: '(military OR airstrike OR troops OR bombing)' },
    { label: 'unrest', query: '(protest OR riot OR unrest OR uprising)' },
    { label: 'tension', query: '(sanctions OR nuclear OR tension OR standoff)' },
];

/**
 * Build a GDELT GEO 2.0 URL for a theme query.
 */
function buildGeoQuery(themeQuery) {
    const encoded = encodeURIComponent(themeQuery);
    return `https://api.gdeltproject.org/api/v2/geo/geo?query=${encoded}&format=GeoJSON&timespan=1d&maxpoints=75`;
}

/**
 * Parse a GDELT GeoJSON response into normalized events.
 */
function parseGeoResponse(geojson) {
    if (!geojson || !geojson.features) return [];

    return geojson.features
        .filter(f => f.geometry && f.geometry.coordinates)
        .filter(f => {
            // Filter out 0,0 coordinates (errors) and far-out points
            const [lng, lat] = f.geometry.coordinates;
            return !(lat === 0 && lng === 0);
        })
        .map(f => {
            const [lng, lat] = f.geometry.coordinates;
            const props = f.properties || {};
            // Extract URL from HTML if needed to avoid injecting raw tags
            let url = props.url || '';
            let name = props.name || '';
            if (!url && props.html) {
                const match = props.html.match(/href="([^"]+)"/);
                if (match) url = match[1];
            }
            if (!name && props.html) {
                name = props.html.replace(/<[^>]+>/g, '').trim();
            }

            return {
                lat,
                lng,
                name: name,
                url: url,
                source: 'gdelt-geo',
                tone: props.tone !== undefined ? props.tone : 0,
            };
        });
}

// ═══════════════════════════════════════════════════════
// HAVERSINE DISTANCE (km)
// ═══════════════════════════════════════════════════════
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ═══════════════════════════════════════════════════════
// CLUSTERING
// ═══════════════════════════════════════════════════════

const CLUSTER_RADIUS_KM = 500;

/**
 * Cluster geolocated events by geographic proximity.
 * Simple single-pass greedy clustering.
 *
 * @param {Array} events — [{ lat, lng, title, source, ... }]
 * @returns {Array} clusters
 */
function clusterEvents(events) {
    const clusters = [];

    for (const ev of events) {
        let merged = false;

        for (const cl of clusters) {
            const dist = haversineKm(ev.lat, ev.lng, cl.centerLat, cl.centerLng);
            if (dist < CLUSTER_RADIUS_KM) {
                cl.events.push(ev);
                // Update center to rolling average
                const n = cl.events.length;
                cl.centerLat = ((cl.centerLat * (n - 1)) + ev.lat) / n;
                cl.centerLng = ((cl.centerLng * (n - 1)) + ev.lng) / n;
                merged = true;
                break;
            }
        }

        if (!merged) {
            clusters.push({
                centerLat: ev.lat,
                centerLng: ev.lng,
                events: [ev],
            });
        }
    }

    return clusters;
}

// ═══════════════════════════════════════════════════════
// AUTO-NAMING
// ═══════════════════════════════════════════════════════

/**
 * Auto-generate a situation name from the cluster's events.
 * Finds the most-mentioned countries and creates "Country A – Country B" style names.
 */
function autoNameSituation(cluster) {
    const countryMentions = {};

    for (const ev of cluster.events) {
        const text = ev.title || ev.name || '';
        const locations = extractLocations(text);
        for (const loc of locations) {
            countryMentions[loc.name] = (countryMentions[loc.name] || 0) + 1;
        }
    }

    // If no countries found, use nearest gazetteer entry
    if (Object.keys(countryMentions).length === 0) {
        const nearest = findNearestCountry(cluster.centerLat, cluster.centerLng);
        if (nearest) return nearest.name + ' Region';
        return `Activity at ${cluster.centerLat.toFixed(1)}°, ${cluster.centerLng.toFixed(1)}°`;
    }

    // Sort by frequency, take top 2, then sort alphabetically to ensure consistency
    const sorted = Object.entries(countryMentions).sort((a, b) => b[1] - a[1]);
    if (sorted.length === 1) return sorted[0][0];
    const top2 = [sorted[0][0], sorted[1][0]].sort();
    return `${top2[0]} – ${top2[1]}`;
}

/**
 * Find the nearest country in the gazetteer to given coordinates.
 */
function findNearestCountry(lat, lng) {
    let minDist = Infinity;
    let nearest = null;

    for (const c of GAZETTEER) {
        const dist = haversineKm(lat, lng, c.lat, c.lng);
        if (dist < minDist) {
            minDist = dist;
            nearest = c;
        }
    }

    return nearest;
}

// ═══════════════════════════════════════════════════════
// HELPER: detect GDELT location-name strings
// ═══════════════════════════════════════════════════════
function isLocationString(str) {
    const commas = (str.match(/,/g) || []).length;
    const words = str.split(/\s+/).length;
    if (commas >= 2 && words <= 6) return true;
    if (/^[A-Z][a-z]+,\s*[A-Z]/.test(str) && commas >= 1 && words <= 5) return true;
    return false;
}

// ── Lightweight extractive summarizer (TF-IDF sentence scoring) ──

/**
 * Split a block of text into clean sentences.
 */
function splitSentences(text) {
    return text
        .replace(/\s+/g, ' ')
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 30 && /[a-zA-Z]/.test(s))
        .filter(s => !isLocationString(s));
}

/**
 * Compute TF-IDF-like scores for sentences relative to a corpus.
 * Returns sentences sorted by relevance (highest first).
 */
function scoreSentences(sentences) {
    // Stop words to ignore
    const STOP = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may',
        'might', 'shall', 'can', 'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from',
        'as', 'into', 'through', 'during', 'before', 'after', 'above', 'below', 'between',
        'out', 'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here', 'there',
        'when', 'where', 'why', 'how', 'all', 'both', 'each', 'few', 'more', 'most', 'other',
        'some', 'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very',
        'and', 'but', 'if', 'or', 'because', 'until', 'while', 'that', 'this', 'it', 'its',
        'he', 'she', 'they', 'them', 'their', 'his', 'her', 'we', 'you', 'i', 'my', 'your',
        'said', 'says', 'also', 'new', 'one', 'two', 'three', 'just', 'about', 'up']);

    // Tokenize each sentence
    const tokenized = sentences.map(s => {
        return s.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .split(/\s+/)
            .filter(w => w.length > 2 && !STOP.has(w));
    });

    // Document frequency (how many sentences contain each word)
    const df = {};
    tokenized.forEach(tokens => {
        const unique = new Set(tokens);
        unique.forEach(w => { df[w] = (df[w] || 0) + 1; });
    });

    const N = sentences.length;

    // Score each sentence
    const scored = sentences.map((sentence, i) => {
        const tokens = tokenized[i];
        if (tokens.length === 0) return { sentence, score: 0 };

        let score = 0;
        const tf = {};
        tokens.forEach(w => { tf[w] = (tf[w] || 0) + 1; });

        for (const [word, count] of Object.entries(tf)) {
            const idf = Math.log(N / (df[word] || 1));
            score += (count / tokens.length) * idf;
        }

        // Boost longer, more substantive sentences slightly
        score *= Math.min(1.2, sentence.length / 80);

        return { sentence, score };
    });

    return scored.sort((a, b) => b.score - a.score);
}

function autoDescribeSituation(cluster) {
    // 1. Collect all RSS snippets and titles from the cluster
    const snippets = cluster.events
        .map(e => e.snippet || '')
        .filter(s => s.length > 30)
        .filter(s => /[a-zA-Z]/.test(s))
        .filter(s => !isLocationString(s));

    const headlines = cluster.events
        .map(e => e.title || '')
        .filter(t => t.length > 15)
        .filter(t => /[a-zA-Z]/.test(t))
        .filter(t => !isLocationString(t));

    const uniqueHeadlines = [...new Set(headlines)];

    // 2. If we have snippets, build an extractive summary
    if (snippets.length > 0) {
        // Combine all snippet text into a corpus
        const corpus = [...new Set(snippets)].join('. ');
        const sentences = splitSentences(corpus);

        if (sentences.length >= 2) {
            const ranked = scoreSentences(sentences);
            // Pick top 2–3 most informative sentences
            const topSentences = ranked.slice(0, 3).map(r => r.sentence);
            // Re-order them by their original position for coherence
            const ordered = topSentences.sort((a, b) => {
                return corpus.indexOf(a) - corpus.indexOf(b);
            });
            return ordered.join(' ');
        }

        // If only 1 usable sentence, return it
        if (sentences.length === 1) {
            return sentences[0];
        }
    }

    // 3. Fallback to headlines if no snippets available
    if (uniqueHeadlines.length > 0) {
        return uniqueHeadlines.slice(0, 3).join(' · ');
    }

    // 4. Last resort: GDELT-only contextual fallback
    const name = autoNameSituation(cluster);
    const count = cluster.events.length;
    const allNames = cluster.events.map(e => (e.name || '').toLowerCase()).join(' ');

    const contextClues = [];
    if (/military|troops|army|base/.test(allNames)) contextClues.push('military activity');
    if (/border|crossing|checkpoint/.test(allNames)) contextClues.push('border activity');
    if (/protest|rally|march|square/.test(allNames)) contextClues.push('civil unrest');
    if (/port|naval|ship|strait/.test(allNames)) contextClues.push('maritime activity');
    if (/airport|airbase|air/.test(allNames)) contextClues.push('air traffic monitored');
    if (/capital|parliament|government|embassy/.test(allNames)) contextClues.push('political activity');

    if (contextClues.length > 0) {
        return `${count} events detected near ${name} — ${contextClues.join(', ')}. Monitoring via satellite and geo-event data.`;
    }

    return `${count} geo-events detected near ${name} in the past 24 hours. No headline coverage yet — monitoring via GDELT satellite data.`;
}

// ═══════════════════════════════════════════════════════
// AUTO-CATEGORY
// ═══════════════════════════════════════════════════════

function categorizeSituation(cluster) {
    const allText = cluster.events.map(e => (e.title || e.name || '').toLowerCase()).join(' ');

    for (const cat of CATEGORY_PATTERNS) {
        for (const term of cat.terms) {
            if (allText.includes(term)) return cat.label;
        }
    }

    return 'Geopolitical Tension';
}

// ═══════════════════════════════════════════════════════
// AUTO-SCORING
// ═══════════════════════════════════════════════════════

/**
 * Score a cluster 1–10 based on:
 *  - Event count (volume)
 *  - Severity terms in headlines
 *  - Average tone (more negative = higher)
 */
function scoreSituation(cluster) {
    const count = cluster.events.length;
    const allText = cluster.events.map(e => (e.title || e.name || '').toLowerCase()).join(' ');

    // Volume score: 1 event = 1, 5+ events = 4, 15+ = 6, 30+ = 8
    let volumeScore = Math.min(count / 4, 8);

    // Severity keyword score
    let severityScore = 0;
    for (const term of SEVERITY_TERMS.critical) {
        if (allText.includes(term)) { severityScore = Math.max(severityScore, 3); break; }
    }
    if (severityScore < 3) {
        for (const term of SEVERITY_TERMS.elevated) {
            if (allText.includes(term)) { severityScore = Math.max(severityScore, 2); break; }
        }
    }
    if (severityScore < 2) {
        for (const term of SEVERITY_TERMS.moderate) {
            if (allText.includes(term)) { severityScore = Math.max(severityScore, 1); break; }
        }
    }

    // Tone score: extract average tone from events that have it
    const tones = cluster.events.filter(e => e.tone).map(e => e.tone);
    let toneScore = 0;
    if (tones.length > 0) {
        const avgTone = tones.reduce((a, b) => a + b, 0) / tones.length;
        // More negative = higher severity. GDELT tone: -10 (very neg) to +10 (very pos)
        toneScore = Math.max(0, Math.min(2, (-avgTone) / 5));
    }

    const raw = volumeScore + severityScore + toneScore;
    return Math.round(Math.min(10, Math.max(1, raw)) * 10) / 10;
}

/**
 * Classify severity from score.
 */
function classifyStatus(score) {
    if (score >= 6.5) return 'critical';
    if (score >= 4) return 'elevated';
    return 'stable';
}

// ═══════════════════════════════════════════════════════
// PARTY EXTRACTION
// ═══════════════════════════════════════════════════════

function extractParties(cluster) {
    const countryMentions = {};

    for (const ev of cluster.events) {
        const text = ev.title || ev.name || '';
        const locations = extractLocations(text);
        for (const loc of locations) {
            countryMentions[loc.name] = (countryMentions[loc.name] || 0) + 1;
        }
    }

    // Top 4 parties
    return Object.entries(countryMentions)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 4)
        .map(([name]) => name);
}

// ═══════════════════════════════════════════════════════
// TOP ARTICLES from cluster
// ═══════════════════════════════════════════════════════

function extractTopArticles(cluster) {
    return cluster.events
        .filter(e => {
            const text = e.title || e.name || '';
            return text.length > 20 && /[a-zA-Z]/.test(text) && !isLocationString(text);
        })
        .slice(0, 5)
        .map(e => ({
            title: e.title || e.name || 'Untitled',
            url: e.url || e.link || '#',
            source: e.source || 'Unknown',
            tone: e.tone !== undefined ? e.tone : null,
        }));
}

// ═══════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════

/**
 * Process raw events (from GDELT + RSS) into discovered situations.
 * @param {Array} events — [{ lat, lng, title, source, ... }]
 * @returns {Array} situations ready for the frontend
 */
function discoverSituations(events) {
    if (!events || events.length === 0) return [];

    // 1. Cluster by proximity
    const clusters = clusterEvents(events);

    // 2. Discard noise (clusters with only 1 event)
    const significant = clusters.filter(cl => cl.events.length >= 2);

    // 3. Build situation objects
    const situations = significant.map((cl, idx) => {
        const name = autoNameSituation(cl);
        const score = scoreSituation(cl);

        return {
            id: `auto-${idx}-${Math.round(cl.centerLat)}-${Math.round(cl.centerLng)}`,
            name,
            lat: cl.centerLat,
            lng: cl.centerLng,
            status: classifyStatus(score),
            score,
            type: categorizeSituation(cl),
            description: autoDescribeSituation(cl),
            parties: extractParties(cl),
            region: findNearestCountry(cl.centerLat, cl.centerLng)?.name || 'Unknown',
            articleCount: cl.events.length,
            topArticles: extractTopArticles(cl),
            lastChecked: new Date().toISOString(),
        };
    });

    // 4. Deduplicate by exact name (keep the one with the highest score)
    const dedupedMap = new Map();
    for (const sit of situations) {
        if (!dedupedMap.has(sit.name) || dedupedMap.get(sit.name).score < sit.score) {
            dedupedMap.set(sit.name, sit);
        }
    }
    const dedupedSituations = Array.from(dedupedMap.values());

    // 5. Sort by score descending
    dedupedSituations.sort((a, b) => b.score - a.score);

    // 6. Cap at 30 situations
    return dedupedSituations.slice(0, 30);
}


// ═══════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════
module.exports = {
    GAZETTEER,
    GEO_THEMES,
    extractLocations,
    buildGeoQuery,
    parseGeoResponse,
    clusterEvents,
    discoverSituations,
    haversineKm,
    findNearestCountry,
    classifyStatus,
};
