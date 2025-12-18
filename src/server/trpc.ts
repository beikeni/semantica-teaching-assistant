import { initTRPC } from "@trpc/server";
import type { Context } from ".";

export const trpc = initTRPC.context<Context>().create();