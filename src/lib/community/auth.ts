import { betterAuth } from 'better-auth';
import { username, anonymous, oneTimeToken } from 'better-auth/plugins';
import { db } from './db';
import { sendRecovery } from './recovery';
export const auth = betterAuth({
  database: db,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3035',
  secret: process.env.BETTER_AUTH_SECRET,
  appName: 'Quizzlet Gravity',
  emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128, resetPasswordTokenExpiresIn: 1800, revokeSessionsOnPasswordReset: true, ...(process.env.GMAIL_REFRESH_TOKEN ? {sendResetPassword: async ({user,url}:{user:{email:string};url:string}) => sendRecovery(user.email,url)} : {}) },
  socialProviders: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? {
    google: { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
  } : {},
  rateLimit: { enabled: true, storage: 'database', window: 60, max: 30 },
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 86400 },
  plugins: [oneTimeToken({expiresIn:2,storeToken:"hashed",disableClientRequest:true}),username({ minUsernameLength: 3, maxUsernameLength: 24 }), anonymous({
    onLinkAccount: async ({ anonymousUser, newUser }) => {
      await db.query(`INSERT INTO high_scores(set_id,user_id,score,level,mode,achieved_at)
        SELECT set_id,$1,score,level,mode,achieved_at FROM high_scores WHERE user_id=$2
        ON CONFLICT(set_id,user_id) DO UPDATE SET score=GREATEST(high_scores.score,EXCLUDED.score),
        level=CASE WHEN EXCLUDED.score>high_scores.score THEN EXCLUDED.level ELSE high_scores.level END,
        mode=CASE WHEN EXCLUDED.score>high_scores.score THEN EXCLUDED.mode ELSE high_scores.mode END,
        achieved_at=CASE WHEN EXCLUDED.score>high_scores.score THEN EXCLUDED.achieved_at ELSE high_scores.achieved_at END`,[newUser.user.id,anonymousUser.user.id]);
      await db.query('UPDATE shared_sets SET created_by=$1 WHERE created_by=$2',[newUser.user.id,anonymousUser.user.id]);
    }
  })]
});
