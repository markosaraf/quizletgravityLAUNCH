import {chromium} from '@playwright/test';
import {randomBytes} from 'node:crypto';
import assert from 'node:assert/strict';
import pg from 'pg';
const base=process.env.TEST_URL||'http://localhost:3035';
const browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));const name='game_'+randomBytes(4).toString('hex');let uid,setId;
const db=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
await page.goto(base);const created=await page.evaluate(async name=>{let r=await fetch('/api/auth/sign-in/anonymous',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});const u=await r.json();await fetch('/api/auth/update-user',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:name,displayUsername:name,name})});r=await fetch('/api/community/sets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({title:name,cards:[{term:'one',definition:'eins '+name},{term:'two',definition:'zwei'}]})});return {uid:u.user.id,set:await r.json()};},name);uid=created.uid;setId=created.set.id;assert(setId);
await page.goto(base+'/sets/'+setId);await page.getByRole('button',{name:'Play this set',exact:true}).click();
console.log('SETUP',await page.locator('button').allTextContents());
await page.getByRole('button',{name:'Get Started',exact:true}).click();
await page.getByRole('radio',{name:'Mad Max',exact:true}).click();await page.getByRole('button',{name:"Let's go",exact:true}).click();await page.getByRole('button',{name:'Start Game',exact:true}).click();
for(let i=0;i<60;i++){if(await page.getByText('Your best score is saved.',{exact:true}).isVisible())break;const copy=page.locator('.GravityCopyTermView');if(await copy.isVisible()){const text=await copy.locator('.GravityCopyTermView-answer').textContent().catch(()=>null);if(text)await copy.locator('textarea').fill(text.trim());}await page.waitForTimeout(1000);}
await page.screenshot({path:'/tmp/quizzlet-shared-game.png',fullPage:true});console.log('FINAL', (await page.locator('body').innerText()).slice(-2000));assert(await page.getByText('Your best score is saved.',{exact:true}).isVisible());assert.equal(errors.length,0,errors.join('\n'));console.log('PASS shared-set game finishes and saves leaderboard in browser.');
}finally{await browser.close();if(setId)await db.query('DELETE FROM shared_sets WHERE id=$1',[setId]);if(uid)await db.query('DELETE FROM "user" WHERE id=$1',[uid]);await db.end();}
