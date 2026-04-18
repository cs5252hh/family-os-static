# Family OS - Firestore 資料結構設計

## 新版多家庭架構

### 核心概念
- **一個 LINE 用戶 = 一個 User 文檔**
- **每個家庭有獨立的 Family 文檔**
- **用 6 位邀請碼加入家庭**
- **支援一個用戶同時屬於多個家庭（未來擴展）**

---

## Collection 結構

### 1. `/users/{lineUserId}`
存放用戶基本資料和當前家庭資訊

```javascript
{
  familyId: "family123",           // 當前主要家庭 ID
  role: "captain" | "kid",         // 在主要家庭中的角色
  name: "爸爸",                    // 顯示名稱
  coins: 150,                      // 貝殼幣餘額
  petEXP: 75,                      // 寵物經驗值
  streak: 5,                       // 連續天數
  createdAt: Timestamp,
  lastActiveAt: Timestamp,
  
  // 未來擴展：多家庭支援
  families: {                      // 所屬的所有家庭
    "family123": {
      role: "captain",
      joinedAt: Timestamp
    },
    "family456": {
      role: "kid", 
      joinedAt: Timestamp
    }
  }
}
```

### 2. `/families/{familyId}`
家庭基本資料和設定

```javascript
{
  name: "Smith 冒險島",            // 家庭名稱
  inviteCode: "ABC123",            // 6位邀請碼（唯一）
  members: ["lineUser1", "lineUser2"], // 成員清單
  createdAt: Timestamp,
  updatedAt: Timestamp,
  
  settings: {
    defaultTaskReward: 5,          // 默認任務獎勵
    petEXPPerTask: 5,              // 每任務寵物經驗
    timezone: "Asia/Taipei"        // 時區設定
  },
  
  stats: {                         // 家庭統計（可選）
    totalTasksCompleted: 0,
    totalCoinsEarned: 0,
    activeDays: 0
  }
}
```

### 3. `/families/{familyId}/tasks/{taskId}`
任務資料

```javascript
{
  title: "整理房間",
  description: "把玩具收好，書桌整理乾淨",
  category: "housework",           // housework, study, health, other
  reward: 10,                      // 貝殼幣獎勵
  petEXP: 5,                       // 寵物經驗獎勵
  
  assignedTo: "lineUserId",        // 指派給誰
  assignedBy: "lineUserId",        // 誰指派的
  
  status: "pending",               // pending, submitted, completed, rejected
  priority: "normal",              // low, normal, high
  dueDate: Timestamp,              // 截止時間（可選）
  
  createdAt: Timestamp,
  submittedAt: Timestamp,          // 提交時間
  completedAt: Timestamp,          // 完成時間
  
  evidence: {                      // 證據（可選）
    type: "photo",                 // photo, note
    content: "完成照片 URL 或文字說明"
  },
  
  reviewNote: "做得很棒！"         // 審核留言
}
```

### 4. `/families/{familyId}/rewards/{rewardId}`
獎勵商品

```javascript
{
  title: "看電視 30 分鐘",
  description: "可以選擇喜歡的卡通",
  category: "entertainment",       // entertainment, food, activity, item
  cost: 20,                        // 需要的貝殼幣
  stock: 3,                        // 庫存數量（-1 = 無限）
  
  imageUrl: "https://...",         // 商品圖片
  isActive: true,                  // 是否啟用
  
  createdAt: Timestamp,
  createdBy: "lineUserId"          // 創建者
}
```

### 5. `/families/{familyId}/redemptions/{redemptionId}`
兌換申請記錄

```javascript
{
  rewardId: "reward123",
  rewardTitle: "看電視 30 分鐘",   // 冗余存放，避免獎勵被刪除
  cost: 20,
  
  userId: "lineUserId",            // 申請者
  status: "pending",               // pending, approved, rejected, used
  
  appliedAt: Timestamp,
  reviewedAt: Timestamp,
  reviewedBy: "lineUserId",        // 審核者
  reviewNote: "今天表現很好！",
  
  usedAt: Timestamp                // 實際使用時間
}
```

### 6. `/families/{familyId}/reminders/{reminderId}`
船長的話 / 提醒訊息

```javascript
{
  emoji: "👋",
  message: "今天天氣很好，記得多喝水",
  isActive: true,                  // 是否顯示在首頁
  
  createdAt: Timestamp,
  createdBy: "lineUserId",         // 創建者
  
  displayUntil: Timestamp          // 顯示到何時（可選）
}
```

### 7. `/families/{familyId}/achievements/{achievementId}`
成就系統（預留）

```javascript
{
  title: "勤勞小幫手",
  description: "完成 10 個任務", 
  icon: "🏆",
  type: "task_count",              // task_count, streak, coins, pet_level
  threshold: 10,
  
  unlockedBy: ["lineUserId1"],     // 解鎖的用戶清單
  
  createdAt: Timestamp
}
```

---

## 新用戶註冊流程

### 1. 船長（建立家庭）
```javascript
// Step 1: 創建 family 文檔
const familyId = generateId();
const inviteCode = generateInviteCode(); // 6位隨機碼

await db.collection('families').doc(familyId).set({
  name: "Smith 冒險島",
  inviteCode: inviteCode,
  members: [lineUserId],
  createdAt: FieldValue.serverTimestamp(),
  settings: { defaultTaskReward: 5, petEXPPerTask: 5 }
});

// Step 2: 創建 user 文檔
await db.collection('users').doc(lineUserId).set({
  familyId: familyId,
  role: "captain",
  name: "爸爸",
  coins: 0,
  petEXP: 0,
  streak: 0,
  createdAt: FieldValue.serverTimestamp()
});

// Step 3: 創建初始提醒
await db.collection('families').doc(familyId).collection('reminders').add({
  emoji: "👋",
  message: "歡迎來到我們的冒險島！",
  isActive: true,
  createdAt: FieldValue.serverTimestamp()
});
```

### 2. 小冒險家（加入家庭）
```javascript
// Step 1: 通過邀請碼查找家庭
const familyQuery = await db.collection('families')
  .where('inviteCode', '==', 'ABC123')
  .limit(1)
  .get();

if (familyQuery.empty) {
  throw new Error('邀請碼不存在');
}

const familyDoc = familyQuery.docs[0];
const familyId = familyDoc.id;

// Step 2: 加入家庭成員清單
await db.collection('families').doc(familyId).update({
  members: FieldValue.arrayUnion(lineUserId),
  updatedAt: FieldValue.serverTimestamp()
});

// Step 3: 創建用戶文檔
await db.collection('users').doc(lineUserId).set({
  familyId: familyId,
  role: "kid",
  name: "小明",
  coins: 0,
  petEXP: 0,
  streak: 0,
  createdAt: FieldValue.serverTimestamp()
});
```

---

## 查詢索引需求

### Firestore Indexes
```javascript
// 1. 任務查詢：依指派對象和狀態
Collection: families/{familyId}/tasks
Fields: assignedTo (Ascending), status (Ascending), createdAt (Descending)

// 2. 任務查詢：依狀態和創建時間
Collection: families/{familyId}/tasks
Fields: status (Ascending), createdAt (Descending)

// 3. 兌換查詢：依狀態和申請時間
Collection: families/{familyId}/redemptions
Fields: status (Ascending), appliedAt (Descending)

// 4. 提醒查詢：依啟用狀態和創建時間
Collection: families/{familyId}/reminders
Fields: isActive (Ascending), createdAt (Descending)
```

---

## 資料遷移計劃

### 從現有 demo-family 遷移
```javascript
// 1. 讀取現有資料
const oldTasks = await db.collection('tasks').get();
const oldRewards = await db.collection('rewards').get();
const oldReminders = await db.collection('reminders').get();

// 2. 在新結構下重建
const familyId = 'demo-family';

// 遷移任務
oldTasks.forEach(async (doc) => {
  const task = doc.data();
  await db.collection('families').doc(familyId)
    .collection('tasks').doc(doc.id).set(task);
});

// 遷移獎勵
oldRewards.forEach(async (doc) => {
  const reward = doc.data();
  await db.collection('families').doc(familyId)
    .collection('rewards').doc(doc.id).set(reward);
});

// 遷移提醒
oldReminders.forEach(async (doc) => {
  const reminder = doc.data();
  await db.collection('families').doc(familyId)
    .collection('reminders').doc(doc.id).set(reminder);
});

// 3. 創建或更新 demo family 和 users
await db.collection('families').doc(familyId).set({
  name: "Demo 冒險島",
  inviteCode: "DEMO01",
  members: ["demo-captain", "demo-kid1"],
  createdAt: FieldValue.serverTimestamp(),
  settings: { defaultTaskReward: 5, petEXPPerTask: 5 }
});

await db.collection('users').doc('demo-captain').set({
  familyId: familyId,
  role: "captain",
  name: "船長",
  coins: 0,
  petEXP: 0,
  streak: 0
});
```

---

## 安全規則建議

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 用戶只能讀寫自己的文檔
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // 家庭成員可以讀寫家庭資料
    match /families/{familyId} {
      allow read, write: if request.auth != null 
        && request.auth.uid in resource.data.members;
      
      // 子集合：任務、獎勵、兌換、提醒
      match /{subCollection}/{docId} {
        allow read, write: if request.auth != null 
          && request.auth.uid in get(/databases/$(database)/documents/families/$(familyId)).data.members;
      }
    }
  }
}
```

---

## API 呼叫範例

### 常見操作

```javascript
// 1. 取得用戶家庭資料
const userData = await db.collection('users').doc(lineUserId).get();
const familyData = await db.collection('families').doc(userData.data().familyId).get();

// 2. 查詢我的待完成任務
const myTasks = await db.collection('families').doc(familyId)
  .collection('tasks')
  .where('assignedTo', '==', lineUserId)
  .where('status', '==', 'pending')
  .orderBy('createdAt', 'desc')
  .get();

// 3. 提交任務完成
await db.collection('families').doc(familyId)
  .collection('tasks').doc(taskId)
  .update({
    status: 'submitted',
    submittedAt: FieldValue.serverTimestamp(),
    evidence: { type: 'note', content: '已完成整理' }
  });

// 4. 船長審核通過任務
const batch = db.batch();

// 更新任務狀態
const taskRef = db.collection('families').doc(familyId).collection('tasks').doc(taskId);
batch.update(taskRef, {
  status: 'completed',
  completedAt: FieldValue.serverTimestamp()
});

// 給用戶加幣和寵物經驗
const userRef = db.collection('users').doc(assignedUserId);
batch.update(userRef, {
  coins: FieldValue.increment(taskReward),
  petEXP: FieldValue.increment(petEXPReward),
  lastActiveAt: FieldValue.serverTimestamp()
});

await batch.commit();
```

這個新架構解決了：
✅ **多家庭支援**：每個家庭獨立運作
✅ **LINE 用戶對應**：用 LINE userId 當作 user document ID
✅ **邀請碼機制**：6位隨機碼加入家庭
✅ **資料隔離**：不同家庭資料完全分離
✅ **角色管理**：明確的船長/小冒險家權限
✅ **擴展性**：未來支援多家庭、成就系統等