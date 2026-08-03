let social_posts=[];
let social_summary=[];
let socialPosts=social_posts;
let socialSummary=social_summary;
let socialPostsLoaded=false;
let socialSummaryLoaded=false;
let socialDataUpdatedAt='';

const SOCIAL_ALIASES={
  '1810.HK':['1810','小米','小米集团','小米集团-W'],
  '601138.SS':['601138','工业富联','富士康工业互联网','FII'],
  '6869.HK':['6869','长飞光纤','长飞光纤光缆'],
  '2899.HK':['2899','紫金','紫金矿业'],
  '1357.HK':['1357','美图','美图公司'],
  '605499.SS':['605499','东鹏','东鹏饮料'],
  '603296.SS':['603296','华勤','华勤技术']
};

function normalizeText(v){return String(v||'').trim()}
function normalizeCode(v){return normalizeText(v).toUpperCase()}
function stripSuffix(v){return normalizeCode(v).replace(/\.(HK|SS|SZ)$/,'').replace(/^0+/,'')}
function uniqueNonEmpty(arr){return [...new Set(arr.map(x=>normalizeText(x)).filter(Boolean))]}
function normalizeSentiment(v){
  const s=normalizeText(v).toLowerCase();
  if(['bullish','positive','pos','利多','看多'].includes(s))return 'positive';
  if(['bearish','negative','neg','利空','看空'].includes(s))return 'negative';
  return 'neutral';
}
function sentimentWord(score,count){
  if(!count)return '暂无';
  if(score>=0.35)return '偏利多';
  if(score<=-0.35)return '偏利空';
  if(score>0)return '略偏利多';
  if(score<0)return '略偏利空';
  return '中性/分歧';
}
function normalizeSocialPost(p){
  const tags=Array.isArray(p.tags)?p.tags:[];
  const matched_keywords=Array.isArray(p.matched_keywords)?p.matched_keywords:[];
  const aliases=Array.isArray(p.aliases)?p.aliases:(Array.isArray(p.alias)?p.alias:[]);
  return {
    platform:normalizeText(p.platform),
    symbol:normalizeText(p.symbol||p.code),
    company:normalizeText(p.company||p.name),
    post_time:normalizeText(p.post_time||p.time||p.created_at),
    content:normalizeText(p.content||p.text),
    url:normalizeText(p.url),
    likes:Number(p.likes)||0,
    comments:Number(p.comments)||0,
    sentiment:normalizeSentiment(p.sentiment),
    tags:uniqueNonEmpty(tags),
    matched_keywords:uniqueNonEmpty(matched_keywords),
    aliases:uniqueNonEmpty(aliases),
    summary:normalizeText(p.summary),
    risk_points:Array.isArray(p.risk_points)?p.risk_points.map(String):[]
  };
}
function normalizeTopic(t){
  if(typeof t==='string')return {keyword:t,count:1};
  return {keyword:normalizeText(t.keyword||t.word||t.name),count:Number(t.count||t.value)||0};
}
function normalizeSocialSummary(x){
  const topics=x.hot_keywords||x.hot_topics||[];
  const aliases=Array.isArray(x.aliases)?x.aliases:(Array.isArray(x.alias)?x.alias:[]);
  const updated=normalizeText(x.updated_at||x.update_time||x.generated_at||x.date);
  return {
    symbol:normalizeText(x.symbol||x.code),
    company:normalizeText(x.company||x.name),
    aliases:uniqueNonEmpty(aliases),
    today_heat:Number(x.today_heat||x.heat||x.hotness||x.post_count)||0,
    post_count:Number(x.post_count||x.count)||0,
    sentiment_score:Number(x.sentiment_score||x.score)||0,
    hot_keywords:(Array.isArray(topics)?topics:[]).map(normalizeTopic).filter(t=>t.keyword),
    updated_at:updated,
    summary:normalizeText(x.summary),
    ai_brief:normalizeText(x.ai_brief),
    bullish_points:Array.isArray(x.bullish_points)?x.bullish_points.map(String):[],
    bearish_points:Array.isArray(x.bearish_points)?x.bearish_points.map(String):[],
    risk_points:Array.isArray(x.risk_points)?x.risk_points.map(String):[],
    review_flags:Array.isArray(x.review_flags)?x.review_flags.map(String):[]
  };
}
function setSocialPosts(data){
  const arr=Array.isArray(data)?data:(Array.isArray(data&&data.social_posts)?data.social_posts:[]);
  social_posts=arr.map(normalizeSocialPost);
  socialPosts=social_posts;
  socialPostsLoaded=true;
  if(arr.length&&!socialDataUpdatedAt)socialDataUpdatedAt=new Date().toISOString();
}
function setSocialSummary(data){
  const arr=Array.isArray(data)?data:(Array.isArray(data&&data.social_summary)?data.social_summary:[]);
  social_summary=arr.map(normalizeSocialSummary);
  socialSummary=social_summary;
  socialSummaryLoaded=true;
  const latest=social_summary.map(x=>x.updated_at).filter(Boolean).sort().pop();
  if(latest)socialDataUpdatedAt=latest;
}
async function loadJsonFile(file){
  const res=await fetch(file,{cache:'no-store'});
  if(!res.ok)throw new Error(file+' '+res.status);
  return res.json();
}
async function loadSocialPosts(){
  await Promise.all([
    loadJsonFile('social_posts.json').then(setSocialPosts).catch(e=>{setSocialPosts(window.SOCIAL_POSTS||[]);console.warn('social_posts.json 未加载，使用内置数据。',e)}),
    loadJsonFile('social_summary.json').then(setSocialSummary).catch(e=>{setSocialSummary(window.SOCIAL_SUMMARY||[]);console.warn('social_summary.json 未加载，将用帖子临时聚合。',e)})
  ]);
  updateSocialDataStatus();
}
function stockSocialKeys(s){
  const code=normalizeCode(s.code);
  const id=normalizeCode(s.id);
  const name=normalizeText(s.name);
  const noSuffix=stripSuffix(code);
  const aliases=Array.isArray(s.aliases)?s.aliases:(Array.isArray(s.alias)?s.alias:[]);
  const mapped=[...(SOCIAL_ALIASES[code]||[]),...(SOCIAL_ALIASES[id]||[])];
  return uniqueNonEmpty([code,noSuffix,id,name,...aliases,...mapped]).flatMap(x=>[x,normalizeCode(x),stripSuffix(x)]).filter(Boolean);
}
function itemSocialKeys(x){
  return uniqueNonEmpty([
    x.symbol,
    stripSuffix(x.symbol),
    x.company,
    ...(x.aliases||[]),
    ...(x.tags||[]),
    ...(x.matched_keywords||[]),
    ...(x.hot_keywords||[]).map(t=>t.keyword)
  ]).flatMap(v=>[v,normalizeCode(v),stripSuffix(v)]).filter(Boolean);
}
function matchesStockSocial(s,x){
  const keys=stockSocialKeys(s);
  const itemKeys=itemSocialKeys(x);
  if(keys.some(k=>itemKeys.includes(k)))return true;
  const stockName=normalizeText(s.name);
  const company=normalizeText(x.company);
  if(stockName&&company&&(stockName.includes(company)||company.includes(stockName)))return true;
  const haystack=[company,x.summary,x.content,...(x.tags||[]),...(x.aliases||[])].join(' ');
  // TODO(V6.6): use token-boundary matching for ASCII stock codes to reduce false positives.
  return keys.some(k=>k.length>=2&&haystack.includes(k));
}
function socialPostsForStock(s){return socialPosts.filter(p=>matchesStockSocial(s,p))}
function socialSummaryForStock(s){return socialSummary.find(x=>matchesStockSocial(s,x))||null}
function socialTodayKey(){return new Date().toISOString().slice(0,10)}
function socialPostScore(p){return (Number(p.likes)||0)+(Number(p.comments)||0)*2}
function aggregateSocialSummary(s){
  const posts=socialPostsForStock(s);
  const today=socialTodayKey();
  const todayPosts=posts.filter(p=>String(p.post_time||'').slice(0,10)===today);
  const source=todayPosts.length?todayPosts:posts;
  const scoreRaw=posts.reduce((sum,p)=>sum+(p.sentiment==='positive'?1:p.sentiment==='negative'?-1:0),0);
  const sentiment_score=posts.length?Number((scoreRaw/posts.length).toFixed(2)):0;
  const topicMap={};
  posts.flatMap(p=>(p.tags&&p.tags.length)?p.tags:(p.matched_keywords||[])).forEach(t=>{topicMap[t]=(topicMap[t]||0)+1});
  const hot_keywords=Object.keys(topicMap).sort((a,b)=>topicMap[b]-topicMap[a]).map(k=>({keyword:k,count:topicMap[k]}));
  const updated_at=posts.map(p=>p.post_time).filter(Boolean).sort().pop()||socialDataUpdatedAt||'';
  const bullish_points=socialPointList(posts,'positive',3);
  const bearish_points=socialPointList(posts,'negative',3);
  const risk_points=socialRiskList(posts,4);
  const review_flags=socialReviewFlags({post_count:posts.length,sentiment_score,risk_points,bullish_points,bearish_points});
  return {today_heat:source.reduce((sum,p)=>sum+socialPostScore(p),0),post_count:posts.length,sentiment_score,hot_keywords,updated_at,summary:'',ai_brief:socialAiBrief(s,posts.length,sentiment_score,bullish_points,bearish_points),bullish_points,bearish_points,risk_points,review_flags,_fromPosts:true};
}
function socialMetricForStock(s){
  const summary=socialSummaryForStock(s);
  return summary||aggregateSocialSummary(s);
}
function socialUpdatedLabel(value){
  if(!value)return '—';
  const d=new Date(value);
  return isNaN(d.getTime())?value:d.toLocaleString('zh-CN');
}
function socialHotTopicsHtml(topics){
  if(!topics||!topics.length)return '<span class="muted">暂无</span>';
  return `<div class="social-tags">${topics.slice(0,6).map(t=>`<span class="social-tag">${esc(t.keyword)}${t.count?` ×${fmtInt(t.count)}`:''}</span>`).join('')}</div>`;
}
function socialSentimentLabelFromMetric(m){
  return sentimentWord(Number(m.sentiment_score)||0,Number(m.post_count)||0);
}
function socialPointList(posts,sentiment,limit){
  const items=posts.filter(p=>p.sentiment===sentiment).sort((a,b)=>socialPostScore(b)-socialPostScore(a)).map(p=>p.summary||p.content).filter(Boolean);
  return [...new Set(items)].slice(0,limit);
}
function socialRiskList(posts,limit){
  return [...new Set(posts.flatMap(p=>p.risk_points||[]).filter(Boolean))].slice(0,limit);
}
const SOCIAL_REVIEW_FLAG_LABELS={
  high_heat:'热度明显升高',
  sentiment_divergence:'多空分歧',
  negative_risk:'负面风险集中',
  price_action_check:'需要结合价格走势复核',
  position_size_check:'需要结合仓位复核'
};
function socialReviewFlags(metric){
  const flags=[];
  const postCount=Number(metric.post_count)||0;
  const score=Number(metric.sentiment_score)||0;
  const hasBull=(metric.bullish_points||[]).length>0;
  const hasBear=(metric.bearish_points||[]).length>0;
  if(postCount>=5)flags.push('high_heat');
  if(postCount>=4&&hasBull&&hasBear&&Math.abs(score)<=0.35)flags.push('sentiment_divergence');
  if((metric.risk_points||[]).length)flags.push('negative_risk');
  if(postCount){flags.push('price_action_check');flags.push('position_size_check');}
  return flags;
}
function socialAiBrief(stock,postCount,score,bullishPoints,bearishPoints){
  const name=normalizeText(stock&&stock.name)||'该标的';
  if(!postCount)return `${name} 暂无可聚合舆情，需等待更多数据。`;
  let tone='舆情整体中性';
  if(score>=0.35)tone='舆情暂偏利多';
  else if(score<=-0.35)tone='舆情暂偏利空';
  else if(postCount>=4&&bullishPoints.length&&bearishPoints.length)tone='多空观点分歧较大';
  return `${name} 近端共 ${fmtInt(postCount)} 条社媒/新闻记录，${tone}，仅用于投资复核。`;
}
function socialEnsureReviewMetric(metric,stock,posts){
  const m=Object.assign({},metric);
  if(!m.bullish_points||!m.bullish_points.length)m.bullish_points=socialPointList(posts,'positive',3);
  if(!m.bearish_points||!m.bearish_points.length)m.bearish_points=socialPointList(posts,'negative',3);
  if(!m.risk_points||!m.risk_points.length)m.risk_points=socialRiskList(posts,4);
  if(!m.review_flags||!m.review_flags.length)m.review_flags=socialReviewFlags(m);
  if(!m.ai_brief)m.ai_brief=socialAiBrief(stock,Number(m.post_count||posts.length)||0,Number(m.sentiment_score)||0,m.bullish_points,m.bearish_points);
  return m;
}
function socialPointListHtml(title,items,cls){
  if(!items||!items.length)return '';
  return `<div class="social-review-block ${cls||''}"><div class="social-label">${esc(title)}</div><ul>${items.slice(0,4).map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`;
}
function socialReviewPanelHtml(metric){
  const flags=metric.review_flags||[];
  const flagHtml=flags.length?`<div class="social-tags">${flags.map(f=>`<span class="social-tag">${esc(SOCIAL_REVIEW_FLAG_LABELS[f]||f)}</span>`).join('')}</div>`:'<span class="muted">暂无复核标签</span>';
  return `<div class="social-review"><div class="card-title">投资复核提示</div>${metric.ai_brief?`<div class="hint">${esc(metric.ai_brief)}</div>`:''}<div class="social-review-note">仅作信息复核，不构成买卖指令</div>${flagHtml}<div class="social-review-grid">${socialPointListHtml('利多观点',metric.bullish_points,'bullish')}${socialPointListHtml('利空观点',metric.bearish_points,'bearish')}${socialPointListHtml('风险点',metric.risk_points,'risk')}</div></div>`;
}
function socialTagsHtml(tags){
  if(!tags||!tags.length)return '';
  return `<div class="social-tags">${tags.slice(0,6).map(t=>`<span class="social-tag">${esc(t)}</span>`).join('')}</div>`;
}
function socialDisplayTags(p){
  return (p.tags&&p.tags.length)?p.tags:(p.matched_keywords||[]);
}
function socialRecentPostsHtml(posts){
  const recent=posts.slice().sort((a,b)=>String(b.post_time||'').localeCompare(String(a.post_time||''))).slice(0,5);
  if(!recent.length)return '<div class="social-empty">暂无代表性帖子</div>';
  return `<div class="social-list">${recent.map(p=>`<div class="social-post"><div class="social-post-head"><span>${esc(p.platform||'社媒')} · ${esc(p.post_time||'')}</span><span>${fmtInt(p.likes)}赞 / ${fmtInt(p.comments)}评</span></div><div>${esc(p.summary||p.content)}</div>${p.url?`<div><a href="${esc(p.url)}" target="_blank" rel="noopener">原帖链接</a></div>`:''}${socialTagsHtml(socialDisplayTags(p))}${p.risk_points.length?`<div class="social-risk">${p.risk_points.map(esc).join('；')}</div>`:''}</div>`).join('')}</div>`;
}
function socialDetailPanel(s){
  const posts=socialPostsForStock(s);
  const metric=socialEnsureReviewMetric(socialMetricForStock(s),s,posts);
  const loaded=socialPostsLoaded||socialSummaryLoaded;
  if(!loaded)return '<details class="social-panel"><summary>社媒舆情 · 加载中</summary><div class="social-empty">社媒数据加载中...</div></details>';
  if(!metric.post_count&&!posts.length)return '<details class="social-panel"><summary>社媒舆情</summary><div class="social-empty">暂无匹配社媒数据</div></details>';
  const sentiment=socialSentimentLabelFromMetric(metric);
  return `<details class="social-panel"><summary>社媒舆情 · ${fmtInt(metric.post_count||posts.length)} 条 · ${esc(sentiment)}</summary><div class="social-grid"><div class="social-metric"><div class="social-label">今日热度</div><div class="social-value">${fmtInt(metric.today_heat)}</div></div><div class="social-metric"><div class="social-label">情绪分数</div><div class="social-value">${Number(metric.sentiment_score||0).toFixed(2)} · ${esc(sentiment)}</div></div><div class="social-metric"><div class="social-label">热门关键词</div><div class="social-value">${socialHotTopicsHtml(metric.hot_keywords)}</div></div><div class="social-metric"><div class="social-label">更新时间</div><div class="social-value">${esc(socialUpdatedLabel(metric.updated_at))}</div></div></div>${metric.summary?`<div class="hint">${esc(metric.summary)}</div>`:''}${socialReviewPanelHtml(metric)}<div class="card-title">最近代表性帖子</div>${socialRecentPostsHtml(posts)}</details>`;
}
function socialPanel(s){
  if(s.type==='etf')return '';
  const posts=socialPostsForStock(s);
  const metric=socialEnsureReviewMetric(socialMetricForStock(s),s,posts);
  const loaded=socialPostsLoaded||socialSummaryLoaded;
  const sentiment=socialSentimentLabelFromMetric(metric);
  const empty=loaded&&!metric.post_count&&!posts.length?'<div class="social-empty">暂无匹配的本地社媒数据。可通过“导入 social_posts.json”加载本地帖子。</div>':'';
  return `<tr class="social-row"><td class="social-cell" colspan="10"><details class="social-panel"><summary>社媒舆情 · ${fmtInt(metric.post_count||posts.length)} 条 · ${esc(sentiment)}</summary>${!loaded?'<div class="social-empty">社媒数据加载中...</div>':''}${empty}${loaded&&metric.post_count||posts.length?`<div class="social-grid"><div class="social-metric"><div class="social-label">今日热度</div><div class="social-value">${fmtInt(metric.today_heat)}</div></div><div class="social-metric"><div class="social-label">情绪分数</div><div class="social-value">${Number(metric.sentiment_score||0).toFixed(2)}</div></div><div class="social-metric"><div class="social-label">热门关键词</div><div class="social-value">${socialHotTopicsHtml(metric.hot_keywords)}</div></div><div class="social-metric"><div class="social-label">更新时间</div><div class="social-value">${esc(socialUpdatedLabel(metric.updated_at))}</div></div></div>${socialReviewPanelHtml(metric)}${socialRecentPostsHtml(posts)}`:''}</details></td></tr>`;
}
function updateSocialDataStatus(){
  const el=document.getElementById('socialDataStatus');
  if(!el)return;
  const summaryTimes=socialSummary.map(x=>x.updated_at).filter(Boolean);
  const postTimes=socialPosts.map(x=>x.post_time).filter(Boolean);
  const latest=[...summaryTimes,...postTimes,socialDataUpdatedAt].filter(Boolean).sort().pop();
  el.textContent='社媒数据更新时间：'+socialUpdatedLabel(latest);
}
function importSocialData(){document.getElementById('socialImportFile').click()}
function handleSocialImport(e){
  const file=e.target.files[0];
  if(!file)return;
  const r=new FileReader();
  r.onload=ev=>{
    try{
      const parsed=JSON.parse(ev.target.result);
      setSocialPosts(parsed);
      socialDataUpdatedAt=new Date().toISOString();
      const today=todayDate();
      state.stocks.forEach(s=>{
        const matched=socialPostsForStock(s);
        if(matched.length)touchDataFreshness(s,'socialUpdatedAt',today);
        if(matched.some(p=>String(p.platform||'').toLowerCase()==='news'))touchDataFreshness(s,'newsUpdatedAt',today);
      });
      saveState();
      updateSocialDataStatus();
      render();
      alert(`社媒数据导入成功：${socialPosts.length} 条帖子。`);
    }catch(err){
      alert('社媒数据导入失败：'+err.message);
    }
  };
  r.readAsText(file);
  e.target.value='';
}
