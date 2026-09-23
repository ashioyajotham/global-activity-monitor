'use strict';
const { extractCountries, findNearest } = require('./countries-data');
const THEME_GROUPS = [
    {
        id: 'armed-violence',
        label: 'Armed Conflict',
        geoQuery: 'killed OR airstrike OR shelling OR bombing OR battle',
        docQuery: 'killed OR airstrike OR shelling OR bombing',
        severity: 'critical',
        category: 'Armed Conflict',
        weight: 1.5,
    },
    {
        id: 'military',
        label: 'Military Operations',
        geoQuery: 'military operation OR troops deployed OR missile OR drone strike',
        docQuery: 'military operation OR troops deployed OR missile',
        severity: 'critical',
        category: 'Military Operations',
        weight: 1.3,
    },
    {
        id: 'terrorism',
        label: 'Terrorism',
        geoQuery: 'terrorist attack OR extremist OR suicide bomb OR insurgent',
        docQuery: 'terrorist attack OR extremist OR suicide bomb',
        severity: 'critical',
        category: 'Terrorism',
        weight: 1.4,
    },
    {
        id: 'civil-unrest',
        label: 'Civil Unrest',
        geoQuery: 'protest OR riot OR uprising OR coup OR revolution',
        docQuery: 'protest OR riot OR uprising OR coup',
        severity: 'elevated',
        category: 'Civil Unrest',
        weight: 1.1,
    },
    {
        id: 'humanitarian',
        label: 'Humanitarian Crisis',
        geoQuery: 'refugee OR humanitarian crisis OR famine OR displacement',
        docQuery: 'refugee crisis OR humanitarian OR famine',
        severity: 'elevated',
        category: 'Humanitarian Crisis',
        weight: 1.2,
    },
    {
        id: 'wmd',
        label: 'WMD / Nuclear',
        geoQuery: 'nuclear weapon OR uranium enrichment OR warhead OR WMD',
        docQuery: 'nuclear weapon OR enrichment OR warhead',
        severity: 'critical',
        category: 'Nuclear Tension',
        weight: 1.5,
    },
    {
        id: 'crisis',
        label: 'General Crisis',
        geoQuery: 'crisis OR emergency OR martial law OR state of emergency',
        docQuery: 'crisis OR emergency OR martial law',
        severity: 'elevated',
        category: 'Crisis',
        weight: 1.0,
    },
];

const SEVERITY_SCORE = { critical: 3, elevated: 2, moderate: 1 };

// ═══════════════════════════════════════════════════════
// GDELT ENDPOINT BUILDERS
// ═══════════════════════════════════════════════════════

function buildGeoQuery(query) {
    // GEO 2.0 API: mode=PointData returns GeoJSON point features
    // Default timespan is 24h, no need to specify
    // Docs: https://blog.gdeltproject.org/gdelt-geo-2-0-api-debuts/
    return `https://api.gdeltproject.org/api/v2/geo/geo?query=${encodeURIComponent('(' + query.split(' OR ').map(term => term.includes(' ') ? '"' + term + '"' : term).join(' OR ') + ')')}&mode=PointData&format=GeoJSON`;
}

function buildDocQuery(query, maxRecords = 75) {
    // DOC 2.0 API: mode=artlist returns article list as JSON
    // Timespan: number + unit (e.g. "24h", "1440min")
    return `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent('(' + query.split(' OR ').map(term => term.includes(' ') ? '"' + term + '"' : term).join(' OR ') + ')')}&mode=artlist&timespan=24h&maxrecords=${maxRecords}&format=json&sort=datedesc`;
}

// ═══════════════════════════════════════════════════════
// PARSERS — tag events with theme metadata
// ═══════════════════════════════════════════════════════

function parseGeoResponse(geojson, themeGroup) {
    if (!geojson?.features) return [];
    return geojson.features
        .filter(f => f.geometry?.coordinates)
        .filter(f => {
            const [lng, lat] = f.geometry.coordinates;
            return !(lat === 0 && lng === 0) && !(Math.abs(lat) < 0.01 && Math.abs(lng) < 0.01);
        })
        .map(f => {
            const [lng, lat] = f.geometry.coordinates;
            const props = f.properties || {};
            let url = props.url || '', name = props.name || '';
            if (!url && props.html) { const m = props.html.match(/href="([^"]+)"/); if (m) url = m[1]; }
            if (!name && props.html) name = props.html.replace(/<[^>]+>/g, '').trim();
            return {
                lat, lng, name, url,
                source: 'gdelt-geo',
                tone: props.tone ?? 0,
                _isGdelt: true,
                _themeId: themeGroup.id,
                _severity: themeGroup.severity,
                _category: themeGroup.category,
                _weight: themeGroup.weight,
            };
        });
}

function parseDocResponse(data, themeGroup) {
    if (!data?.articles) return [];
    return data.articles.map(art => {
        const countries = extractCountries(art.title || '');
        const primary = countries[0] || null;
        return {
            title: art.title || '', url: art.url || '', source: art.domain || 'unknown',
            sourceCountry: art.sourcecountry || '', language: art.language || '',
            lat: primary?.lat ?? null, lng: primary?.lng ?? null,
            countryName: primary?.name || null, allCountries: countries.map(c => c.name),
            tone: 0, observedAt: parseSeenDate(art.seendate), _isGdelt: false, _isDoc: true,
            _themeId: themeGroup.id,
            _severity: themeGroup.severity,
            _category: themeGroup.category,
            _weight: themeGroup.weight,
        };
    });
}


function parseSeenDate(value) {
    if (!value) return null;
    const m = String(value).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}
const { runPipeline } = require('./pipeline');
function discoverSituations(events, options) { return runPipeline(events, options).situations; }
module.exports = { THEME_GROUPS, buildGeoQuery, buildDocQuery, parseGeoResponse, parseDocResponse,
    extractCountries, findNearest, discoverSituations };
