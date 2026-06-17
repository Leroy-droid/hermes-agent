type ProcessEnv = {
  env: Record<string, string | undefined>;
};

declare const process: ProcessEnv;

const configuredServerUrl = process.env.HERMES_CAPACITOR_SERVER_URL?.trim();
const dashboardServerUrl = configuredServerUrl || "http://127.0.0.1:9119";
const usesCleartextLoopback = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/?$/i.test(
  dashboardServerUrl,
);

const config = {
  appId: "ai.hermes.dashboard",
  appName: "Hermes",
  webDir: "../hermes_cli/web_dist",
  bundledWebRuntime: false,
  server: {
    cleartext: usesCleartextLoopback,
    url: dashboardServerUrl,
  },
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
    scheme: "Hermes",
  },
};

export default config;
