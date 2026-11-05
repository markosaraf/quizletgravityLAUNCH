import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
const base=process.env.TEST_URL||'http://localhost:3035';
const browser=await chromium.launch();
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:844}});
  // UI test never delivers email or creates a real account.
  let requests=0;
  await page.route('**/api/auth/sign-up/email',async route=>{requests++;await route.fulfill({json:{token:null,user:{id:'ui-test',name:'Player',email:'player@example.test',emailVerified:false}}});});
  await page.route('**/api/auth/send-verification-email',route=>route.fulfill({json:{status:true}}));
  await page.route('**/api/community/pending-email',route=>route.fulfill({json:{sent:true}}));
  await page.goto(base+'/sets');
  await page.getByRole('button',{name:'Choose your name',exact:true}).click();
  const dialog=page.getByRole('dialog');
  await dialog.getByRole('button',{name:'Create account',exact:true}).click();
  await dialog.getByLabel('Username',{exact:true}).fill('player');
  await dialog.getByLabel('Email',{exact:true}).fill('player@example.test');
  assert.equal(await dialog.locator('input[type=email]').count(),1);
  assert.equal(await dialog.getByLabel('Confirm email',{exact:true}).count(),0);
  await dialog.getByLabel('Password',{exact:true}).fill('password123');
  await dialog.getByRole('button',{name:'Create account',exact:true}).last().click();
  await dialog.getByText('Check your email to activate your account.',{exact:false}).waitFor();assert.equal(requests,1);
  await dialog.getByRole('button',{name:'Resend confirmation',exact:true}).click();
  await dialog.getByText('If this address is awaiting confirmation, a new link has been sent.').waitFor();
  await dialog.getByLabel('Email',{exact:true}).fill('correct@example.test');
  await dialog.getByRole('button',{name:'Send confirmation email',exact:true}).click();
  await dialog.getByText('Confirmation sent. Check your inbox and spam folder, then return here to sign in.').waitFor();
  await page.screenshot({path:`/tmp/quizzlet-verification-${width}.png`});
  const bounds=await dialog.boundingBox();assert(bounds.x>=0&&bounds.y>=0&&bounds.y+bounds.height<=845);
  await dialog.getByRole('button',{name:'I confirmed my email — sign in',exact:true}).click();
  await dialog.getByRole('button',{name:'Sign in',exact:true}).last().waitFor();
  await page.close();
 }
 console.log('PASS: mobile/desktop signup with one email field, pending confirmation, resend, address correction and return to login. No email sent.');
}finally{await browser.close();}
