'use strict';

// Freeze the current reviewed labels into an immutable, hash-addressed input
// for ml/train.py. This never changes labels or promotes a model.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const db = require('../db');

const output = process.argv[2];
if (!output) throw new Error('Usage: DB_PATH=monitor.db node scripts/freeze-review.js artifacts/review-v1');
if (fs.existsSync(output)) throw new Error(`Refusing to overwrite existing freeze: ${output}`);

db.init();
try {
    const items = db.exportLabels();
    if (!items.length) throw new Error('No reviewed labels exist yet; review evidence at /review first');
    const stats = db.reviewStats();
    const usable = stats.counts.relevance.relevant + stats.counts.relevance.irrelevant;
    if (usable < 10 || !stats.counts.relevance.relevant || !stats.counts.relevance.irrelevant) {
        throw new Error(`Refusing to freeze a training set with ${usable} usable labels; review both relevant and irrelevant examples first`);
    }
    const labels = { pipelineVersion:'evidence-v1', frozenAt:new Date().toISOString(), items };
    fs.mkdirSync(output,{recursive:true});
    const labelsPath = path.join(output,'labels.json');
    fs.writeFileSync(labelsPath,JSON.stringify(labels,null,2)+'\n',{flag:'wx'});
    const hash = createHash('sha256').update(fs.readFileSync(labelsPath)).digest('hex');
    const manifest = { version:1, pipelineVersion:'evidence-v1', labelsSha256:hash, rows:items.length, stats, frozenAt:labels.frozenAt };
    fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify(manifest,null,2));
} finally { db.close(); }
