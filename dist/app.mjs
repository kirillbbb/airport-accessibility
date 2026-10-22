import {resolveView} from './navigation.mjs';
import {query,summarize,calendar,hourly,episodeRows,timestamp,dayKey,dayStart,HOUR,DAY} from './model.mjs';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const number=n=>new Intl.NumberFormat('ru-RU',{maximumFractionDigits:1}).format(n);
const date=(v,opts={day:'numeric',month:'short'})=>new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Moscow',...opts}).format(new Date(v));
const clock=v=>date(v,{hour:'2-digit',minute:'2-digit'});
const duration=(ms,small=false)=>{const m=Math.round(ms/60000),h=Math.floor(m/60),r=m%60;return `${number(h)}${small?' <small>ч</small>':' ч'}${r?` ${r}${small?' <small>мин</small>':' мин'}`:''}`;};
const labels={suspended:'Приём и выпуск ограничены',coordinated:'По согласованию',open:'Ограничения сняты'};
const names={SVO:'Шереметьево',VKO:'Внуково',DME:'Домодедово',ZIA:'Жуковский'};
const defaults={from:'2026-09-23',to:'2026-10-23',airports:Object.keys(names),type:'all'};
let data,comparisonData,filters={...defaults,airports:[...defaults.airports]},q,days,focusDay='2026-10-22',page=0,journalPage=0;
const PAGE=8;
let eventMap;

function initFilters(restore=true){
 const p=new URLSearchParams(restore?location.search:'');
 const validDate=v=>/^2026-(09|10)-\d\d$/.test(v||'')&&v>=defaults.from&&v<=defaults.to&&Number.isFinite(dayStart(v))&&dayKey(dayStart(v))===v;
 if(validDate(p.get('from')))filters.from=p.get('from');
 if(validDate(p.get('to')))filters.to=p.get('to');
 if(p.has('airports'))filters.airports=p.get('airports').split(',').filter(a=>a in names);
 if(['all','suspended','coordinated'].includes(p.get('type')))filters.type=p.get('type');
 if(validDate(p.get('day')))focusDay=p.get('day');
 $('#date-from').value=filters.from;$('#date-to').value=filters.to;$('#type').value=filters.type;
 $('#airport-buttons').innerHTML=Object.keys(names).map(a=>`<button class="airport-toggle" data-airport="${a}" aria-pressed="${filters.airports.includes(a)}" title="${names[a]}">${a}</button>`).join('');
}
function saveState(){
 const p=new URLSearchParams({from:filters.from,to:filters.to,airports:filters.airports.join(','),type:filters.type,day:focusDay});
 history.replaceState(null,'',`${location.pathname}?${p}${location.hash||'#calendar'}`);
}
function validate(){
 const ok=filters.from&&filters.to&&filters.from<=filters.to&&filters.from>=defaults.from&&filters.to<=defaults.to;
 $('#validation').hidden=!!ok;
 $('#validation').textContent=ok?'':'Выберите даты от 23 сентября до 23 октября. Начало периода должно быть не позже окончания.';
 return ok;
}
function render(){
 const valid=validate();
 q=valid?query(data,filters):{start:timestamp(data.meta.start),end:timestamp(data.meta.start),airports:filters.airports,segments:[]};
 days=calendar(q);
 if(days.length&&!days.some(d=>d.key===focusDay))focusDay=days.at(-1).key;
 $('#airport-buttons').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',filters.airports.includes(b.dataset.airport)));
 renderMetrics();renderCalendar();renderMonthCalendar();renderComparison();renderHourly();renderTimeline();renderEpisodes();renderJournal();renderObservations();saveState();
}
function renderMetrics(){
 const s=summarize(q);
 $('#metrics').innerHTML=[
  ['Эпизоды по аэропортам',number(s.count),'Переходы режимов внутри — один эпизод','↗','featured'],
  ['Время под ограничениями',duration(s.total,true),'Сумма по аэропортам, с пересечениями','◷',''],
  ['Дни с записями об ограничениях',number(s.days),'По восстановленным интервалам','▦',''],
  ['Самый долгий эпизод',duration(s.longest,true),'Длительность в выбранном периоде','↔','']
 ].map(([label,value,help,icon,cls])=>`<article class="metric ${cls}"><div class="metric-label">${label}<span aria-hidden="true">${icon}</span></div><div class="metric-value">${value}</div><p>${help}</p></article>`).join('');
}
function renderCalendar(){
 if(!days.length){$('#calendar-chart').innerHTML='<div class="empty">Нет дней в выбранном периоде</div>';return;}
 const max=Math.max(HOUR,...days.map(d=>d.total));
 $('#calendar-chart').innerHTML=days.map((d,i)=>{
   const h=Math.max(d.total?3:1,d.total/max*145),sus=d.total?d.suspended/d.total*100:0;
   const month=(i===0||d.key.endsWith('-01'))?date(d.a,{month:'short'}).toUpperCase():'';
   const text=`${date(d.a)}${d.partial?' — неполный день':''}: ${duration(d.total)}, ${d.episodes} эпизодов по аэропортам. Нажмите для шкалы дня.`;
   return `<button class="calendar-day ${focusDay===d.key?'selected':''} ${d.partial?'partial':''}" data-day="${d.key}" aria-label="${esc(text)}" aria-pressed="${focusDay===d.key}" title="${esc(text)}">${month?`<span class="month-flag">${month}</span>`:''}<span class="bar-value">${number(d.total/HOUR)} ч</span><span class="bar-stack" style="height:${h}px"><span class="suspended" style="height:${sus}%"></span><span class="coordinated" style="height:${d.total?100-sus:0}%"></span></span><span class="day-label">${d.key.slice(-2)}</span></button>`;
 }).join('');
 $('#calendar-note').textContent=`МАКСИМУМ ${number(max/HOUR)} Ч${days.some(d=>d.partial)?' · ШТРИХОВКА — НЕПОЛНЫЙ ДЕНЬ':''}`;
}
function renderComparison(){
 const summary=Object.keys(names).map(a=>({a,s:summarize({...q,segments:q.segments.filter(s=>s.airport===a)})}));
 const max=Math.max(HOUR,...summary.map(x=>x.s.total));
 $('#comparison').innerHTML=summary.map(({a,s})=>`<div class="airport-row ${filters.airports.includes(a)?'':'disabled'}"><div class="airport-row-top"><span class="airport-code">${a}</span><span>${names[a]}</span><span class="duration">${duration(s.total)}</span></div><div class="airport-bar"><span class="suspended" style="width:${s.suspended/max*100}%"></span><span class="coordinated" style="width:${s.coordinated/max*100}%"></span></div><div class="airport-row-bottom"><span>${filters.airports.includes(a)?`${s.count} эпизодов · ${s.days} дней с записями`:'Не выбран'}</span><span>${s.total?`${Math.round(s.suspended/s.total*100)}% времени — приём и выпуск ограничены`:'Нет интервалов в выборке'}</span></div></div>`).join('');
}
function renderMonthCalendar(){
 const columns=Object.keys(names);
 const head=`<div class="month-header"><div class="month-date-head">ДАТА / МСК</div>${columns.map(a=>`<div class="month-airport-head ${q.airports.includes(a)?'':'excluded'}"><div><span class="airport-code">${a}</span> ${names[a]}${q.airports.includes(a)?'':' <small>не выбран</small>'}</div><div class="month-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>24</span></div></div>`).join('')}</div>`;
 const rows=days.map((d,index)=>{
  const midnight=dayStart(d.key),weekday=date(midnight,{weekday:'short'}),weekend=['сб','вс'].includes(weekday);
  return (index===15?head:'')+`<div class="month-row ${weekend?'weekend':''} ${d.partial?'partial-row':''}"><button class="month-date" data-month-day="${d.key}" aria-label="${date(midnight)}: список участков всех аэропортов"><time datetime="${d.key}"><b>${date(midnight)}</b><small>${weekday.toUpperCase()}${d.partial?' · СРЕЗ':''}</small></time></button>${columns.map(a=>{
   const selected=q.airports.includes(a),segments=q.segments.filter(s=>s.airport===a&&s.a<d.b&&s.b>d.a);
   const bars=segments.map(s=>{
    const start=Math.max(s.a,d.a),end=Math.min(s.b,d.b),left=(start-midnight)/DAY*100,width=(end-start)/DAY*100;
    const from=clock(start),to=end===midnight+DAY?'24:00':clock(end);
    const text=`${date(midnight)}, ${names[a]}: ${from}–${to} МСК, ${labels[s.status]}, ${duration(end-start)}. Подробнее и источники.`;
    return `<button class="month-interval ${s.status}" style="left:${left}%;width:${width}%" data-episode="${s.episode_id}" aria-label="${esc(text)}" title="${esc(text)}">${width>=22?`<span class="interval-time"><span>${from}</span><span class="time-separator">–</span><span>${to}</span></span>`:''}</button>`;
   }).join('');
   return `<div class="month-cell ${selected?'':'excluded'}"><div class="month-track">${bars}${d.partial?`<span class="censored-area" style="left:${(d.b-midnight)/DAY*100}%" title="После ${clock(d.b)} МСК — за пределами среза"></span>`:''}${!selected?'<span class="excluded-text">Не выбран</span>':''}</div></div>`;
  }).join('')}</div>`;
 }).join('');
 $('#month-calendar').innerHTML=head+(rows||'<div class="empty">Выберите корректный период</div>');
 $('#month-range').textContent=`ДАТ В ВЫБОРКЕ: ${days.length} · 4 АЭРОПОРТА · ВРЕМЯ МСК`;
}
function renderHourly(){
 const h=hourly(q),max=Math.max(.01,...h.map(x=>x.fraction));
 $('#hourly-chart').innerHTML=h.map(x=>{
  const value=number(x.fraction*100),sus=x.suspended+x.coordinated?x.suspended/(x.suspended+x.coordinated)*100:0;
  const text=`${String(x.hour).padStart(2,'0')}:00–${String(x.hour+1).padStart(2,'0')}:00 МСК: `+(x.exposure?`${value}% наблюдаемого аэропорто-времени под ограничениями`:'нет наблюдаемого времени в выборке; после среза данных нет');
  const fill=x.suspended+x.coordinated?`<span class="suspended" style="height:${sus}%"></span><span class="coordinated" style="height:${100-sus}%"></span>`:'';
  return `<button class="hour-column" style="height:${Math.max(2,x.fraction/max*85)}%" data-hour="${x.hour}" title="${esc(text)}" aria-label="${esc(text)}">${fill}</button>`;
 }).join('');
}
function renderTimeline(){
 const d=days.find(d=>d.key===focusDay);
 $('#timeline-title').textContent=d?date(d.a,{day:'numeric',month:'long',year:'numeric'})+(d.partial?' · неполный день':''):'Выберите период';
 $('#prev-day').disabled=!d||days.indexOf(d)<=0;$('#next-day').disabled=!d||days.indexOf(d)>=days.length-1;
 if(!d||!q.airports.length){$('#timeline').innerHTML='<div class="empty">Выберите хотя бы один аэропорт и корректный период</div>';return;}
 const midnight=dayStart(d.key);
 $('#timeline').innerHTML='<div class="time-axis"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div>'+q.airports.map(a=>{
  const seg=q.segments.filter(s=>s.airport===a&&s.a<d.b&&s.b>d.a);
  const bars=seg.map(s=>{
   const left=(Math.max(s.a,d.a)-midnight)/DAY*100,width=(Math.min(s.b,d.b)-Math.max(s.a,d.a))/DAY*100;
   const text=`${names[a]}: ${labels[s.status]}, ${clock(Math.max(s.a,d.a))}–${Math.min(s.b,d.b)===midnight+DAY?'24:00':clock(Math.min(s.b,d.b))}. Подробнее об эпизоде`;
   return `<button class="timeline-interval ${s.status}" style="left:${left}%;width:${width}%" data-episode="${s.episode_id}" title="${esc(text)}" aria-label="${esc(text)}"></button>`;
  }).join('');
  return `<div class="timeline-row"><span class="timeline-airport"><span class="airport-code">${a}</span>${names[a]}</span><div class="timeline-track">${bars}${d.partial?`<span class="censored-area" style="left:${(d.b-midnight)/DAY*100}%" title="После момента среза данных нет"></span>`:''}</div></div>`;
 }).join('');
}
function tag(status){return `<span class="regime-tag ${status}">${status==='coordinated'?'По согласованию':status==='open'?'Сняты':'Приём / выпуск'}</span>`;}
function renderEpisodes(){
 const rows=episodeRows(q,data);page=Math.min(page,Math.max(0,Math.ceil(rows.length/PAGE)-1));
 $('#episode-description').textContent=`${rows.length} эпизодов в выборке. Один эпизод может включать несколько режимов.`;
 if(!rows.length){$('#episodes').innerHTML='<div class="empty">Нет восстановленных эпизодов по этим фильтрам. Это не подтверждение отсутствия ограничений.</div>';return;}
 $('#episodes').innerHTML=`<div class="table-scroll"><table><thead><tr><th>АЭРОПОРТ</th><th>НАЧАЛО ЭПИЗОДА, МСК</th><th>РЕЖИМЫ В ВЫБОРКЕ</th><th>ВРЕМЯ В ВЫБОРКЕ</th><th>ИСТОЧНИК</th><th></th></tr></thead><tbody>${rows.slice(page*PAGE,(page+1)*PAGE).map(e=>`<tr><td><span class="airport-code">${e.airport}</span></td><td>${date(e.start)}<span class="time-detail">${clock(e.start)}</span>${timestamp(e.start)<q.start?' <span title="Начало раньше выбранного периода">↤</span>':''}</td><td><div class="regime-tags">${[...new Set(e.visible.map(s=>s.status))].map(tag).join('')}</div></td><td>${duration(e.duration)}</td><td><a href="${esc(eventMap.get(e.start_event)?.url)}" class="source-link" target="_blank" rel="noopener noreferrer">Росавиация ↗</a></td><td><button class="row-button" data-episode="${e.id}" aria-label="Подробности эпизода ${e.airport}, ${date(e.start)}">↗</button></td></tr>`).join('')}</tbody></table></div>${pagination('episodes',page,rows.length)}`;
}
function pagination(kind,p,total){const max=Math.ceil(total/PAGE);return `<div class="table-pagination"><span>${p*PAGE+1}–${Math.min((p+1)*PAGE,total)} из ${total}</span><div><button data-page="${kind}" data-delta="-1" ${p===0?'disabled':''} aria-label="Предыдущая страница">←</button><span>${p+1} / ${max}</span><button data-page="${kind}" data-delta="1" ${p>=max-1?'disabled':''} aria-label="Следующая страница">→</button></div></div>`;}
function renderJournal(){
 const search=($('#search').value||'').trim().toLowerCase();
 const rows=data.events.filter(e=>q.airports.includes(e.airport)&&timestamp(e.at)>=q.start&&timestamp(e.at)<q.end&&(filters.type==='all'||e.status===filters.type))
  .filter(e=>`${e.airport} ${names[e.airport]} ${e.at} ${labels[e.status]} ${e.excerpt}`.toLowerCase().includes(search)).sort((a,b)=>timestamp(b.at)-timestamp(a.at));
 journalPage=Math.min(journalPage,Math.max(0,Math.ceil(rows.length/PAGE)-1));
 if(!rows.length){$('#journal').innerHTML='<div class="empty">Нет публикаций по выбранным фильтрам и поиску</div>';return;}
 $('#journal').innerHTML=`<div class="table-scroll"><table><thead><tr><th>ПУБЛИКАЦИЯ, МСК</th><th>АЭРОПОРТ</th><th>ОБЪЯВЛЕННЫЙ РЕЖИМ</th><th>ПЕРВОИСТОЧНИК</th></tr></thead><tbody>${rows.slice(journalPage*PAGE,(journalPage+1)*PAGE).map(e=>`<tr><td>${date(e.at)}<span class="time-detail">${clock(e.at)}</span></td><td><span class="airport-code">${e.airport}</span> ${names[e.airport]}</td><td>${tag(e.status)}</td><td><a class="source-link" href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.post_id)} ↗</a></td></tr>`).join('')}</tbody></table></div>${pagination('journal',journalPage,rows.length)}`;
}
const observationDescription={
 'favt_info/8518':'8 октября: сводка сообщает о работе Жуковского по согласованию. Отдельный момент перехода не установлен.',
 'favt_info/8771':'16 октября: сводка сообщает о 106 задержанных рейсах московского авиаузла на 16:00. Это последствия, а не новый интервал ограничений.',
 'favt_info/8797':'17 октября: в сводке говорится о работе всех московских аэропортов по согласованию. Начало и окончание этого режима не установлены.'
};
function renderObservations(){
 const obs=data.observations.filter(o=>o.airports.some(a=>q.airports.includes(a))&&timestamp(o.published_at)>=q.start&&timestamp(o.published_at)<q.end);
 const html=`<h3>Сводки без установленных границ${obs.length?` · ${obs.length} наблюдения`:''}</h3><p>Некоторые сводки сообщают о режиме или последствиях без однозначных границ. Они сохранены отдельно и не добавляют часы к графикам. Этот блок показывает контекст всех режимов независимо от фильтра типа.</p>${obs.length?obs.map(o=>`<article class="observation"><time datetime="${o.published_at}">${date(o.published_at)} · ${clock(o.published_at)}</time><p>${esc(observationDescription[o.id]||o.reason)}</p><a class="source-link" href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">Сообщение ↗</a></article>`).join(''):'<p>Для выбранных дат и аэропортов нет отдельных непарных наблюдений.</p>'}`;
 $('#observations').innerHTML=html;$('#calendar-observations').innerHTML=html;
}
function renderSources(){
 const official=data.airport_reports.filter(x=>x.provenance==='official'),candidates=data.airport_reports.filter(x=>x.provenance==='candidate');
 $('#source-content').innerHTML=`
 <section class="panel source-card"><h2>Источники и период</h2><p>Разовый срез: <strong>23 сентября 2026, 00:00 — 23 октября 2026, 00:51 МСК</strong>. Последний день неполный. Страница «О данных» относится ко всему архиву; фильтры календаря и обзора её не меняют.</p><p>Основной источник — <a href="https://t.me/s/favt_info" target="_blank" rel="noopener noreferrer">публичный канал Росавиации</a>. Собрано ${data.meta.archive_messages} уникальных сообщений с ${data.meta.archive_pages} страниц, включая запас до начала периода. К московским аэропортам за период относятся ${data.meta.moscow_source_messages} сообщения.</p><p>После разбора: <strong>${data.episodes.length} эпизодов, ${data.segments.length} участков режимов</strong> и ${data.observations.length} сводки без установленных границ. Дополнительно сохранены ${official.length} сообщений подтверждённых каналов SVO и DME и ${candidates.length} сообщения канала VKO, чья обратная ссылка с официального сайта не проверена. У ZIA доступных сообщений за период не найдено. Дополнительные сообщения видны в карточках эпизодов и не задают границы расчётов.</p></section>
 <section class="panel source-card"><h2>Как читать календарь и показатели</h2><ul class="method-list">
 <li><strong>Время — по публикациям.</strong> Начало и конец восстановлены по объявлениям Росавиации. Задержка между фактическим событием и публикацией не измерена.</li>
 <li><strong>Режимы различаются.</strong> «Приём и выпуск ограничены» и «по согласованию» показаны разными цветами. Работа по согласованию не равна полному закрытию аэропорта.</li>
 <li><strong>Эпизод — для одного аэропорта.</strong> Смена режима внутри эпизода не создаёт новый эпизод. В длительность попадает только часть внутри выбранных дат.</li>
 <li><strong>Аэропорто-часы суммируются.</strong> Один час одновременно в четырёх аэропортах — четыре аэропорто-часа. График по часам показывает долю доступного времени с учётом неполного последнего дня.</li>
 <li><strong>Пустой участок — отсутствие интервала в выборке.</strong> Он не подтверждает отсутствие ограничений. Сводки без границ сохранены отдельно и не добавляют часы.</li>
 <li><strong>Причина и последствия не устанавливаются автоматически.</strong> Региональная опасность, SMS РСЧС и сигнал «Ковёр» не подменяют режим аэропорта. Полного месячного архива SMS и истории отдельных рейсов нет. По этим данным нельзя вычислить вероятность будущей задержки.</li>
 </ul></section>`;
}
function renderAudit(){
 if(!comparisonData){$('#comparison-content').innerHTML='<section class="panel source-card"><h2>Сверка не загрузилась</h2><p>Обновите страницу или <a href="data/comparison.json">откройте JSON сверки</a>.</p></section>'+downloads();return;}
 const c=comparisonData,a=c.airports_ru,m=c.msk_airports,b=c.benzinmap;
 $('#comparison-content').innerHTML=`
 <section class="panel source-card"><h2>Сверка с другими сайтами</h2><p>Сравнены сохранённые снимки за тот же период. Агрегаторы аэропортов используют Росавиацию, поэтому совпадение показывает согласие обработки общего источника и не доказывает полноту реальной истории.</p>
 <div class="table-scroll"><table class="audit-summary"><thead><tr><th>ИСТОЧНИК</th><th>РЕЗУЛЬТАТ</th><th>ВЛИЯНИЕ НА ВЫВОДЫ</th></tr></thead><tbody>
 <tr><td><a href="${m.url}" target="_blank" rel="noopener noreferrer">msk-airports.ru ↗</a></td><td>${m.exact_event_matches}/${m.event_count} показанных переходов совпали</td><td>Журнал доступен с 9 по 22 октября. Разница DME 31/30 объясняется эпизодом, начавшимся до периода.</td></tr>
 <tr><td><a href="${a.url}" target="_blank" rel="noopener noreferrer">Airports.ru ↗</a></td><td>${a.matching_both_boundaries}/${a.ours_segments} участков (${number(a.agreement_percent_of_our_segments)}%) совпали с допуском менее минуты</td><td>Для ${a.missing_in_csv.length} участков нет соответствия, у ${a.different_endings.length} отличается окончание или смена режима. Это может существенно менять длительность.</td></tr>
 <tr><td><a href="${b.url}" target="_blank" rel="noopener noreferrer">BenzinMap ↗</a></td><td>197 присвоений совпали; 8 ошибочных или необоснованных</td><td>Есть неверное отнесение сообщений к аэропортам и длительные интервалы без подтверждённой непрерывности. Ещё 2 присвоения допустимы как сводки без границ.</td></tr>
 <tr><td><a href="https://karta-bpla.ru/aeroporty/sheremetevo/" target="_blank" rel="noopener noreferrer">Радар Онлайн / РСЧС ↗</a></td><td>Прямое сравнение невозможно</td><td>41 период региональной опасности — другой показатель; сбор с 30 сентября. Полный месячный архив SMS РСЧС не получен.</td></tr>
 </tbody></table></div>
 <p>Основные 98 эпизодов и 130 участков сохранены: сверка не дала оснований заменить их внешними рядами. Проценты выше описывают совпадение рядов, а не достоверность или полноту нашего архива.</p>
 <details class="audit-case"><summary>Примеры существенных расхождений</summary>
 <p><strong>Длительность:</strong> для VKO и DME 5 октября CSV Airports.ru ведёт согласование до 6 октября 01:53, хотя <a href="https://t.me/favt_info/8427" target="_blank" rel="noopener noreferrer">пост 8427</a> снимает ограничения 5 октября в 04:22. Разница около 21 ч 31 мин на аэропорт.</p>
 <p><strong>Режим:</strong> VKO 13 октября с 03:12 работает по согласованию до 10:59, а CSV сохраняет первый режим до 10:59. <a href="https://t.me/favt_info/8637" target="_blank" rel="noopener noreferrer">Объявление смены режима</a>.</p>
 <p><strong>Аэропорт:</strong> в <a href="https://t.me/favt_info/8518" target="_blank" rel="noopener noreferrer">посте 8518</a> согласование относится к ZIA; SVO, VKO и DME названы открытыми. BenzinMap присваивает согласование и им.</p>
 <p><strong>Неизвестные границы:</strong> BenzinMap соединяет <a href="https://t.me/favt_info/8797" target="_blank" rel="noopener noreferrer">сводку 17 октября</a> со снятием 21 октября. Источник не доказывает непрерывность режима все 85 часов; у нас эта сводка не образует интервал.</p>
 </details></section>`+downloads();
}
function downloads(){return `<section class="panel source-card"><h2>Скачать данные и отчёты</h2><p>JSON содержит события, эпизоды, интервалы и дополнительные сообщения. CSV — все восстановленные интервалы. Экспорт в календаре и обзоре учитывает фильтры. ZIP содержит открытые исходные снимки и контрольные суммы.</p><div class="downloads"><a class="button" href="data/dataset.json" download>Данные JSON ↓</a><a class="button secondary" href="data/intervals.csv" download>Интервалы CSV ↓</a><a class="button secondary" href="data/source-messages.json" download>Исходные сообщения ↓</a><a class="button secondary" href="data/collection-manifest.json" download>Манифест сбора ↓</a><a class="button secondary" href="data/comparison-report.md" download>Отчёт сверки ↓</a><a class="button secondary" href="data/rschs-audit.md" download>Разбор РСЧС ↓</a><a class="button secondary" href="data/comparison.json" download>Сверка JSON ↓</a><a class="button secondary" href="data/evidence.zip" download>Исходные снимки ZIP ↓</a></div></section>`;}
function openEpisode(id){
 const e=data.episodes.find(x=>x.id===id);if(!e)return;
 const segments=data.segments.filter(s=>s.episode_id===id);
 const visible=q.segments.filter(s=>s.episode_id===id);
 const fullDuration=segments.reduce((n,s)=>n+timestamp(s.clipped_end)-timestamp(s.clipped_start),0);
 const reports=data.airport_reports.filter(r=>r.airport===e.airport&&timestamp(r.published_at)>=timestamp(e.start)-30*60000&&timestamp(r.published_at)<=timestamp(e.end||data.meta.cutoff)+30*60000);
 $('#detail-content').innerHTML=`<div class="detail-header"><div class="eyebrow">${e.airport} / ПОДРОБНОСТИ ЭПИЗОДА</div><h2>${names[e.airport]}<br>${date(e.start,{day:'numeric',month:'long'})}</h2><p class="muted">${date(e.start)} ${clock(e.start)} — ${e.end?date(e.end)+' '+clock(e.end):'снятие не найдено'} МСК</p></div>
 <div class="detail-stats"><div><small>В месячном срезе</small>${duration(fullDuration)}</div><div><small>В текущей выборке</small>${duration(visible.reduce((n,s)=>n+s.b-s.a,0))}</div></div>
 <p class="detail-caveat">Границы основаны на времени публикаций Росавиации. Они не устанавливают точное операционное время. ${timestamp(e.start)<timestamp(data.meta.start)?'Эпизод начался до начала месяца; в суммах учтено только пересечение.':''}</p>
 ${segments.map(s=>`<div class="detail-segment">${tag(s.status)}<p>${date(s.start)} ${clock(s.start)} — ${s.end?date(s.end)+' '+clock(s.end):'окончание неизвестно'} МСК</p><a class="source-link" href="${esc(eventMap.get(s.start_event)?.url)}" target="_blank" rel="noopener noreferrer">Объявление режима ↗</a>${s.end_event?`<a class="source-link" href="${esc(eventMap.get(s.end_event)?.url)}" target="_blank" rel="noopener noreferrer">Следующий переход ↗</a>`:''}</div>`).join('')}
 <h3>Сообщения аэропорта рядом с эпизодом</h3><p class="muted" style="font-size:10px">В пределах эпизода и 30 минут от границ. Это дополнительные материалы, а не автоматическое подтверждение интервала.</p>
 ${reports.length?reports.map(r=>`<article class="airport-report"><b>${date(r.published_at)} · ${clock(r.published_at)} МСК</b>${r.provenance==='candidate'?'<div class="candidate-label">Канал заявляет официальный статус; связь с сайтом не проверена</div>':''}<p>${esc(r.text)}</p><a class="source-link" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">Исходное сообщение ↗</a></article>`).join(''):'<p class="muted" style="font-size:11px">В собранных дополнительных источниках рядом с этим эпизодом сообщений нет.</p>'}`;
 if(!$('#detail').open)$('#detail').showModal();
}
function openDay(key){
 const d=days.find(d=>d.key===key);if(!d)return;
 const midnight=dayStart(key);
 $('#detail-content').innerHTML=`<div class="detail-header"><div class="eyebrow">ОБЩИЙ КАЛЕНДАРЬ / ВСЕ АЭРОПОРТЫ</div><h2>${date(midnight,{day:'numeric',month:'long',year:'numeric'})}</h2></div><p class="detail-caveat">Участки текущей выборки. Время московское, по публикациям. ${d.partial?'После 00:51 МСК данных в срезе нет.':''}</p>`+Object.keys(names).map(a=>{
  const selected=q.airports.includes(a),ss=q.segments.filter(s=>s.airport===a&&s.a<d.b&&s.b>d.a);
  return `<section class="detail-segment"><h3><span class="airport-code">${a}</span> ${names[a]}</h3>${!selected?'<p class="muted">Аэропорт исключён фильтром</p>':!ss.length?'<p class="muted">Нет интервалов в текущей выборке</p>':ss.map(s=>{const from=Math.max(s.a,d.a),to=Math.min(s.b,d.b);return `<div class="day-detail-item"><span>${clock(from)}–${to===midnight+DAY?'24:00':clock(to)} · ${duration(to-from)}</span>${tag(s.status)}<button class="button secondary" data-episode="${s.episode_id}">Эпизод и источники ↗</button></div>`;}).join('')}</section>`;
 }).join('');
 if(!$('#detail').open)$('#detail').showModal();
}
function csvExport(){
 const headers=['airport','status','start_msk','end_msk','selected_minutes','episode_id','start_source','end_source'];
 const rows=q.segments.map(s=>[s.airport,s.status,new Date(s.a+3*HOUR).toISOString().replace('Z','+03:00'),new Date(s.b+3*HOUR).toISOString().replace('Z','+03:00'),((s.b-s.a)/60000).toFixed(3),s.episode_id,eventMap.get(s.start_event)?.url,eventMap.get(s.end_event)?.url||'']);
 const csv='\uFEFF'+[headers,...rows].map(row=>row.map(c=>'"'+String(c??'').replaceAll('"','""')+'"').join(',')).join('\r\n');
 const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
 const a=document.createElement('a');a.href=url;a.download=`moscow-airspace-${filters.from}-${filters.to}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 toast(`Экспортировано участков: ${rows.length}. Даты и режим учитывают фильтры.`);
}
let toastTimer;
function toast(text){$('#toast').textContent=text;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
function setView(){
 const route=resolveView(location.hash),view=route.view;
 $('#main').dataset.view=view;
 document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==view+'-view');
 document.querySelectorAll('.nav-link').forEach(e=>{e.classList.toggle('active',e.dataset.view===view);if(e.dataset.view===view)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});
 const titles={calendar:'Общий календарь',overview:'Обзор ограничений',data:'О данных'};
 const subtitles={calendar:'Ограничения по дням и времени в Шереметьево, Внуково, Домодедово и Жуковском.',overview:'Количество эпизодов, длительность ограничений и сравнение аэропортов за выбранный период.',data:'Источники, правила расчёта, результаты сверки и файлы для скачивания.'};
 $('#page-title').textContent=titles[view];$('#page-subtitle').textContent=subtitles[view];
 document.title=titles[view]+' — аэропорты Москвы';
 $('.filters').hidden=view==='data';
 $('#validation').hidden=view==='data'||validate();
 if(route.journal){$('#journal-details').open=true;$('#journal-details').scrollIntoView({block:'start'});}else window.scrollTo(0,0);
}
$('.skip').addEventListener('click',e=>{e.preventDefault();$('#main').focus();});
document.addEventListener('click',e=>{
 const airport=e.target.closest('[data-airport]');if(airport){const a=airport.dataset.airport;filters.airports=filters.airports.includes(a)?filters.airports.filter(x=>x!==a):Object.keys(names).filter(x=>filters.airports.includes(x)||x===a);page=journalPage=0;render();return;}
 const day=e.target.closest('[data-day]');if(day){focusDay=day.dataset.day;renderCalendar();renderTimeline();saveState();return;}
 const monthDay=e.target.closest('[data-month-day]');if(monthDay){openDay(monthDay.dataset.monthDay);return;}
 const episode=e.target.closest('[data-episode]');if(episode){openEpisode(episode.dataset.episode);return;}
 const paging=e.target.closest('[data-page]');if(paging){if(paging.dataset.page==='episodes'){page+=Number(paging.dataset.delta);renderEpisodes();}else{journalPage+=Number(paging.dataset.delta);renderJournal();}return;}
 const hour=e.target.closest('[data-hour]');if(hour){const x=hourly(q)[Number(hour.dataset.hour)];toast(`${String(x.hour).padStart(2,'0')}:00 МСК · `+(x.exposure?`${number(x.fraction*100)}% наблюдаемого времени под ограничениями`:'нет наблюдаемого времени в выборке'));}
});
['date-from','date-to','type'].forEach(id=>$('#'+id).addEventListener('change',()=>{filters={...filters,from:$('#date-from').value,to:$('#date-to').value,type:$('#type').value};page=journalPage=0;render();}));
$('#reset').addEventListener('click',()=>{filters={...defaults,airports:[...defaults.airports]};focusDay='2026-10-22';initFilters(false);page=journalPage=0;render();});
$('#search').addEventListener('input',()=>{journalPage=0;renderJournal();});
$('#export-filtered').addEventListener('click',csvExport);
$('#export-calendar').addEventListener('click',csvExport);
$('#close-detail').addEventListener('click',()=>$('#detail').close());
$('#detail').addEventListener('click',e=>{if(e.target===$('#detail')){const r=$('#detail').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('#detail').close();}});
for(const [id,delta] of [['prev-day',-1],['next-day',1]])$('#'+id).addEventListener('click',()=>{const i=days.findIndex(d=>d.key===focusDay);if(days[i+delta]){focusDay=days[i+delta].key;renderCalendar();renderTimeline();saveState();}});
window.addEventListener('hashchange',setView);
try{
 const response=await fetch('data/dataset.json');if(!response.ok)throw new Error(`HTTP ${response.status}`);data=await response.json();
 try{const audit=await fetch('data/comparison.json');if(audit.ok)comparisonData=await audit.json();}catch{}
 eventMap=new Map(data.events.map(e=>[e.id,e]));initFilters();renderSources();renderAudit();render();$('#loading').hidden=true;$('#content').hidden=false;setView();
}catch(err){$('#loading').innerHTML=`Не удалось загрузить архив. Обновите страницу или <a href="data/dataset.json">скачайте данные</a>.`;console.error(err);}
