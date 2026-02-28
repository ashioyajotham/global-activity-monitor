# Global Activity Monitor — Hardcoding Audit & Autonomous Architecture Plan

## The Root Problem

The current architecture uses GDELT's **thinnest endpoint** (GEO API v2) which returns 
only coordinates + tone, then tries to reconstruct all the rich metadata that GDELT already 
computed — categories, entities, relevance — using **brittle keyword lists**.

GDELT's pipeline already runs NLP, entity extraction, CAMEO classification, and tone analysis 
on every article it ingests. We're throwing away that work and re-doing it badly.

---

## Complete Hardcoding Inventory

| # | What | Where | Count | Brittleness |
|---|------|-------|-------|-------------|
| 1 | **SVG continent blobs** | index.html | 11 fake paths | The map is not a map — it's hand-drawn shapes |
| 2 | **Country gazetteer** | discovery.js | 103 entries + aliases | Misses sub-national regions, territories, disputed areas. Regex matching fails on "Jordan Peterson", "Georgia (US state)" |
| 3 | **Severity keywords** | discovery.js | 40 terms in 3 tiers | "killed" scores same whether 1 person or 10,000. Misses euphemisms ("neutralized", "liquidated") |
| 4 | **Category patterns** | discovery.js | 12 categories × ~5 terms | The cricket-as-war bug. "Offensive" = military or sports? "Strike" = airstrike or labor? |
| 5 | **Noise filter terms** | discovery.js | 60+ sports/entertainment | Misses esports, awards ceremonies, new sports terms. Over-filters "Olympic boycott" (geopolitically relevant) |
| 6 | **Sentiment lexicon** | feeds.js | 80+ scored terms | Bag-of-words. "No casualties reported" scores negative because "casualties" = -5. Negation-blind |
| 7 | **GDELT query themes** | discovery.js | 5 static queries | Only finds events matching our preconceived keyword buckets. Misses cyberattacks, economic crises, pandemics entirely |
| 8 | **RSS feed list** | feeds.js | 9 URLs | Western + English-language bias. No Arabic, Chinese, Hindi, French sources |
| 9 | **Cluster radius** | discovery.js | Fixed 500km | Israel-Palestine (70km apart) gets one cluster. Russia-Ukraine front (1000km) might get split |
| 10 | **Score thresholds** | discovery.js | 6.5 / 4.0 static | On a quiet day, nothing hits critical. On a crisis day, everything does. No relative scaling |
| 11 | **TF-IDF stop words** | discovery.js | ~100 words | Standard, but still a hardcoded list |
| 12 | **Confidence thresholds** | discovery.js | 8 GDELT events / 3 RSS | Arbitrary cutoffs |

---

## Autonomous Alternatives

### 1. MAP: Real World Geometry

**Current:** 11 hand-drawn SVG `<path>` elements that look like blobs.

**Alternative: TopoJSON + D3 projection**

Use Natural Earth's public domain world boundaries (110m resolution, ~100KB as TopoJSON).
Render with D3.js `geoNaturalEarth1` projection directly into SVG.

```
Benefits:
- Real coastlines, country boundaries, lakes
- Hoverable countries (highlight on mouseover)
- Proper map projections (Natural Earth, Mercator, Equirectangular)
- Country-level click = filter activities by that country
- ~100KB TopoJSON from CDN (unpkg or jsdelivr), zero server cost

Implementation:
- Load world-110m.json from CDN at startup
- D3 renders paths into existing <svg> element
- Keep the same dark aesthetic (dark fill, subtle borders)
- Activity dots overlay on real geography
- Country hover shows name + active situation count
```

**File impact:** index.html only. Remove `continentPaths` array + `drawContinents()`. 
Add D3 + TopoJSON from CDN. New `drawMap()` function. ~50 lines of change.


### 2. GAZETTEER: Use GDELT's Native Geocoding

**Current:** 103-entry lookup table with regex matching. Fails on ambiguous names.

**Alternative: Let GDELT locate events for us**

The GDELT GEO API already returns coordinates. The GDELT DOC API returns 
`sourcelocationlat/lng` and can filter by `sourcelang` and `sourcecountry`.
For RSS articles, use a lightweight **reverse geocoder** instead of forward matching:

```
Approach A (preferred): Switch to GDELT Events API
- Events API returns: Actor1Geo_Lat, Actor1Geo_Long, Actor1CountryCode,
  Actor2CountryCode, ActionGeo_Lat, ActionGeo_Long
- Countries come pre-resolved by GDELT's geocoder (far more accurate than regex)
- No gazetteer needed

Approach B (supplement): Reverse geocode from coordinates  
- Given lat/lng from GDELT GEO → look up country via point-in-polygon
- Use Natural Earth boundaries (same data as the map)
- D3's geoContains(feature, [lng, lat]) does this in one call
- Replaces the entire GAZETTEER + extractLocations() function

Approach C (RSS fallback): GDELT DOC API for articles too
- Instead of parsing RSS feeds ourselves, query GDELT DOC API
- It returns articles WITH pre-extracted locations and entities
- Eliminates the need for feeds.js gazetteer matching entirely
```

**What gets deleted:** `GAZETTEER` (100+ lines), `COUNTRY_LOOKUP`, `extractLocations()`, 
`findNearestCountry()`. Replaced by reverse geocoding against map data or GDELT's own geocoding.


### 3. SEVERITY + CATEGORY: Use CAMEO Event Codes

**Current:** 40 severity keywords + 12 category patterns with fragile string matching.

**Alternative: GDELT CAMEO codes provide both classification AND severity natively**

```
CAMEO hierarchy (already computed by GDELT):
  01-09: Cooperative/diplomatic (low severity)
  10-13: Verbal conflict — demands, disapproval, threats (moderate)
  14:    Protest (moderate-elevated)
  15:    Military posture (elevated)
  16-17: Coercion, reduced relations (elevated)
  18:    Assault (critical)
  19:    Fight / armed conflict (critical)
  20:    Unconventional mass violence (critical)

Mapping is trivial and data-driven:
  const CAMEO_SEVERITY = {
    '18': 'critical', '19': 'critical', '20': 'critical',
    '15': 'elevated', '17': 'elevated',
    // etc — but this is a MAPPING of official codes, not keyword guessing
  };
```

The crucial difference: CAMEO codes are assigned by GDELT's production NLP pipeline 
(trained on millions of articles). Our keyword matching is a toy reimplementation.

**To access CAMEO codes:** Switch from GEO API → Events API or use the GDELT DOC API 
with `mode=artlist` which includes theme codes.

**What gets deleted:** `SEVERITY_TERMS` (all 40 keywords), `CATEGORY_PATTERNS` (all 12 patterns), 
`categorizeSituation()`, the severity scoring loop in `scoreSituation()`.


### 4. NOISE FILTERING: Statistical Instead of Keyword Lists

**Current:** 60+ sports/entertainment terms. Misses new terms, over-filters legitimate 
geopolitical sports events (Olympic boycotts, World Cup corruption).

**Alternative A: GDELT domain filtering**
GDELT DOC API accepts `domainis:` and `domainisnt:` filters. Exclude sports domains at query time:
```
query: conflict OR crisis
domainisnt: espn.com,sports.yahoo.com,bbc.co.uk/sport,...
```

**Alternative B: CAMEO code filtering**  
If an event has a CAMEO code, it's already classified as geopolitical. No sports event gets 
a CAMEO code. This is the cleanest filter — if it has a CAMEO code, it's relevant. Period.

**Alternative C: Topic clustering (most autonomous)**
Don't filter at all. Cluster events, then score clusters by:
- Average GDELT tone (sports articles tend toward neutral/positive)
- CAMEO code presence (geopolitical events have codes, sports don't)
- Source diversity (crisis = many diverse sources; sports = sports outlets only)

Clusters that are neutral-tone + no CAMEO codes + single-domain-type → auto-demote.

**What gets deleted:** `NOISE_TERMS` (60+ terms), `WEAK_SPORTS`, `classifyNoise()`, 
`filterNoiseEvents()`. Replaced by data-driven relevance scoring.


### 5. SENTIMENT: Use GDELT's Tone Score

**Current:** AFINN lexicon + 80-term geopolitical override. Negation-blind bag-of-words.

**Alternative: GDELT V2TONE (already computed per article)**

GDELT provides a 7-component tone vector for every article:
```
V2TONE: tone, positive_score, negative_score, polarity, 
        activity_ref_density, self_ref_density, word_count
```

The `tone` field is the overall sentiment (-100 to +100 scale). It's computed by 
GDELT's production pipeline which handles negation, context, and multi-language content.

For RSS articles (which don't go through GDELT), two options:
- **Keep sentiment library** but drop the custom lexicon (it's redundant with GDELT tone)
- **Cross-reference with GDELT DOC API**: search for the same article by title/URL, 
  get GDELT's tone score. More accurate but adds an API call.

Pragmatic approach: Use GDELT tone for GDELT-sourced events (the majority). 
Keep a lightweight sentiment for RSS-only articles, but drop the custom lexicon.

**What gets deleted:** `GEO_LEXICON` (80+ entries), `analyzeGeopoliticalTone()` simplifies 
to a thin wrapper. `multiWordTerms` list goes away.


### 6. CLUSTERING: Density-Adaptive Instead of Fixed Radius

**Current:** Fixed 500km radius. Too wide for dense regions (Middle East), too narrow for sparse ones (Russia).

**Alternative: DBSCAN-style adaptive clustering**

```
Instead of fixed radius:
1. Compute pairwise distances
2. Use the k-distance graph to find natural density breaks
3. Dense regions (Middle East) get tighter clusters (~100km)
4. Sparse regions (Pacific, Central Asia) get wider clusters (~800km)

Simpler alternative: Country-based clustering
- Since we'll have country codes from GDELT/reverse-geocoding:
  - Primary cluster key = country pair (Actor1Country, Actor2Country)
  - Sub-cluster by proximity within country pairs
  - "Israel-Palestine" is a natural cluster, not a distance calculation
```

**What gets deleted:** `CLUSTER_RADIUS_KM` constant. `clusterEvents()` evolves from 
distance-only to country-pair + distance hybrid.


### 7. SCORE THRESHOLDS: Percentile-Based Instead of Static

**Current:** 6.5 = critical, 4.0 = elevated. Doesn't adapt to global baseline.

**Alternative: Dynamic percentile thresholds**

```
Each discovery cycle:
1. Score all situations
2. Sort scores
3. Top 10% = critical
4. Next 20% = elevated  
5. Rest = stable

Benefits:
- On a quiet day, only truly notable situations flag critical
- On a crisis day (multiple wars), the threshold rises appropriately
- Self-calibrating — no magic numbers to tune

Fallback floor: If top 10% score < 3.0, force everything to stable 
(prevents noise from becoming "critical" on very quiet days)
```

**What changes:** `classifyStatus(score)` takes the full scores array as context.
Thresholds are computed per cycle, not hardcoded.


### 8. RSS FEEDS: Expand via GDELT DOC API

**Current:** 9 English-language feeds. Western bias.

**Alternative: Use GDELT DOC API as primary article source**

```
GDELT DOC API (mode=artlist):
- Ingests 300,000+ articles/day from 150+ countries
- All languages, auto-translated
- Pre-extracted: locations, entities, themes, tone
- Returns top articles matching any query

Query: (conflict OR crisis OR military OR protest) 
       timespan=24h, maxrecords=250, format=json

This single query replaces all 9 RSS feeds AND provides:
- Multi-language coverage
- Pre-computed tone
- Pre-extracted locations
- Source country metadata
```

Keep RSS as a supplementary signal (faster for breaking news, RSS updates before 
GDELT indexes). But GDELT DOC becomes the primary source.

**What changes:** `FEEDS` array stays but becomes supplementary. New `fetchGdeltArticles()` 
function becomes the primary data source. `feeds.js` shrinks significantly.


---

## Architecture Comparison

### Current Flow (keyword-heavy)
```
GDELT GEO API (thin: coords + tone only)
    ↓
60+ noise keywords → filter
    ↓
103-entry gazetteer → extract countries via regex  
    ↓
Fixed 500km → cluster
    ↓
40 severity keywords → score
    ↓
12 category patterns → classify
    ↓
80-term sentiment lexicon → re-score
    ↓
Static 6.5/4.0 thresholds → status
    ↓
Fake SVG blobs → render
```

### Proposed Flow (data-driven)
```
GDELT Events/DOC API (rich: CAMEO codes, entities, locations, tone)
  + RSS feeds (supplementary, fast breaking news)
    ↓
CAMEO code present? → geopolitically relevant (no keyword filter needed)
    ↓
GDELT's pre-extracted locations + reverse geocoding → country resolution
    ↓
Country-pair + density-adaptive → cluster
    ↓
CAMEO severity mapping + GDELT tone + source diversity → score
    ↓
Percentile-based thresholds (self-calibrating) → status
    ↓
Real TopoJSON map with D3 projection → render
```

**Lines of keyword lists deleted:** ~400+  
**Lines of data-driven logic added:** ~150  
**New external dependencies:** D3.js (CDN), topojson-client (CDN)  
**GDELT API calls:** Same rate budget (5 queries/10min), just using richer endpoints

---

## Implementation Priority

### Wave 1: Map + GDELT DOC API (biggest visual + data impact)
1. **Real map** — TopoJSON + D3 (replaces fake SVG blobs)
2. **GDELT DOC API** — primary article source with pre-computed metadata
3. **Delete gazetteer** — reverse geocode from map data instead

### Wave 2: Classification + Scoring (removes keyword lists)  
4. **CAMEO-based categories** — delete CATEGORY_PATTERNS and SEVERITY_TERMS
5. **CAMEO-based noise filter** — delete NOISE_TERMS (no CAMEO code = not geopolitical)
6. **GDELT tone** — delete GEO_LEXICON, use native tone scores

### Wave 3: Adaptive Intelligence (self-calibrating)
7. **Density-adaptive clustering** — delete CLUSTER_RADIUS_KM
8. **Percentile thresholds** — delete static 6.5/4.0 cutoffs
9. **Source diversity scoring** — multi-source = high confidence, single-source = low

---

## What STAYS Hardcoded (and why that's fine)

- **RSS feed URLs** (9 feeds) — these are configuration, not classification logic
- **CAMEO → severity mapping** — mapping official codes is a lookup table, not keyword guessing
- **TF-IDF stop words** — standard NLP, every system has these
- **Map projection choice** — aesthetic decision (Natural Earth projection)
- **UI color scheme** — design choice
- **API rate limits** — external constraint
