'use strict';
const fs = require('node:fs');
const {createHash} = require('node:crypto');
function features(text) {
    const words = text.toLowerCase().match(/[a-z0-9]+/g) || [];
    const output = words.map(w => `w:${w}`);
    for (let i=0;i<words.length-1;i++) output.push(`b:${words[i]} ${words[i+1]}`);
    // Identical ASCII preprocessing in Python and Node; non-English is gated upstream.
    const normalized = words.join(' ');
    for (let n=3;n<=5;n++) for (let i=0;i<=normalized.length-n;i++) output.push(`c:${normalized.slice(i,i+n)}`);
    return output;
}
function loadModel(filename) {
    const bytes = fs.readFileSync(filename), m = JSON.parse(bytes);
    if (m.version !== 'tfidf-logreg-v1' || !Array.isArray(m.vocabulary) || !Array.isArray(m.idf) || !Array.isArray(m.coefficients) ||
        m.vocabulary.length !== m.idf.length || m.idf.length !== m.coefficients.length || !m.idf.length ||
        ![...m.idf,...m.coefficients,m.intercept,m.acceptThreshold,m.rejectThreshold].every(Number.isFinite) ||
        m.rejectThreshold < 0 || m.acceptThreshold > 1 || m.rejectThreshold >= m.acceptThreshold) throw new Error('Invalid model artifact');
    m.hash = createHash('sha256').update(bytes).digest('hex');
    m.index = new Map(m.vocabulary.map((v,i) => [v,i]));
    return m;
}
function predict(model,text) {
    const counts = new Map();
    for (const f of features(text)) { const i=model.index.get(f); if (i !== undefined) counts.set(i,(counts.get(i)||0)+1); }
    let norm=0;
    for (const [i,count] of counts) { const v=(1+Math.log(count))*model.idf[i]; counts.set(i,v); norm+=v*v; }
    norm=Math.sqrt(norm); let logit=model.intercept;
    if (norm) for (const [i,v] of counts) logit+=v/norm*model.coefficients[i];
    const probability=1/(1+Math.exp(-logit));
    return { probability, relevance: !norm ? 'uncertain' : probability >= model.acceptThreshold ? 'relevant' : probability <= model.rejectThreshold ? 'irrelevant' : 'uncertain', modelHash:model.hash };
}
function checkShadow(shadow) {
    const dates=shadow.map(r=>Date.parse(r.recorded_at)).filter(Number.isFinite);
    const days=new Set(shadow.map(r=>r.recorded_at.slice(0,10)));
    if(!dates.length || Math.max(...dates)-Math.min(...dates)<7*86400000 || days.size<7)return false;
    return shadow.filter(r=>r.prediction.relevance!==r.baseline.relevance).every(r=>r.label!==null);
}
function promotionAllowed(model,filename,shadow) {
    try {
        const gate=JSON.parse(fs.readFileSync(filename,'utf8'));
        if(gate.modelHash!==model.hash || gate.pipelineVersion!=='evidence-v1' || !gate.reviewedDisagreements)return false;
        const bytes=fs.readFileSync(gate.offlineReport);
        if(createHash('sha256').update(bytes).digest('hex')!==gate.offlineReportHash)return false;
        const report=JSON.parse(bytes);
        if(report.modelHash!==model.hash || report.datasetManifestHash!==model.datasetManifestHash || report.pipelineVersion!=='evidence-v1' || !report.offlinePassed || !report.sufficientSample)return false;
        const c=report.candidate,b=report.baseline,s=report.slices?.['routine-sports'];
        return c.n>=200 && c.positives>=50 && c.n-c.positives>=50 && c.precision>=.95 && c.recall>=.8 && c.fp<b.fp && c.recall>=b.recall-.05 && s?.n>=30 && s.fp===0 && checkShadow(shadow);
    }catch{return false;}
}
module.exports={features,loadModel,predict,promotionAllowed,checkShadow};
