import { App } from "@modelcontextprotocol/ext-apps";

/**
 * Pont vers l'hôte (MCP Apps). N'expose jamais le bearer ni l'état privé :
 * seuls des textes nettoyés passent par sendMessage, sur clic explicite.
 */
export type HostInfo = {
  connected: boolean;
  hostName: string;
  openLinks: boolean;
  downloadFile: boolean;
  message: boolean;
  error?: string;
};

const app = new App({ name: "campaign-preflight-widget", version: "1.0.0" }, {}, { autoResize: true });
let info: HostInfo = { connected: false, hostName: "inconnu", openLinks: false, downloadFile: false, message: false };

export async function connectHost(): Promise<HostInfo> {
  try {
    await app.connect();
    const caps = app.getHostCapabilities() ?? {};
    info = {
      connected: true,
      hostName: app.getHostVersion()?.name ?? "inconnu",
      openLinks: Boolean(caps.openLinks),
      downloadFile: Boolean(caps.downloadFile),
      message: Boolean(caps.message),
    };
  } catch (error) {
    info = { ...info, connected: false, error: error instanceof Error ? error.message : "connexion impossible" };
  }
  return info;
}

export function hostInfo(): HostInfo {
  return info;
}

/** Thème clair/sombre communiqué par l'hôte (contexte MCP Apps), si disponible. */
export function hostTheme(): "light" | "dark" | undefined {
  if (!info.connected) return undefined;
  const theme = app.getHostContext()?.theme;
  return theme === "light" || theme === "dark" ? theme : undefined;
}

type OpenAiExtension = { openExternal?: (args: { href: string }) => unknown };

/** ui/open-link (standard MCP Apps), puis openExternal (extension ChatGPT documentée). */
export async function openExternal(url: string): Promise<"standard" | "openai" | false> {
  if (info.connected && info.openLinks) {
    try {
      const result = await app.openLink({ url });
      if (!result.isError) return "standard";
    } catch {
      // essai suivant
    }
  }
  const openai = (window as unknown as { openai?: OpenAiExtension }).openai;
  if (typeof openai?.openExternal === "function") {
    try {
      await openai.openExternal({ href: url });
      return "openai";
    } catch {
      return false;
    }
  }
  return false;
}

export async function downloadText(filename: string, mimeType: string, text: string): Promise<boolean> {
  if (!info.connected || !info.downloadFile) return false;
  try {
    const result = await app.downloadFile({
      contents: [{ type: "resource", resource: { uri: `file:///${filename}`, mimeType, text } }],
    });
    return !result.isError;
  } catch {
    return false;
  }
}

export async function sendChatMessage(text: string): Promise<boolean> {
  if (!info.connected || !info.message) return false;
  try {
    const result = await app.sendMessage({ role: "user", content: [{ type: "text", text }] });
    return !result.isError;
  } catch {
    return false;
  }
}
