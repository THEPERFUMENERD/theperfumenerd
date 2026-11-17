# THE PERFUME NERD

A mobile-first fragrance storefront built with React, TypeScript and Vite. Myriad Pro is used when the business supplies a licensed font; the current preview uses a consistent sans-serif fallback.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Create a production bundle with `npm.cmd run build`.

## Render uptime

The GitHub Actions workflow at `.github/workflows/keep-render-awake.yml` requests both the Render storefront and order API every 5 minutes. It runs only after the workflow is pushed to the repository's default branch and GitHub Actions/scheduled workflows are enabled. Scheduled workflows are best-effort and GitHub may delay runs, so these free pings can reduce idle sleeps but cannot guarantee uninterrupted availability.

## Firebase email and Google sign-in

The Account page supports Firebase email/password registration and sign-in, Google popup sign-in, email verification, password reset and sign-out. Authentication state uses Firebase's browser-local persistence.

1. In Firebase Console, create a **Web app** in your project and enable **Email/Password** and **Google** under Authentication → Sign-in method.
2. Copy the web app configuration (API key, auth domain, project ID and app ID; optional storage bucket and sender ID) into a `.env.local` file in the project root using the names in `.env.example`.
3. Add `localhost` and your deployed website hostname in Authentication → Settings → Authorized domains.
4. Restart the Vite development server after editing `.env.local`.

The web app config is intended for browser use. Do not put Firebase service-account JSON, private keys or Admin SDK credentials in `.env.local` or frontend code. `.env.local` is ignored by git.

## Email verification and admin workspace

After registration, the Account page checks verification automatically while it is open and when the customer returns to the tab. Once verified, it displays a brief success countdown and returns to Home without signing the customer out.

Signed-in customers can view and update their name, phone number, and delivery address details on the Account page. Their email address comes from Firebase Authentication, and verified accounts show a simple “Verified” status. Customer profile documents are private to their owner under the Firestore rules.

The admin workspace is at `/admin`. Product changes, homepage header image and copy, collection-card content and images, the collection/search page header, and the fragrance-finder feature (in **Website Images**), storefront announcement/footer content, and customer feedback use live Firestore listeners. The collection-page header's eyebrow, headline, supporting text, image, and image caption are editable; product count and Accra location remain dynamic/fixed. The storefront keeps the last server-confirmed public catalog and settings in browser-local storage for quick startup, ignores potentially stale Firestore cache events, and updates from Firestore when fresh server data arrives. Replacing or clearing a website image replaces that image URL in published settings; the storefront does not retain the old URL as a fallback. Product and storefront images upload directly to Cloudinary using separate unsigned presets restricted to JPG, PNG, and WebP files, with Cloudinary-generated IDs and dedicated asset folders. The app limits uploads to 5 MB in the admin UI; unsigned presets do not enforce this client-side size limit against arbitrary requests. The Cloudinary API secret is used only by the local setup script and is never added to browser configuration. Apply the included Firestore rules before using the workspace:

```powershell
.\node_modules\.bin\firebase.cmd deploy --only firestore:rules
```

Before image uploads work, create a Cloudinary account and get its cloud name, API key and API secret from the Cloudinary dashboard. Copy `.env.cloudinary.example` to `.env.cloudinary` and fill in those three values. The real `.env.cloudinary` file is git-ignored. Then run the setup command, which creates or updates the restricted upload presets and writes only the public cloud name and preset names to the ignored `.env.local` file:

```powershell
npm.cmd run cloudinary:setup
npm.cmd run dev
```

Unsigned presets avoid the Firebase Blaze billing requirement but are public upload endpoints; Cloudinary does not enforce the app's 5 MB size check on arbitrary direct requests, so monitor Cloudinary account usage. For authenticated uploads and stronger abuse protection, use signed uploads backed by a server. Admin access to Firestore remains enforced by Firebase rules. The verified Firebase account `perfumenerd6@gmail.com` is explicitly allowlisted in Firestore rules; its Account page shows the Admin button only after Firebase confirms the signed-in email is verified. Do not put account passwords or API secrets in frontend code. For other administrator accounts, authenticate a trusted machine with Google Application Default Credentials or set `GOOGLE_APPLICATION_CREDENTIALS` to a service-account JSON kept **outside this repository**, then run:

```powershell
npm.cmd run admin:grant -- admin@example.com
```

The script preserves existing custom claims and sets `admin: true`. Have the administrator sign out and back in to refresh the ID token. Never grant this claim from a browser, a Firestore user document, or a customer-editable profile field. Publicly writable feedback has basic Firestore field/size validation; enable Firebase App Check in the project and enforce it before production to reduce automated abuse.

The admin dashboard currently covers overview, product create/edit/remove, storefront visibility, and multiple Men/Women/Unisex category assignments per fragrance, homepage hero and announcement content, Cloudinary image uploads, mutually exclusive all-products percentage or selected-product price sales, a live customer-feedback inbox, customer orders and registered users. Orders include payment, delivery and item details; admins can update fulfillment status. User accounts are read from Firebase Authentication and combined with their private profile contact details. Discounted prices, sale labels, and cart totals update from live storefront settings and product records; all-products sale prices are rounded to the nearest whole Ghana cedi. Older catalog records with one `category` remain supported. Staff permissions, audit logs and automated abuse throttling are not implemented.

### Point of Sale — initial release

The admin portal links to `/admin/pos`, a cashier terminal that reads live, visible Firestore products and the same `products/{productId}.stock` used by the storefront. Cash sales are submitted to the `completePosCashSale` Firebase callable function, which rechecks product visibility, price and stock and atomically writes a `sales/{saleId}` record, decrements stock and creates `inventoryMovements` records. The callable requires Firebase Authentication and either a trusted `admin: true` custom claim or the verified, explicitly allowlisted `perfumenerd6@gmail.com` account. Direct client writes to sales and inventory movements are denied by Firestore rules.

The **Customer display** link opens `/pos-display/{random-session-token}` in a separate screen; the live cart is shared through a narrowly readable display document. Held carts are kept in the current cashier browser session and are rechecked against live stock when resumed. Receipts support the browser print dialog.

After adding POS, publish the current `firestore.rules` file so admins can create display sessions and token holders can read only their active cart. A permission-denied message on either POS screen usually means the deployed rules are older than this file. Also use one development hostname consistently: `localhost` and `127.0.0.1` have separate browser sign-in sessions. If the POS reports zero products without a Firebase error, add and publish products in the admin catalogue; the POS only shows live, visible Firestore products and does not use preview samples.

Run `npm.cmd run test:pos` to exercise the callable against the Firebase Auth, Firestore and Functions emulators. The test verifies administrator authorization, cash/change calculations, stock movements, oversell and insufficient-tender rejection, and exact idempotent retries. Reusing a sale reference with changed sale details is rejected.

Deploy the Functions runtime as well as Firestore/Storage rules before using the POS:

```powershell
.\node_modules\.bin\firebase.cmd deploy --only functions,firestore:rules,storage
```

Firebase Functions deployment for the POS requires an eligible Firebase billing plan and an authenticated, authorized Firebase CLI. App Check is not enforced by the callable because this project does not yet configure App Check; the callable still enforces the Firebase identity and admin authorization server-side. Online Paystack orders use the Render API described below instead.

This is the initial POS slice, not the complete master specification: it supports existing catalog products and confirmed cash sales. The online Paystack flow below also deducts shared stock after verified payment. Product variants and barcode/SKU fields, customer database linking, split payments, tax configuration, refunds/returns, manager/cashier roles, registers/shifts, multi-branch inventory, sales-history/reporting screens, and offline synchronization are not implemented. Do not treat the combined POS and online store as a complete retail system until these capabilities and production operational controls are added and verified.

## Preview data and launch requirements

The products and prices in `src/catalog.ts` and all displayed stock are illustrative development samples. Replace them with verified inventory, product imagery, prices, sourcing information and stock before launch. The font and Unsplash imagery in this preview are not supplied or licensed by the business.

The storefront currently implements responsive collection browsing, search, category/family/availability filtering, product details, the fragrance finder, a browser-persisted guest wishlist and cart, and guest or signed-in checkout. Paystack checkout creates a server-priced pending order, verifies successful payment with Paystack or its signed webhook, and deducts stock only after payment confirmation. Signed-in customers can view live order history; guests can look up an order using its generated ID and checkout email.

### Paystack checkout and order management

The storefront uses the separate `the-perfume-nerd-api` Render web service for online order initialization, payment verification, guest order lookup, admin order updates, and administrator user listing. The Render blueprint is in `render.yaml`; create the service from the repository's Render Blueprint dashboard. The free Render service may sleep while idle, so the first request after inactivity can take longer.

Set these private values in the Render service's **Environment** settings. Never commit or send either credential to the repository:

- `PAYSTACK_SECRET_KEY`: the Paystack test or live secret key.
- `FIREBASE_SERVICE_ACCOUNT`: the complete JSON contents of a Firebase service-account key with permission to read and update Firestore orders/products and list Firebase Authentication users.

Create/download the service-account JSON from Firebase project settings and paste the complete JSON as the Render environment variable value. Keep the downloaded file private and delete the local copy after configuring Render. The service uses Firebase Admin SDK server-side; this credential is not sent to browsers. `FIREBASE_PROJECT_ID`, `PUBLIC_STORE_URL`, and `ALLOWED_ORIGINS` are set by `render.yaml`. Add any custom storefront origin to `ALLOWED_ORIGINS` if needed.

The storefront defaults to `https://the-perfume-nerd-api.onrender.com`; override it locally or for a different Render service with `VITE_ORDER_API_URL` in the ignored root `.env.local` file. No Firebase Functions deployment is required for online Paystack orders. The optional helper below configures the secret for the Firebase Functions emulator only:

```powershell
npm.cmd run paystack:configure
```

This writes the value from root `.env.local` to the ignored `functions/.env.the-perfume-nerd` file. It is not exposed as a `VITE_` browser setting. For local function-emulator tests only, deploy Firestore rules with:

```powershell
.\node_modules\.bin\firebase.cmd deploy --only firestore:rules --project the-perfume-nerd
```

Use the Paystack **test secret key** while validating in test mode and the live secret only for production. In the Paystack dashboard, configure the webhook URL `https://the-perfume-nerd-api.onrender.com/api/paystack/webhook` and subscribe to successful charge events. The webhook signature is verified, and the API also verifies each returning transaction directly with Paystack. Only Firestore-backed prices, discounts, visibility and stock are trusted for payment calculations; browser-supplied prices are ignored. Pending orders are not deducted from stock. If stock is no longer sufficient after a successful charge, the order is marked for administrator review rather than silently overselling.

For local Firebase Functions emulator tests, run `npm.cmd run paystack:configure` first. Use a Paystack test key for local checks.

The customer Orders page is available from the hamburger menu. New purchases receive a compact `TPN-` order ID with a seven-character suffix; existing dated order IDs remain valid and display in compact form in the admin. Signed-in users can track their own orders; guest orders require the order ID and checkout email. Firestore rules allow customers to read only their own signed-in orders and prohibit all browser-side order writes. Admin orders are grouped by Accra calendar date and can be searched by order ID, customer name, email or phone. The Orders tab can print or save all orders for a selected date as a PDF through the browser print dialog. Admin order status changes and user directory reads go through the Render API, which verifies Firebase ID tokens and administrator authorization server-side.

Run the focused server price and checkout validation tests with `npm.cmd run test:online-orders`. The Render HTTP adapter can be tested with `npm.cmd run test:render-api`; Firestore order-access rules can be checked with `npm.cmd run test:rules`. A full payment round trip requires the Render service and Paystack test credentials; do not perform a live charge as a routine test.

Firebase Authentication, the Firestore-backed editable storefront/admin workspace, and baseline Firestore/Storage rules are implemented. Deploy current rules and provision an administrator claim before live admin editing works. Full real-time support chat, staff permissions, audit logs and operational monitoring are not included.

Before production, provision Firebase and configure restricted server-side credentials for Paystack; replace sample data; set actual delivery, contact and policy information; configure and test the Paystack webhook in test mode; and verify authorization, payment and database rules in the Firebase Emulator Suite. Never put a Paystack secret key or Firebase service-account credential in browser code.

No customer reviews, delivery promises, authenticity guarantees or other unverified business claims are included.
