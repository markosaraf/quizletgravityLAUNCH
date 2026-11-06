import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import pg from 'pg';
const base=process.env.TEST_URL||'http://localhost:3035';
const url='https://quizlet.com/ch/1181229873/voci-mission-6-flash-cards/';
const captions=[`Ich lerne Voci Mission 6 auf Quizlet:\n${url}?i=share`, `I'm studying Voci Mission 6 on Quizlet: ${url}`];
const browser=await chromium.launch();
const page=await browser.newPage({viewport:{width:390,height:844}});
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});let uid;
async function paste(locator,text){await locator.evaluate((element,text)=>{const data=new DataTransfer();data.setData('text/plain',text);element.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));},text);}
try{
 await page.goto(base+'/sets');
 uid=await page.evaluate(async()=>{const r=await fetch('/api/auth/sign-in/anonymous',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});return (await r.json()).user.id;});
 assert(uid);
 for(const caption of captions){
  await page.goto(base+'/sets');
  const input=page.getByRole('textbox',{name:'Quizlet set link'});
  await paste(input,caption);assert.equal(await input.inputValue(),url);
  // Also prove the form accepts a full caption without a paste handler (e.g. autofill).
  await input.fill(caption.replaceAll('\n',' '));
  assert(await input.evaluate(e=>e.checkValidity()));
  await page.getByRole('button',{name:'Import set',exact:true}).click();
  await page.waitForURL('**/1181229873/*-flash-cards',{timeout:30000});
  await page.getByRole('heading',{name:'Voci Mission 6',exact:true}).waitFor();
 }
 await page.goto(base+'/create-set');
 await page.getByRole('button',{name:'Import Quizlet Set',exact:true}).click();
 const gameInput=page.locator('#quizlet-url-input');await paste(gameInput,captions[0]);assert.equal(await gameInput.inputValue(),url);
 console.log('PASS: German/English share captions, multiline paste, direct caption submission, same canonical shared set, both import fields.');
}finally{await browser.close();if(uid)await db.query('DELETE FROM "user" WHERE id=$1',[uid]);await db.end();}
