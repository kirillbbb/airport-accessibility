// Preserve links to sections merged into the three current views.
export function resolveView(hash=''){
 const key=hash.replace(/^#/, '');
 if(key==='journal')return {view:'overview',journal:true};
 if(key==='sources'||key==='comparison')return {view:'data',journal:false};
 return {view:['calendar','overview','data'].includes(key)?key:'calendar',journal:false};
}
