'use strict';
const fs=require('node:fs');
const {runPipeline,advanceAlerts}=require('../pipeline');
// Input: JSON array of {now, articles, successful}; output has no persistence side effects.
const input=process.argv[2];if(!input)throw new Error('Usage: node scripts/replay.js recorded-cycles.json');
let previous=[],state={};
for(const cycle of JSON.parse(fs.readFileSync(input,'utf8'))){
    const result=runPipeline(cycle.articles,{now:cycle.now,previous});
    const transitions=advanceAlerts(result.situations,state,{successful:cycle.successful!==false,now:cycle.now});
    state=transitions.state;previous=result.situations;
    console.log(JSON.stringify({now:cycle.now,situations:result.situations,alerts:transitions.alerts}));
}
