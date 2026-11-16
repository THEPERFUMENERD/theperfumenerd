# THE PERFUME NERD

A mobile-first fragrance storefront built with React, TypeScript and Vite. Myriad Pro is used when the business supplies a licensed font; the current preview uses a consistent sans-serif fallback.

## Run locally

```powershell
npm.cmd install
npm.cmd run dev
```

Create a production bundle with `npm.cmd run build`.

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

The admin workspace is at `/admin`. Product changes, homepage hero/announcement content, and customer feedback use live Firestore listeners. Product and storefront images upload directly to Cloudinary using separate unsigned presets restricted to JPG, PNG, and WebP files, with Cloudinary-generated IDs and dedicated asset folders. The app limits uploads to 5 MB in the admin UI; unsigned presets do not enforce this client-side size limit against arbitrary requests. The Cloudinary API secret is used only by the local setup script and is never added to browser configuration. Apply the included Firestore rules before using the workspace:

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

The admin dashboard currently covers overview, product create/edit/remove, storefront visibility, and multiple Men/Women/Unisex category assignments per fragrance, homepage hero and announcement content, Cloudinary image uploads, and a live customer-feedback inbox. Older catalog records with one `category` remain supported. It does not yet include order/payment management, staff permissions, audit logs, customer/order lookup, or automated abuse throttling.

### Point of Sale — initial release

The admin portal links to `/admin/pos`, a cashier terminal that reads live, visible Firestore products and the same `products/{productId}.stock` used by the storefront. Cash sales are submitted to the `completePosCashSale` Firebase callable function, which rechecks product visibility, price and stock and atomically writes a `sales/{saleId}` record, decrements stock and creates `inventoryMovements` records. The callable requires Firebase Authentication and either a trusted `admin: true` custom claim or the verified, explicitly allowlisted `perfumenerd6@gmail.com` account. Direct client writes to sales and inventory movements are denied by Firestore rules.

The **Customer display** link opens `/pos-display/{random-session-token}` in a separate screen; the live cart is shared through a narrowly readable display document. Held carts are kept in the current cashier browser session and are rechecked against live stock when resumed. Receipts support the browser print dialog.

After adding POS, publish the current `firestore.rules` file so admins can create display sessions and token holders can read only their active cart. A permission-denied message on either POS screen usually means the deployed rules are older than this file. Also use one development hostname consistently: `localhost` and `127.0.0.1` have separate browser sign-in sessions. If the POS reports zero products without a Firebase error, add and publish products in the admin catalogue; the POS only shows live, visible Firestore products and does not use preview samples.

Run `npm.cmd run test:pos` to exercise the callable against the Firebase Auth, Firestore and Functions emulators. The test verifies administrator authorization, cash/change calculations, stock movements, oversell and insufficient-tender rejection, and exact idempotent retries. Reusing a sale reference with changed sale details is rejected.

Deploy the Functions runtime as well as Firestore/Storage rules before using the POS:

```powershell
.\node_modules\.bin\firebase.cmd deploy --only functions,firestore:rules,storage
```

Cloud Functions deployment requires an eligible Firebase billing plan and an authenticated, authorized Firebase CLI. App Check is not enforced by the callable because this project does not yet configure App Check; the callable still enforces the Firebase identity and admin authorization server-side.

This is the initial POS slice, not the complete master specification: it supports one existing catalog product per stock item and confirmed cash sales only. Online checkout remains unimplemented, so it cannot deduct from shared stock. Product variants and barcode/SKU fields, customer database linking, Mobile Money/card/split payments and provider verification, tax/discount configuration, refunds/returns, manager/cashier roles, registers/shifts, multi-branch inventory, sales-history/reporting screens, and offline synchronization are not implemented. Do not treat it as a complete retail or online inventory system until these capabilities and production operational controls are added and verified.

## Preview data and launch requirements

The products and prices in `src/catalog.ts` and all displayed stock are illustrative development samples. Replace them with verified inventory, product imagery, prices, sourcing information and stock before launch. The font and Unsplash imagery in this preview are not supplied or licensed by the business.

The storefront currently implements responsive collection browsing, search, category/family/availability filtering, product details, the fragrance finder, a browser-persisted guest wishlist and cart, and a guest checkout form. Checkout posts to `/api/checkout`; that endpoint is deliberately not included. The form reports the unavailable secure checkout service rather than simulating a payment.

This is a frontend preview, **not a production-ready commerce system**. Firebase Authentication, a Firestore-backed editable storefront/admin workspace, and baseline Firestore/Storage rules are implemented, but rules must be deployed and an administrator claim provisioned before live admin editing works. The app does not yet include Paystack transaction initialization or webhook verification, order tracking, full real-time support chat, a production order system, audit logs, or operational monitoring. Do not accept real orders with this preview.

Before production, provision Firebase and configure restricted server-side credentials for Paystack; implement and test the server-authoritative checkout, payment verification and idempotent webhook flow; replace sample data; set actual delivery, contact and policy information; and test authorization, payment and database rules in the Firebase Emulator Suite and Paystack test mode. Never put a Paystack secret key or Firebase service-account credential in browser code.

No customer reviews, delivery promises, authenticity guarantees or other unverified business claims are included.
