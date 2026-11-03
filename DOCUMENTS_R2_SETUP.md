# Documents setup for tonight — tables update + Cloudflare R2 (about 15 minutes)

Goal: a private Cloudflare R2 bucket for Documents' encrypted files, and its keys stored in Supabase so the `doc-storage` function can hand out short-lived upload and download links (DOCUMENTS_DESIGN.md §5).

Nothing readable ever goes into the bucket: files are encrypted on your devices first. If someone got the bucket's keys, they'd get scrambled bytes.

Cloudflare's screens change now and then. If a button below has moved, the names are usually close; tell me what you see and I'll adjust.

---

## Already done (by Claude, 2026-11-03)

- **The tables update** — applied without needing the SQL editor (the old empty tables were renamed aside).
- **R2 turned on** (by you) and **the bucket `liv-documents` created** (Standard, private).
- **The `doc-storage` function deployed** to Supabase; it waits for the secrets below.

What's left is steps 4–6: the bucket's CORS policy, the access key, and the four secrets. The Cloudflare connector can't set CORS or make keys, and the secret key is best kept out of chat.

## 1. Sign in

1. Open **dash.cloudflare.com** on your laptop.
2. If you already have an account from before, use it. R2 lives in the same account as anything else you set up there (a tunnel, a domain); nothing here touches those.

## 2. Turn on R2

1. In the left menu, open **R2 Object Storage**.
2. If it asks you to subscribe or add a payment method, do it. R2 needs one on file even on the free tier. **You won't be charged**: the free allowance is 10 GB a month, and Documents should use about 1 GB in two years. The app warns at 7 GB.

## 3. Create the bucket

1. **Create bucket**.
2. Name: **`liv-documents`**.
3. Location: **Automatic**. Storage class: **Standard** (the free tier only covers Standard).
4. **Create**. Leave public access **off** (the default).

## 4. Let the app talk to the bucket (CORS)

1. Open the bucket → **Settings** → **CORS policy** → **Add CORS policy** (or Edit).
2. Paste this and save:

```json
[
  {
    "AllowedOrigins": [
      "https://effervescent-malabi-e0af55.netlify.app",
      "capacitor://localhost",
      "http://localhost:4174"
    ],
    "AllowedMethods": ["GET", "PUT", "DELETE"],
    "AllowedHeaders": ["content-type", "content-length"],
    "MaxAgeSeconds": 3600
  }
]
```

## 5. Make an access key for the bucket

1. Back on the **R2 Object Storage** page → **Manage API tokens** (sometimes "API" → "Manage R2 API Tokens").
2. **Create API token** (an Account token is fine).
   - Name: `liv-documents`
   - Permissions: **Object Read & Write**
   - Specify bucket: **only `liv-documents`**
   - TTL: **Forever**
3. **Create**. The next screen shows three values **once**:
   - **Access Key ID**
   - **Secret Access Key**
   - the **S3 endpoint**, like `https://<account id>.r2.cloudflarestorage.com` (drop any `/liv-documents` at the end).
4. Keep that screen open for step 6.

## 6. Store the keys in Supabase (not in chat)

1. Open **supabase.com/dashboard** → your project → **Edge Functions** → **Secrets** (sometimes under Project Settings → Edge Functions).
2. Add these four secrets:

| Name | Value |
|---|---|
| `DOC_S3_ENDPOINT` | the S3 endpoint from step 5 |
| `DOC_S3_BUCKET` | `liv-documents` |
| `DOC_S3_ACCESS_KEY_ID` | the Access Key ID |
| `DOC_S3_SECRET_ACCESS_KEY` | the Secret Access Key |

3. Save. Don't paste the secret key into a chat; the dashboard is the only place it needs to be.

## 7. Tell me it's done

I'll then deploy the `doc-storage` function to Supabase (this isn't a Netlify deploy), check that it answers, and do a test upload and download of an encrypted file.

---

**Later, the home server:** run Garage or MinIO at home, make a bucket and key the same way, and change `DOC_S3_ENDPOINT` (and the keys). R2 can stay as a free off-site backup.

**Turning it off:** add the secret `DOCUMENTS_STORAGE_DISABLED` = `1`; the function stops handing out links.
