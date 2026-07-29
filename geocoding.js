/**
 * geocoding.js — Google Geocoding API integration
 *
 * PROBLEM THIS SOLVES:
 * countries-data.js resolves a headline mention like "Goma" to DR Congo's
 * *country centroid* (Kinshasa's coordinates) because that's all the
 * hand-built gazetteer has. Every RSS-derived situation in a country the
 * size of Russia, Brazil, the US, or DR Congo lands on the same dot
 * regardless of which city/region the article is actually about — which
 * also degrades the 500km clustering downstream (ARCHITECTURE_PLAN.md,
 * item #9).
 *
 * This module forward-geocodes the *specific place name* extracted from a
 * headline (e.g. "Goma, DR Congo") via the Google Geocoding API, and falls
 * back to the existing country-centroid behavior whenever:
 *   - no API key is configured (GOOGLE_MAPS_API_KEY unset)
 *   - the lookup is only a bare country name (nothing more precise to gain)
 *   - the API call fails, times out, or returns no result
 *   - the daily self-imposed call budget has been exhausted
 *
 * This is an additive, fail-open layer — nothing breaks if it's absent.
 *
 * CACHING: every result (hit or confirmed miss) is cached forever in
 * SQLite (geocode_cache table) plus an in-memory Map for the process
 * lifetime. Place names repeat constantly across articles/months, so this
 * keeps the actual API bill small — a new city is usually geocoded once,
 * ever, not once per article.
 */

const db = require('./db');

const API_KEY = process.env.GOOGLE_MAPS_API_KEY || '';
const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// Self-imposed daily ceiling. Geocoding API is billed per request past the
// free tier; this is a safety valve so a runaway feed can't rack up a
// surprise bill. Generous for this app's actual volume (a handful of new
// place names per 5-minute RSS cycle once the cache warms up).
const DAILY_CALL_BUDGET = parseInt(process.env.GEOCODE_DAILY_BUDGET || '2500', 10);

// In-memory hot cache — avoids a SQLite round trip for the same place
// mentioned twice in one discovery cycle, and de-dupes concurrent in-flight
// requests for the same query.
const _memCache = new Map();      // query -> { lat, lng, formattedAddress } | null
const _inFlight = new Map();      // query -> Promise

let _callsToday = 0;
let _budgetDay = new Date().toISOString().slice(0, 10);

function _checkBudgetReset() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== _budgetDay) {
        _budgetDay = today;
        _callsToday = 0;
    }
}

function normalizeQuery(placeName, countryName) {
    return `${placeName}, ${countryName}`.toLowerCase().trim();
}

/**
 * Geocode a specific place mention, scoped to a country for disambiguation
 * (there are dozens of "Springfield"s; "Springfield, Illinois" resolves
 * reliably where bare "Springfield" wouldn't).
 *
 * Returns { lat, lng, formattedAddress } on success, or null if geocoding
 * isn't available/successful — callers should fall back to the country
 * centroid in that case.
 */
async function geocodePlace(placeName, countryName) {
    if (!API_KEY) return null;
    if (!placeName || !countryName) return null;

    const query = normalizeQuery(placeName, countryName);

    if (_memCache.has(query)) return _memCache.get(query);
    if (_inFlight.has(query)) return _inFlight.get(query);

    // Check persistent cache before spending a network call.
    const cached = db.getCachedGeocode(query);
    if (cached !== undefined) {
        const value = cached.found ? { lat: cached.lat, lng: cached.lng, formattedAddress: cached.formattedAddress } : null;
        _memCache.set(query, value);
        return value;
    }

    _checkBudgetReset();
    if (_callsToday >= DAILY_CALL_BUDGET) {
        console.warn(`[geocoding] Daily budget (${DAILY_CALL_BUDGET}) exhausted — falling back to country centroid for "${query}"`);
        return null;
    }

    const promise = _fetchGeocode(query).finally(() => _inFlight.delete(query));
    _inFlight.set(query, promise);
    return promise;
}

async function _fetchGeocode(query) {
    _callsToday++;
    const url = `${GEOCODE_URL}?address=${encodeURIComponent(query)}&key=${API_KEY}`;

    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();

        if (data.status === 'OVER_QUERY_LIMIT' || data.status === 'REQUEST_DENIED') {
            console.error(`[geocoding] API error for "${query}": ${data.status} — ${data.error_message || ''}`);
            // Don't cache hard API-level failures — they're not "no such place",
            // they're "we can't ask right now", so retry is legitimate later.
            _memCache.set(query, null);
            return null;
        }

        if (data.status !== 'OK' || !data.results?.length) {
            db.setCachedGeocode(query, null);
            _memCache.set(query, null);
            return null;
        }

        const top = data.results[0];
        const result = {
            lat: top.geometry.location.lat,
            lng: top.geometry.location.lng,
            formattedAddress: top.formatted_address,
        };
        db.setCachedGeocode(query, result);
        _memCache.set(query, result);
        return result;
    } catch (e) {
        console.error(`[geocoding] Lookup failed for "${query}": ${e.message}`);
        // Network hiccups shouldn't be cached as permanent misses.
        _memCache.set(query, null);
        return null;
    }
}

function isEnabled() {
    return !!API_KEY;
}

function getStatus() {
    _checkBudgetReset();
    return {
        enabled: isEnabled(),
        callsToday: _callsToday,
        dailyBudget: DAILY_CALL_BUDGET,
        memCacheSize: _memCache.size,
    };
}

module.exports = { geocodePlace, isEnabled, getStatus };
