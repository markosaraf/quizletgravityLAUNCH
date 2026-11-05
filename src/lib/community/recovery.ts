// Transactional messages requested by a player through signup or account recovery.
async function sendAccountEmail(email:string,subject:string,text:string) {
  if (!process.env.GMAIL_REFRESH_TOKEN || !process.env.GMAIL_CLIENT_ID || !process.env.GMAIL_CLIENT_SECRET) throw new Error('Account email delivery is not configured');
  if (/[\r\n]/.test(email)) throw new Error('Invalid email');
  const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:process.env.GMAIL_REFRESH_TOKEN,client_id:process.env.GMAIL_CLIENT_ID,client_secret:process.env.GMAIL_CLIENT_SECRET}),signal:AbortSignal.timeout(15000),cache:'no-store'});
  if (!tokenResponse.ok) throw new Error('Recovery authorization unavailable');
  const {access_token}=await tokenResponse.json();
  const message=['From: Quizzlet Gravity <quizletgravity@gmail.com>',`To: ${email}`,`Subject: ${subject}`,'MIME-Version: 1.0','Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64','',Buffer.from(text).toString('base64')].join('\r\n');
  const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:`Bearer ${access_token}`,'Content-Type':'application/json'},body:JSON.stringify({raw:Buffer.from(message).toString('base64url')}),signal:AbortSignal.timeout(15000)});
  if(!response.ok){console.error('Account email delivery failed',{status:response.status});throw new Error('Email could not be sent. Please try again later.');}
}

export async function sendRecovery(email:string,url:string) {
 return sendAccountEmail(email,'Reset your Quizzlet Gravity password',`You requested a password reset for Quizzlet Gravity.

Open this link to choose a new password:
${url}

This link expires in 30 minutes. If you did not request it, you can ignore this email.`);
}
export async function sendConfirmation(email:string,url:string,username?:string) {
 return sendAccountEmail(email,'Confirm your Quizzlet Gravity email',`Confirm your email address to activate your Quizzlet Gravity account.${username ? `\n\nYour username: ${username}` : ''}

${url}

This link expires in one hour. After confirming, return to the app or browser where you registered and sign in. If you did not create this account, you can ignore this email.`);
}
