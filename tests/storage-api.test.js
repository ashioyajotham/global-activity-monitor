'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const db=require('../db');
const {createApp,fetchJson}=require('../server');
const {runPipeline,VERSION}=require('../pipeline');
const now='2026-09-23T12:00:00Z';
const raw=[{title:'Kenya flooding triggers mass evacuation across the region',url:'https://one.example/a',pubDate:now},{title:'Kenya floods force mass evacuation throughout the region',url:'https://two.example/b',pubDate:now}];
test('additive migration preserves legacy data; empty cycles, labels, relationships and state round trip',()=>{
    const native=db.init(':memory:');
    native.exec('CREATE TABLE situation_snapshots(name TEXT,score REAL); INSERT INTO situation_snapshots VALUES(\'legacy\',10)');
    const result=runPipeline(raw,{now});db.storeCycle(result,{status:'ok'},{example:{version:VERSION}},[],now);
    assert.equal(db.getState('latest').situations[0].id,result.situations[0].id);
    assert.equal(native.prepare('SELECT count(*) n FROM evidence_links').get().n,2);
    const row=db.reviewQueue()[0];
    const label={relevance:'relevant',category:'Disaster',score:5,storyId:'kenya-flood',location:'Kenya',notes:'Checked',evidence:'mass evacuation',slice:'event'};
    assert.equal(db.saveLabel(row.article.id,label,0).revision,1);
    assert.throws(()=>db.saveLabel(row.article.id,label,0),/changed/);
    assert.equal(db.exportLabels().length,1);
    const reviewStats=db.reviewStats();assert.equal(reviewStats.reviewed,1);assert.equal(reviewStats.progress.totalReviewed.value,1);
    db.storeCycle({articles:[],situations:[],pipelineVersion:VERSION},{status:'ok'},{},[],now);
    assert.deepEqual(db.getState('latest').situations,[]);assert.equal(native.prepare('SELECT score FROM situation_snapshots').get().score,10);db.close();
});
test('API uses public allowlist, common envelope, safe review writes, and single-flight discovery',async()=>{
    db.init(':memory:');let calls=0,time=now,items=raw,failed=false;
    const controller=createApp({now:()=>time,fetchNewsImpl:async()=>({items,health:{success:failed?0:1,failed:failed?1:0}}),fetchGdeltImpl:async()=>{calls++;await new Promise(r=>setTimeout(r,10));return{events:[],sources:[{id:'test',status:failed?'failed':'ok'}]};}});
    const server=http.createServer(controller.app);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    try{
        await Promise.all([controller.runDiscovery(),controller.runDiscovery()]);assert.equal(calls,1);
        const data=await (await fetch(origin+'/api/activities')).json();assert.equal(data.source,'live');assert.equal(data.activities[0].evidenceState,'confirmed');
        for(const filename of ['/.env','/db.js','/monitor.db','/package.json','/pipeline.js'])assert.equal((await fetch(origin+filename)).status,404);
        const review=await (await fetch(origin+'/api/review')).json();assert.equal(review.items.length,2);
        assert.equal((await fetch(origin+'/api/review/'+review.items[0].article.id,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,403);
        time='2026-09-23T12:25:00Z';assert.equal((await (await fetch(origin+'/api/activities')).json()).source,'stale');
        failed=true;await controller.refreshNews();await controller.runDiscovery();assert.equal(controller.envelope().health.status,'failed');assert.equal(controller.envelope().activities[0].evidenceState,'developing');
        failed=false;items=[];await controller.refreshNews();await controller.runDiscovery();assert.equal(controller.envelope().activities.length,0);
    }finally{controller.close();await new Promise(resolve=>server.close(resolve));db.close();}
});
test('fetch timeout includes a response body that never completes',async()=>{
    const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{');});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{await assert.rejects(fetchJson('http://127.0.0.1:'+server.address().port,50));}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
});
