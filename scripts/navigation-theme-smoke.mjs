import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://localhost:3035';
const browser=await chromium.launch();
try {
 for(const width of [390,1280]) {
 const page=await browser.newPage({viewport:{width,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(base);
 await page.getByRole('heading',{name:'Find your next set'}).waitFor();
 const nav=page.locator('.community-nav');
 const create=await nav.getByRole('link',{name:'Create set',exact:true}).boundingBox();
 const sets=await nav.getByRole('link',{name:'Sets',exact:true}).boundingBox();assert(create.x<sets.x);
 assert(await page.getByRole('textbox',{name:'Quizlet set link'}).isVisible());
 const heading=await page.getByRole('heading',{name:'Find your next set'}).boundingBox();
 const toggle=await page.getByRole('group',{name:'Theme'}).boundingBox();assert(toggle.x>heading.x);
 await page.getByRole('button',{name:'Dark',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');
 await page.waitForTimeout(100);
 await page.reload();await page.getByRole('heading',{name:'Find your next set'}).waitFor();
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 await nav.getByRole('link',{name:'Create set',exact:true}).click();
 await page.waitForURL('**/create-set');
 await page.getByRole('button',{name:'Import Quizlet Set',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Dark',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:'Light',exact:true}).click();
 await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');
 await nav.getByRole('link',{name:'Sets',exact:true}).click();await page.getByRole('heading',{name:'Find your next set'}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Light',exact:true}).getAttribute('aria-pressed'),'true');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.screenshot({path:`/tmp/gravity-sets-${width}.png`});
 assert.deepEqual(errors,[]);console.log('PASS',width,'home, navigation order, creation, theme persistence, no overflow/errors');await page.close();
 }
}finally{await browser.close();}
