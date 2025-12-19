import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import type { Server } from "bun";
import {
  getSpeechStatus,
  speechWebSocket,
  handleTranscribeRequest,
  type SpeechSocketData,
} from "./speech";
import { appRouter, createContext } from "./router";

// Re-export types and router utilities for external use
export type { AppRouter, AppContext, Context } from "./router";
export { createCaller, createContext } from "./router";

const isProduction = process.env.NODE_ENV === "production";

// Base path for production deployment (e.g., "/sta-demo-3")
// Set via BASE_PATH env var or defaults to "/sta-demo-3" in production
const BASE_PATH = isProduction ? process.env.BASE_PATH ?? "/sta-demo-3" : "";

// Production: serve pre-built static files from dist/
const serveProductionStatic = async (req: Request): Promise<Response> => {
  const url = new URL(req.url);
  let pathname = url.pathname;

  // Strip base path prefix if present
  if (BASE_PATH && pathname.startsWith(BASE_PATH)) {
    pathname = pathname.slice(BASE_PATH.length) || "/";
  }

  // Default to index.html for root
  if (pathname === "/" || pathname === "") {
    pathname = "/index.html";
  }

  const filePath = `./dist${pathname}`;
  const file = Bun.file(filePath);

  if (await file.exists()) {
    // Set appropriate content-type headers
    const ext = pathname.split(".").pop();
    const contentTypes: Record<string, string> = {
      html: "text/html",
      js: "application/javascript",
      css: "text/css",
      svg: "image/svg+xml",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      ico: "image/x-icon",
      json: "application/json",
    };
    const contentType = contentTypes[ext ?? ""] ?? "application/octet-stream";

    return new Response(file, {
      headers: { "Content-Type": contentType },
    });
  }

  // SPA fallback: serve index.html for unmatched routes
  return new Response(Bun.file("./dist/index.html"), {
    headers: { "Content-Type": "text/html" },
  });
};

// Speech WebSocket handler factory
const createSpeechWsHandler =
  () => (req: Request, server: Server<SpeechSocketData>) => {
    const url = new URL(req.url);
    const sampleRate = parseInt(
      url.searchParams.get("sampleRate") ?? "48000",
      10
    );
    const languageCode = url.searchParams.get("language") || undefined;

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
  };

// tRPC handler factory
const createTrpcHandler = (endpoint: string) => (req: Request) =>
  fetchRequestHandler({
    endpoint,
    req,
    router: appRouter,
    createContext,
  });

// Build routes dynamically based on environment
// Note: In production, the reverse proxy strips the base path before forwarding
// So the server always receives requests at root paths (/, /api/*, etc.)
const routes: Record<string, unknown> = {
  "/api/speech/ws": createSpeechWsHandler(),
  "/api/speech/transcribe": handleTranscribeRequest,
  "/api/*": createTrpcHandler("/api"),
};

if (isProduction) {
  // Production: serve pre-built static files
  routes["/*"] = serveProductionStatic;
} else {
  // Development: use HTML import for on-the-fly bundling
  const index = (await import("../index.html")).default;
  routes["/*"] = index;
}

const server = Bun.serve<SpeechSocketData>({
  port: 3000,
  idleTimeout: 120, // 2 minutes (default is 10 seconds)
  routes,
  websocket: speechWebSocket,
});

console.log(
  `🚀 Server running on http://localhost:3000 (${
    isProduction ? "production" : "development"
  })`
);
console.log("🎤 Speech WebSocket: ws://localhost:3000/api/speech/ws");
console.log("🎤 Speech Transcribe: POST http://localhost:3000/api/speech/transcribe");
console.log(
  `📊 Speech status: ${
    getSpeechStatus().configured
      ? "✅ Azure configured"
      : "⚠️ Azure not configured"
  }`
);
if (isProduction) {
  console.log("📁 Serving static files from ./dist/");
  console.log(`📍 Expected public base path: ${BASE_PATH}`);
}
