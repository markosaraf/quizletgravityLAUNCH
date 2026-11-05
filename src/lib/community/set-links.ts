/** Quizlet-style URLs, on our own domain. Internal UUIDs stay private to API calls. */
export function sharedSetPath(set:{public_id:string;title:string;source_url?:string|null}) {
 // Preserve the imported Quizlet slug and optional locale, without tracking parameters.
 if(set.source_url) {
  try {
   const path=new URL(set.source_url).pathname;
   if(new RegExp(`^/(?:[a-z]{2}(?:-[a-z]{2})?/)?${set.public_id}/[^/]+-flash-cards/?$`,'i').test(path)) return path.replace(/\/$/,'');
  } catch { /* Use the title when a source URL has no slug. */ }
 }
 const slug=set.title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,160).replace(/-$/,'')||'study-set';
 return `/${set.public_id}/${slug}-flash-cards`;
}
