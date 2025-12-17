import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Server } from "bun";
import index from "../index.html";
import { conversationsRouter } from "./routers/conversations";
import { s3Router } from "./routers/s3";
import { trpc } from "./trpc";
import {
  getSpeechStatus,
  speechWebSocket,
  type SpeechSocketData,
} from "./speech";
import { notionRouter } from "./routers/notion";
import { googleSheetsRouter } from "./routers/google-sheets";
import { testRouter } from "./routers/test";

// Serve favicon as SVG
const faviconSvg = Bun.file(new URL("../logo.svg", import.meta.url).pathname);
const serveFavicon = async () => {
  return new Response(await faviconSvg.arrayBuffer(), {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "public, max-age=31536000",
    },
  });
};

const appRouter = trpc.router({
  conversations: conversationsRouter,
  s3: s3Router,
  notion: notionRouter,
  googleSheets: googleSheetsRouter,
  test: testRouter,
});

export const createContext = () => {
  return {};
};

const server = Bun.serve<SpeechSocketData>({
  port: 3000,
  idleTimeout: 120, // 2 minutes (default is 10 seconds)
  routes: {
    // Speech WebSocket endpoint - needs special handling for upgrade
    "/api/speech/ws": (req: Request, server: Server<SpeechSocketData>) => {
      const url = new URL(req.url);
      const sampleRate = parseInt(
        url.searchParams.get("sampleRate") ?? "48000",
        10
      );
      const languageCode = url.searchParams.get("language") ?? "pt-BR";

      const upgraded = server.upgrade(req, {
        data: {
          sampleRate,
          languageCode,
          pushStream: null,
          recognizer: null,
          cleanedUp: false,
        },
      });

      if (upgraded) {
        // Return undefined to indicate WebSocket upgrade
        return undefined as unknown as Response;
      }

      return new Response("WebSocket upgrade failed", { status: 400 });
    },
    // Favicon routes - serve logo.svg for all favicon requests
    "/favicon.ico": serveFavicon,
    "/favicon.svg": serveFavicon,
    "/logo.svg": serveFavicon,
    // tRPC API routes
    "/api/*": (req: Request) =>
      fetchRequestHandler({
        endpoint: "/api",
        req,
        router: appRouter,
        createContext,
      }),
    // Serve frontend
    "/*": index,
  },
  websocket: speechWebSocket,
});

console.log("🚀 Server running on http://localhost:3000");
console.log("🎤 Speech WebSocket: ws://localhost:3000/api/speech/ws");
console.log(
  `📊 Speech status: ${
    getSpeechStatus().configured
      ? "✅ Azure configured"
      : "⚠️ Azure not configured"
  }`
);
export type AppRouter = typeof appRouter;
