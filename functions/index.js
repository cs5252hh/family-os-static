/**
 * AdventureKids Cloud Functions — 三支登入處理 function
 *
 * 部署後 endpoint:
 *   functions.lineExchange   — LIFF 自動登入
 *   functions.googleSync     — Google Auth 後同步 user doc
 *   functions.kidExchange    — 小冒險家代碼登入
 *
 * 防護設定：
 *   - region: asia-east1 (與 Firestore 同 region 降低延遲)
 *   - maxInstances: 10 (限制並行數，防止暴量燒錢)
 *
 * 部署：
 *   firebase deploy --only functions
 */

// 注意：firebase-functions v6 必須明確 import v1 子模組
const functions = require('firebase-functions/v1');
const admin = require('firebase-admin');

admin.initializeApp();
const db = admin.firestore();
const auth = admin.auth();

// ⚠️ 確認這個 channel id 跟你的 LIFF channel 一致
// LIFF ID 是 2009808286-3qfR7gLt，前綴 2009808286 才是 LIFF channel id
// （Messaging API channel 2009893171 是另一個，verify token 用的是 LIFF 那個）
const LIFF_CHANNEL_ID = '2009808286';

// 共用 runtime 設定
const runtimeOpts = {
  maxInstances: 10,           // 同時最多 10 個 instance（防暴量燒錢）
  timeoutSeconds: 30,
  memory: '256MB',
};

// 區域設定 (與 Firestore 同 region: asia-east1)
const regionalFunctions = functions.region('asia-east1').runWith(runtimeOpts);

// ==================== lineExchange ====================

exports.lineExchange = regionalFunctions.https.onCall(async (data, context) => {
  const { lineAccessToken } = data;
  if (!lineAccessToken) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing lineAccessToken');
  }

  // 1. 驗 LINE access token (Node 18+ 內建 fetch)
  const verifyRes = await fetch(
    `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(lineAccessToken)}`
  );
  if (!verifyRes.ok) {
    throw new functions.https.HttpsError('unauthenticated', 'Invalid LINE access token');
  }
  const verifyData = await verifyRes.json();
  if (verifyData.client_id !== LIFF_CHANNEL_ID) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      `LINE token from wrong channel (got ${verifyData.client_id}, expected ${LIFF_CHANNEL_ID})`
    );
  }

  // 2. 拿 LINE profile
  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${lineAccessToken}` },
  });
  if (!profileRes.ok) {
    throw new functions.https.HttpsError('unauthenticated', 'Cannot fetch LINE profile');
  }
  const profile = await profileRes.json();
  const lineUserId = profile.userId;

  // 3. 查 authIndex
  const indexRef = db.collection('authIndex').doc(`line_${lineUserId}`);
  const indexSnap = await indexRef.get();

  let firebaseUid;
  let isNewUser = false;

  if (indexSnap.exists) {
    firebaseUid = indexSnap.data().uid;
    await db.collection('users').doc(firebaseUid).update({
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  } else {
    // 新用戶：建 Firebase Auth + user doc + index
    const newUser = await auth.createUser({ displayName: profile.displayName });
    firebaseUid = newUser.uid;
    isNewUser = true;

    await db.collection('users').doc(firebaseUid).set({
      uid: firebaseUid,
      name: profile.displayName,
      avatar: '👨‍✈️',
      role: 'captain',
      coins: 0,
      petEXP: 0,
      streak: 0,
      linkedAccounts: {
        line: {
          userId: lineUserId,
          linkedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
      schemaVersion: 2,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await indexRef.set({ uid: firebaseUid });
  }

  const customToken = await auth.createCustomToken(firebaseUid);
  return { customToken, isNewUser };
});

// ==================== googleSync ====================
// 前提：前端已用 Firebase Auth Google sign-in 完成登入（拿到 ID token）
// 這支 function 負責「同步 Firestore user doc + authIndex」
// 不發 custom token，因為 Firebase Auth 已經處理好登入了

exports.googleSync = regionalFunctions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be signed in with Google first');
  }

  const firebaseUid = context.auth.uid;
  const email = context.auth.token.email;
  const name = context.auth.token.name || '船長';

  const userRef = db.collection('users').doc(firebaseUid);
  const userSnap = await userRef.get();

  if (userSnap.exists) {
    await userRef.update({
      lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { isNewUser: false };
  }

  await userRef.set({
    uid: firebaseUid,
    name,
    avatar: '👨‍✈️',
    role: 'captain',
    coins: 0,
    petEXP: 0,
    streak: 0,
    linkedAccounts: {
      google: {
        email,
        linkedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
    },
    schemaVersion: 2,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  if (email) {
    await db.collection('authIndex').doc(`google_${email}`).set({ uid: firebaseUid });
  }

  return { isNewUser: true };
});

// ==================== kidExchange ====================

exports.kidExchange = regionalFunctions.https.onCall(async (data, context) => {
  const { kidCode } = data;
  if (!kidCode || typeof kidCode !== 'string' || !kidCode.startsWith('KID-')) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid kidCode format');
  }

  const indexRef = db.collection('authIndex').doc(`kid_${kidCode}`);
  const indexSnap = await indexRef.get();
  if (!indexSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Kid code not recognized');
  }

  const firebaseUid = indexSnap.data().uid;

  await db.collection('users').doc(firebaseUid).update({
    lastActiveAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const customToken = await auth.createCustomToken(firebaseUid);
  return { customToken };
});
