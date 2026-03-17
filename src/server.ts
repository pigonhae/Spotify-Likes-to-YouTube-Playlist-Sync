import { buildApp } from "./app.js";

const { app, context } = await buildApp();

await app.listen({
  host: context.config.HOST,
  port: context.config.PORT,
});
