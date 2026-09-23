'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {createHash}=require('node:crypto');
const db=require('../db');
const {loadModel,promotionAllowed}=require('../model');
const [modelPath,reportPath,output]=process.argv.slice(2);
if(!output)throw new Error('Usage: node scripts/promote-model.js model.json test-report.json promotion.json');
if(fs.existsSync(output))throw new Error('Promotion output already exists');
const model=loadModel(modelPath),report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
if(!report.offlinePassed||report.modelHash!==model.hash)throw new Error('Offline gate failed or model differs');
const reportHash=createHash('sha256').update(fs.readFileSync(reportPath)).digest('hex');
const gate={modelHash:model.hash,pipelineVersion:'evidence-v1',offlinePassed:true,reviewedDisagreements:true,offlineReport:path.resolve(reportPath),offlineReportHash:reportHash};
db.init();
try{
    const shadow=db.shadowReport(model.hash);
    if(!require('../model').checkShadow(shadow))throw new Error('Need seven days of shadow observations and reviewed disagreements');
    fs.writeFileSync(output,JSON.stringify(gate,null,2)+'\n',{flag:'wx'});
    if(!promotionAllowed(model,output,shadow))throw new Error('Promotion validation failed');
    console.log('Promotion manifest written; set CLASSIFIER_MODE=model and MODEL_PROMOTION_PATH to this file, then restart.');
}finally{db.close();}
