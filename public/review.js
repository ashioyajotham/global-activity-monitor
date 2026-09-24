'use strict';
let offset=0;
const queue=document.getElementById('queue'),status=document.getElementById('status'),progress=document.getElementById('progress');
function element(tag,text,parent){const el=document.createElement(tag);el.textContent=text;parent.appendChild(el);return el;}
function field(parent,name,value,options){const label=element('label',name,parent);const el=document.createElement(options?'select':name==='Notes'||name==='Supporting excerpt'?'textarea':'input');if(options)for(const option of options)el.add(new Option(option,option));el.value=value??'';label.appendChild(el);return el;}
async function load(){
    status.textContent='Loading…';
    const response=await fetch(`/api/review?limit=25&offset=${offset}&reviewed=${document.getElementById('reviewed').checked}`);
    if(!response.ok){status.textContent='Cannot load review queue: '+response.status;return;}
    const data=await response.json();queue.replaceChildren();
    status.textContent=data.items.length?`${data.items.length} reports; changes require an explicit Save.`:'No reports in this batch. Run a discovery scan or import recorded reports first.';
    for(const row of data.items){
        const a=row.article,s=row.label||{},suggested=a.classification;
        const card=element('article','',queue);element('h2',a.title,card);
        element('p',`${a.publisher} · ${a.publishedAt || 'Publication date unknown'} · ${a.language}`,card).className='meta';
        const link=element('a','Open source report',card);
        try{const u=new URL(a.url);if(['https:','http:'].includes(u.protocol)){link.href=u.href;link.target='_blank';link.rel='noopener noreferrer';}}catch{}
        element('blockquote',a.snippet || 'No excerpt available; open the source.',card);
        element('p',`Suggested: ${suggested.relevance} · ${suggested.category || 'Unclassified'} · ${suggested.score ?? 'unknown'} (${suggested.reasons.join(', ')})`,card);
        const relevance=field(card,'Relevance',s.relevance||'uncertain',['uncertain','relevant','irrelevant']);
        const category=field(card,'Category',s.category||suggested.category||'Unclassified',['Unclassified','Armed Conflict','Military Operations','Civil Unrest','Humanitarian Crisis','Disaster','Diplomacy']);
        const score=field(card,'Reported severity',s.score??'unknown',['unknown','2','5','8','10']);
        const slice=field(card,'Evaluation slice',s.slice||'ambiguous',['ambiguous','routine-sports','entertainment','routine-news','mixed-context','event']);
        const storyId=field(card,'Story group ID',s.storyId||a.storyId);
        const location=field(card,'Reported event location (blank if uncertain)',s.location||'');
        const evidence=field(card,'Supporting excerpt',s.evidence||'');
        const notes=field(card,'Notes',s.notes||'');
        const save=element('button','Save reviewed label',card),feedback=element('p','',card);
        save.addEventListener('click',async()=>{
            save.disabled=true;
            try{
                const result=await fetch('/api/review/'+a.id,{method:'POST',headers:{'Content-Type':'application/json','X-Review-Request':'1'},body:JSON.stringify({revision:row.revision,label:{relevance:relevance.value,category:category.value,score:score.value==='unknown'?null:Number(score.value),slice:slice.value,storyId:storyId.value.trim(),location:location.value.trim(),evidence:evidence.value.trim(),notes:notes.value.trim()}})});
                const body=await result.json();if(!result.ok)throw new Error(body.error);row.revision=body.revision;feedback.textContent='Saved revision '+body.revision;
            }catch(error){feedback.textContent=error.message;}finally{save.disabled=false;loadStats();}
        });
    }
}
async function loadStats(){
    try{
        const response=await fetch('/api/review/stats');if(!response.ok)throw new Error(response.status);
        const data=await response.json(),p=data.progress;
        progress.textContent=`Reviewed ${data.reviewed}/${data.total} · relevant ${p.relevant.value}/${p.relevant.target} · irrelevant ${p.irrelevant.value}/${p.irrelevant.target} · sports ${p['routine-sports'].value}/${p['routine-sports'].target} · event ${p.event.value}/${p.event.target}`;
    }catch(error){progress.textContent='Review progress unavailable: '+error.message;}
}
document.getElementById('reviewed').addEventListener('change',()=>{offset=0;load().catch(e=>status.textContent=e.message);});
document.getElementById('next').addEventListener('click',()=>{if(document.getElementById('reviewed').checked)offset+=25;else offset=0;load().catch(e=>status.textContent=e.message);});
document.getElementById('export').addEventListener('click',async()=>{try{const r=await fetch('/api/review/export');if(!r.ok)throw new Error('Export failed');const data=await r.json();const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='reviewed-labels.json';a.click();URL.revokeObjectURL(url);}catch(e){status.textContent=e.message;}});
Promise.all([load(),loadStats()]).catch(e=>status.textContent=e.message);
