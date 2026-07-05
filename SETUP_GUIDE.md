# 🚀 Social Poster Setup Guide

Follow these steps to connect your Facebook Page and Instagram Business account to the Social Poster system.

## 🔑 1. Create a Meta Developer App
1. Go to the [Meta for Developers](https://developers.facebook.com/) portal and log in.
2. Click **My Apps** > **Create App**.
3. Select an app type (e.g., **Other** > **Business**).
4. Give your app a name and click **Create App**.

---

## 📘 2. Connect Facebook Page
To post photos and videos to a Facebook Page, you need a **Page Access Token**.

### A. Get the Page ID
1. Go to your Facebook Page.
2. Click **About** > **Page Transparency**.
3. Copy the **Page ID** listed there.

### B. Generate a Page Access Token
1. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. Select your app in the **Meta App** dropdown.
3. Under **User or Page**, select the Facebook Page you want to connect.
4. Add the following **Permissions**:
   - `pages_manage_posts`
   - `pages_read_engagement`
   - `publish_video` (for video support)
5. Click **Generate Token**.
6. Copy the token and paste it into the **FB Settings** page in the Social Poster app.

---

## 📸 3. Connect Instagram Business Account
Instagram posting requires your account to be a **Business** or **Creator** account and **linked to a Facebook Page**.

### A. Get the Instagram Account ID
1. Open the [Graph API Explorer](https://developers.facebook.com/tools/explorer/).
2. Ensure you have the following **Permissions**:
   - `instagram_basic`
   - `instagram_content_publish`
   - `pages_read_engagement`
3. Select your **Page Access Token** in the dropdown.
4. In the query bar, enter:
   `GET /v21.0/me?fields=instagram_business_account`
5. Click **Submit**. You will see an ID labeled `instagram_business_account`.
6. Copy this ID—it is your **Instagram Account ID**.

### B. Use the Token
- Use the **same Page Access Token** generated in step 2.
- Paste both the **Instagram Account ID** and the **Access Token** into the **IG Settings** page.

---

## ✅ 4. Verify Connections
1. Go to the **Dashboard** in the Social Poster app.
2. You should see "Connected" status for both platforms.
3. Try a **Test Connection** in the Settings pages to confirm everything is working!

---

### ⚠️ Important Note on Tokens
The tokens generated in the Graph API Explorer are **Short-lived** (usually expire in 1-2 hours). For long-term use, you should exchange them for a **Long-lived Token** (60 days) via the "Token Tool" in the Meta Developer Portal.
