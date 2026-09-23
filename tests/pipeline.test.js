'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {runPipeline,advanceAlerts,canonicalUrl,VERSION}=require('../pipeline');
const {parseDocResponse,THEME_GROUPS,buildGeoQuery}=require('../discovery');
const now='2026-09-23T12:00:00Z';
const article=(title,source='one.example',other={})=>({title,url:`https://${source}/${encodeURIComponent(title)}`,pubDate:now,language:'English',...other});
const floodA=()=>article('Kenya flooding triggers mass evacuation across the region');
const floodB=()=>article('Kenya floods force mass evacuation throughout the region','two.example');
function run(input,options={}){return runPipeline(input,{now,...options});}
test('football is excluded on every ingestion path, regardless of query tags and copies',()=>{
    const raw=parseDocResponse({articles:[{title:'France and Germany battle for World Cup glory',url:'https://sports.example/a',language:'English'}]},THEME_GROUPS[0]);
    const result=run([...Array(50)].flatMap(()=>raw));
    assert.equal(result.articles.length,1);assert.equal(result.situations.length,0);assert.equal(result.articles[0].classification.relevance,'irrelevant');
});
test('final flood warning is retained and a stadium emergency remains relevant',()=>{
    for(const title of ['Kenya declares state of emergency after final flood warning','France football stadium evacuated after bomb exploded'])assert.equal(run([article(title)]).articles[0].classification.relevance,'relevant');
});
test('duplicates and syndicated copies cannot confirm or raise severity',()=>{
    const base=run([floodA()]);
    const repeated=run(Array.from({length:50},()=>floodA()));
    assert.equal(repeated.situations[0].score,base.situations[0].score);
    assert.equal(repeated.situations[0].articleCount,1);assert.equal(repeated.situations[0].evidenceState,'developing');
    const syndicated=run([floodA(),article(floodA().title,'other.example')]);
    assert.equal(syndicated.situations[0].evidenceState,'developing');
});
test('different original reports corroborate without changing severity',()=>{
    const result=run([floodA(),floodB()]);
    assert.equal(result.situations.length,1);assert.equal(result.situations[0].score,5);assert.equal(result.situations[0].evidenceState,'confirmed');
});
test('common wire attribution is not independent evidence',()=>{
    const result=run([{...floodA(),snippet:'Reuters reporting from the region'},{...floodB(),snippet:'Reuters reports from the area'}]);
    assert.equal(result.situations[0].evidenceState,'developing');
});
test('negation, historical reports, unsupported language, and thin geo mentions cannot score',()=>{
    for(const a of [article('Kenya reports no casualties after flooding'),article('Kenya commemorates anniversary of bombing'),article('Kenya flooding triggers evacuations','one.example',{language:'French'}),article('Kenya bombing','one.example',{_isGdelt:true})]){
        const result=run([a]);assert.equal(result.articles[0].classification.score,null);assert.ok(result.situations.every(s=>s.evidenceState==='developing'));
    }
});
test('undated and expired evidence cannot confirm; observation time is not publication time',()=>{
    const result=run([floodA(),{...floodB(),pubDate:null,observedAt:now}]);assert.equal(result.situations[0].evidenceState,'developing');
    assert.equal(run([{...floodA(),pubDate:'2026-09-21T12:00:00Z'}]).situations.length,0);
});
test('unrelated incidents in a country do not merge; ambiguous locations are not pinned',()=>{
    const result=run([article('Kenya flooding forces evacuation'),article('Kenya ambassadors sign diplomatic treaty')]);assert.equal(result.situations.length,2);
    const cross=run([article('France and Germany diplomatic talks begin')]);assert.equal(cross.situations[0].lat,null);assert.equal(cross.situations[0].locationPrecision,'unknown');
});
test('identity survives ordering and refresh, and article overlap takes priority',()=>{
    const one=run([floodA(),floodB()]);const two=run([floodB(),floodA()],{previous:one.situations});assert.equal(one.situations[0].id,two.situations[0].id);
});
test('severity increases require novel evidence and two healthy cycles; restart and repeats are safe',()=>{
    const base={...run([floodA(),floodB()]).situations[0],score:2,status:'stable'};
    let state=advanceAlerts([base],{}, {now}).state;
    const high={...base,score:8,status:'critical',evidenceIds:['new-a','new-b']};
    let step=advanceAlerts([high],state,{now});assert.equal(step.alerts.length,0);
    step=advanceAlerts([high],JSON.parse(JSON.stringify(step.state)),{now});assert.equal(step.alerts.length,1);
    assert.equal(advanceAlerts([high],step.state,{now}).alerts.length,0);
    assert.equal(advanceAlerts([base,high],{}, {now,successful:false}).alerts.length,0);
});
test('partial failures and disappearance break consecutive alert confirmation',()=>{
    const base={...run([floodA(),floodB()]).situations[0],score:2,status:'stable'};
    const high={...base,score:8,status:'critical',evidenceIds:['new']};
    let state=advanceAlerts([base],{}).state;state=advanceAlerts([high],state).state;
    state=advanceAlerts([],state,{successful:false}).state;
    assert.equal(advanceAlerts([high],state).alerts.length,0);
});
test('canonical URLs remove tracking and reject unsafe schemes',()=>{
    assert.equal(canonicalUrl('javascript:alert(1)'),'');assert.equal(canonicalUrl('https://example.com/a?utm_source=x&b=2#fragment'),'https://example.com/a?b=2');
});
test('query builder groups OR expressions and quotes phrases',()=>{
    const q=new URL(buildGeoQuery('military operation OR missile')).searchParams.get('query');assert.equal(q,'("military operation" OR missile)');
});
