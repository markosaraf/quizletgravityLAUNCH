// Checks OAuth authorization only. Does not send or schedule an email.
const required=['GMAIL_CLIENT_ID','GMAIL_CLIENT_SECRET','GMAIL_REFRESH_TOKEN'];
for(const name of required)if(!process.env[name])throw Error(`${name} is missing`);
const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:process.env.GMAIL_REFRESH_TOKEN,client_id:process.env.GMAIL_CLIENT_ID,client_secret:process.env.GMAIL_CLIENT_SECRET})});
const body=await response.json();
if(!response.ok||!body.scope?.includes('https://www.googleapis.com/auth/gmail.send'))throw Error('Recovery sender needs authorization');
console.log('PASS recovery sender token refresh. No email sent.');
