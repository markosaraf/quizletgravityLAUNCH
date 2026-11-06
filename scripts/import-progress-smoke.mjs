import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://localhost:3035';
const browser=await chromium.launch();
try {
 const page=await browser.newPage({viewport:{width:390,height:844}});
 await page.route('**/api/auth/get-session**',r=>r.fulfill({json:{user:{id:'progress-fixture',name:'Fixture',email:'fixture@example.test',emailVerified:true},session:{id:'fixture',userId:'progress-fixture',token:'fixture',expiresAt:'2099-01-01T00:00:00Z'}}}));
 let calls=0;
 await page.route('**/api/import-quizlet',async route=>{calls++;await new Promise(r=>setTimeout(r,1500));await route.fulfill({status:400,json:{error:'Test import unavailable'}});});
 for(const path of ['/','/create-set']) {
  await page.goto(base+path);
  if(path==='/create-set') await page.getByRole('button',{name:'Import Quizlet Set',exact:true}).click();
  await page.getByRole('textbox',{name:'Quizlet set link'}).fill('https://quizlet.com/1181229873/voci-mission-6-flash-cards/');
  await page.getByRole('button',{name:path==='/'?'Import set':'Import',exact:true}).click();
  const progress=page.getByRole('progressbar',{name:'Importing Quizlet set'});await progress.waitFor();
  await page.waitForFunction(()=>Number(document.querySelector('[role=progressbar]')?.getAttribute('aria-valuenow'))>0);
  assert(Number(await progress.getAttribute('aria-valuenow'))<100);
  const animation=await page.locator('.GravityImportQuizlet-progressFill').evaluate(e=>getComputedStyle(e,'::after').animationName);assert.equal(animation,'GravityImportQuizletShimmer');
  await page.getByRole('alert').filter({hasText:'Test import unavailable'}).waitFor();assert.equal(await progress.count(),0);
  console.log('PASS',path,'animated estimated progress, completion capped while pending, error clears progress and unlocks retry');
 }
 assert.equal(calls,2);
}finally {await browser.close();}
