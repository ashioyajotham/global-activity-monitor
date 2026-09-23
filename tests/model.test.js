'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {features,predict,checkShadow,promotionAllowed}=require('../model');
test('feature extraction and empty-vector abstention are deterministic',()=>{
    assert.deepEqual(features('A B'),['w:a','w:b','b:a b','c:a b']);
    const m={index:new Map([['w:flood',0]]),idf:[1],coefficients:[2],intercept:0,acceptThreshold:.8,rejectThreshold:.2,hash:'test'};
    assert.equal(predict(m,'flood').relevance,'relevant');assert.equal(predict(m,'unknown').relevance,'uncertain');
});
test('promotion rejects missing reports and incomplete shadow observation',()=>{
    assert.equal(promotionAllowed({hash:'test'},'/does-not-exist',[]),false);assert.equal(checkShadow([]),false);
    const rows=Array.from({length:8},(_,i)=>({recorded_at:`2026-09-${String(10+i).padStart(2,'0')}T00:00:00Z`,prediction:{relevance:'relevant'},baseline:{relevance:'irrelevant'},label:null}));
    assert.equal(checkShadow(rows),false);rows.forEach(r=>r.label={relevance:'relevant'});assert.equal(checkShadow(rows),true);
});
