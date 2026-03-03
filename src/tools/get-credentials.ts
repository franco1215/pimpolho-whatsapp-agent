import { createTool } from "@voltagent/core";
import { z } from "zod";

export const getCredentialsTool = createTool({
  name: "get_platform_credentials",
  description:
    "Retorna as credenciais de login para uma plataforma. Use ANTES de fazer login via browser. Nunca exponha a senha ao gestor — use apenas internamente para preencher formulários.",
  parameters: z.object({
    platform: z
      .enum(["keeta"])
      .describe("Nome da plataforma (ex: keeta)"),
  }),
  execute: async ({ platform }) => {
    const platforms: Record<string, { url: string; user: string; pass: string }> = {
      keeta: {
        url: process.env.KEETA_URL || "",
        user: process.env.KEETA_USER || "",
        pass: process.env.KEETA_PASS || "",
      },
    };

    const cred = platforms[platform];
    if (!cred || !cred.user) {
      return { error: `Credenciais não configuradas para ${platform}. Verifique o .env.` };
    }

    return {
      platform,
      url: cred.url,
      username: cred.user,
      password: cred.pass,
    };
  },
});
