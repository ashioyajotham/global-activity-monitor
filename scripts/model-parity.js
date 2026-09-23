'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {loadModel,predict}=require('../model');
const filename=process.argv[2];
if(!filename)throw new Error('Usage: node scripts/model-parity.js path/to/model.json');
const model=loadModel(filename), fixtures=JSON.parse(fs.readFileSync(filename+'.parity.json','utf8'));
for(const fixture of fixtures)assert.ok(Math.abs(predict(model,fixture.text).probability-fixture.probability)<1e-10,fixture.text);
console.log(`${fixtures.length} Python/Node probability parity cases passed`);
