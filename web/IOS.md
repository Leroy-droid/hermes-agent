# Hermes iOS wrapper

This dashboard can be wrapped as a local iOS/iPadOS app with Capacitor.

## Security model

Recommended private deployment:

1. The Hermes dashboard process binds to `127.0.0.1` only.
2. Tailscale Serve terminates private tailnet HTTPS.
3. Tailscale Serve proxies HTTPS traffic to `localhost:9119`.
4. The iOS app loads either the loopback URL in Simulator or your private Tailscale Serve URL.
5. Do not enable Tailscale Funnel unless you intentionally want public internet exposure.

This keeps raw dashboard port access unavailable from LAN/Wi-Fi devices while still allowing trusted tailnet devices to use the app.

## Configure the live server URL

Do not hardcode a personal tailnet hostname in committed source. By default, the iOS wrapper uses the private loopback dashboard URL:

```bash
cd web
npx cap sync ios
```

That produces a native app pointing at `http://127.0.0.1:9119`, which is ideal for Simulator and a local loopback proxy. For a real device, keep the dashboard private with Tailscale Serve and pass your own private HTTPS URL only at sync/build time:

```bash
cd web
HERMES_CAPACITOR_SERVER_URL="https://your-mac.tailnet-name.ts.net" npx cap sync ios
```

The value is intentionally not committed. Tailscale Funnel should stay off; Tailscale Serve should proxy to the dashboard bound on loopback.

## Open in Xcode

```bash
cd web
npx cap open ios
```

Or directly:

```bash
open web/ios/App/App.xcodeproj
```

## Verify locally

```bash
cd web
npm run typecheck
npx eslint src/App.tsx src/pages/ChatPage.tsx src/components/MobileChatSurface.tsx
npm run build
npx cap sync ios
xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro,OS=26.5' \
  CODE_SIGNING_ALLOWED=NO build
```

## Disable mobile tailnet HTTPS access

```bash
tailscale serve --https=443 off
```
