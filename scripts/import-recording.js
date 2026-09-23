'use strict';
const fs=require('node:fs');
const db=require('../db');
const {runPipeline}=require('../pipeline');
if(!process.argv[2] || !process.env.DB_PATH)throw new Error('Set DB_PATH to a review-only database; pass a JSON array of recorded raw articles');
const now=new Date().toISOString();
const result=runPipeline(JSON.parse(fs.readFileSync(process.argv[2],'utf8')),{now});
db.init();try{db.storeCycle(result,{status:'recording',sources:[]},{},[],now);console.log(`Imported ${result.articles.length} reports for review; no labels were approved`);}finally{db.close();}
