type ProcessEnv = {
  env: Record<string, string | undefined>;
};

declare const process: ProcessEnv;

const tailnetServerUrl = process.env.HERMES_CAPACITOR_SERVER_URL?.trim();

const config = {
  appId: "ai.hermes.dashboard",
  appName: "Hermes",
  webDir: "../hermes_cli/web_dist",
  bundledWebRuntime: false,
  ...(tailnetServerUrl
    ? {
        server: {
          cleartext: false,
          url: tailnetServerUrl,
        },
      }
    : {}),
  ios: {
    contentInset: "automatic",
    preferredContentMode: "mobile",
    scheme: "Hermes",
  },
};

export default config;
