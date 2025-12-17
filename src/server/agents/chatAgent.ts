import z from "zod";
import fs from "fs/promises";
import { Agent } from "@openai/agents";

export const getChatAgent = async () => {
  const chatAgent = new Agent({
    name: "chat-agent",
    instructions: await fs.readFile(
      "src/server/agents/chat-agent/system-prompt.md",
      "utf8"
    ),
  });
  return chatAgent;
};

import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const response = await openai.responses.create({
  prompt: {
    id: "pmpt_694136ccf4308194b4613c68b85ceaf902e4126bdf4f82b8",
    variables: {
      level_3_specific_instructions: "example level_3_specific_instructions",
      user_context: "example user_context",
    },
  },
});
