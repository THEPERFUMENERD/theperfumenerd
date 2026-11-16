import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const email = process.argv[2]?.trim().toLowerCase();
const projectId = process.env.VITE_FIREBASE_PROJECT_ID;

if (!email) {
  console.error('Usage: npm run admin:grant -- admin@example.com');
  process.exitCode = 1;
} else if (!projectId) {
  console.error('Set VITE_FIREBASE_PROJECT_ID in .env.local first.');
  process.exitCode = 1;
} else {
  try {
    const app = getApps()[0] ?? initializeApp({
      credential: applicationDefault(),
      projectId,
    });
    const auth = getAuth(app);
    const account = await auth.getUserByEmail(email);
    await auth.setCustomUserClaims(account.uid, {
      ...account.customClaims,
      admin: true,
    });
    console.log(`Administrator access granted to ${email}. Have the user sign out and back in to refresh their ID token.`);
  } catch (error) {
    console.error('Could not provision administrator access.', error);
    process.exitCode = 1;
  }
}
